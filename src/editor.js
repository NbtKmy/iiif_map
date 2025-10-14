(function () {
  'use strict';

  // ========= 受け取り =========
  function readEditPayload() {
    try {
      const raw = localStorage.getItem('iiif-edit-payload');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  const payload = readEditPayload();
  if (!payload || !payload.canvas) {
    alert('導入画面からのデータが見つかりません。index.html へ戻ります。');
    location.href = './index.html';
    return;
  }

  // ========= 画像URL（IIIF Image API 単画像） =========
  const imageUrlFromServiceBase = (base, max = 2400) =>
    base ? `${base.replace(/\/$/, '')}/full/!${max},${max}/0/default.jpg` : null;

  const IMAGE_URL = imageUrlFromServiceBase(payload.canvas.imageServiceBase, 2400);
  if (!IMAGE_URL) {
    alert('ImageService が見つからず画像を表示できません。');
    return;
  }

  // ========= Allmaps target 資材（後で選択して使う） =========
  const resourceCanvas = payload.manifestUrl ? {
    type: 'Canvas',
    id: payload.canvas.id,
    width: payload.canvas.width,
    height: payload.canvas.height,
    partOf: [{ id: payload.manifestUrl, type: 'Manifest' }]
  } : null;

  const resourceImageService = payload.canvas.imageServiceBase ? {
    type: (payload.canvas.apiVer === 3 ? 'ImageService3' : 'ImageService2'),
    id: payload.canvas.imageServiceBase,
    width: payload.canvas.width,
    height: payload.canvas.height
  } : null;

  console.log('payload:', payload);
  console.log('IMAGE_URL:', IMAGE_URL);
  console.log('resourceCanvas:', resourceCanvas);
  console.log('resourceImageService:', resourceImageService);

  // ========= Leaflet 初期化 =========
  const map = L.map('map').setView([35.6812, 139.7671], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 22, attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // 初期四隅（長方形）
  const initialBounds = L.latLngBounds([35.678, 139.762], [35.684, 139.773]);
  const rectCorners = [
    initialBounds.getNorthWest(), // NW
    initialBounds.getNorthEast(), // NE
    initialBounds.getSouthWest(), // SW
    initialBounds.getSouthEast()  // SE
  ];

  const img = L.distortableImageOverlay(IMAGE_URL, {
    selected: true,
    opacity: 0.7,
    corners: rectCorners,
    suppressToolbar: false,
    mode: 'distort'
  }).addTo(map);

  // ========= Leaflet.draw =========
  const drawnItems = new L.FeatureGroup().addTo(map);
  const drawControl = new L.Control.Draw({
    edit: { featureGroup: drawnItems, poly: { allowIntersection: false } },
    draw: {
      polygon: { allowIntersection: false, showArea: false, shapeOptions: { weight: 2 } },
      rectangle: { shapeOptions: { weight: 2 } },
      polyline: false, circle: false, circlemarker: false, marker: false
    }
  });
  map.addControl(drawControl);
  map.on(L.Draw.Event.CREATED, (e) => drawnItems.addLayer(e.layer));

  // ========= 右上 UI =========
  const Ctl = L.Control.extend({
    onAdd: function () {
      const el = L.DomUtil.create('div', 'ctl');
      el.innerHTML = `
        <label>Transparency:
          <input id="opacity" type="range" min="0" max="1" step="0.05" value="0.7">
        </label>
        <button id="exportAllmaps">Allmaps Georeference JSON</button>
      `;
      L.DomEvent.disableClickPropagation(el);
      return el;
    }
  });
  map.addControl(new Ctl({ position: 'topright' }));

  // 透明度
  document.getElementById('opacity').addEventListener('input', (e) => {
    img.setOpacity(parseFloat(e.target.value));
  });

  // ========= Allmaps 出力 =========
  document.getElementById('exportAllmaps').addEventListener('click', async () => {
    try {
      // 1) GCP: 最後に描いたポリゴンから点群取得
      const layers = Object.values(drawnItems._layers);
      if (!layers.length) { alert('まずポリゴン（境界/GCP用）を描いてください'); return; }
      const poly = layers[layers.length - 1];
      let latlngs = poly.getLatLngs();
      latlngs = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;

      // 2) 変換（LatLng → プレビュー画像のピクセル）
const T = buildTransforms(img, map);
const latlongArray = latlngs.map(ll => [ll.lat, ll.lng]);
const pixelPreview = latlngs.map(ll => {
  const { u, v } = T.latLngToImagePixel(ll);
  return [u, v]; // ここはプレビュー(!2400など)のピクセル
});

// 3) resource（原寸）を確定し、プレビュー→原寸へスケール
// 既に resourceImageService を作っているならそれを優先
const resource = resourceImageService || resourceCanvas || await (async () => {
  // 最後の保険：info.jsonから幅高を取る
  const base = IMAGE_URL.replace(/\/full\/.*$/, '');
  const info = await fetch(base + '/info.json', { mode: 'cors' }).then(r => r.json());
  const ctx = Array.isArray(info['@context']) ? info['@context'].join(' ') : String(info['@context'] || '');
  const type = /image\/3/i.test(ctx) ? 'ImageService3' : 'ImageService2';
  return { type, id: base, width: info.width, height: info.height };
})();

if (!resource || !resource.width || !resource.height) {
  alert('原寸サイズ（info.json）を取得できませんでした'); return;
}

// DistortableImageが表示している実サイズ（プレビューの自然サイズ）
const previewW = img._image.naturalWidth;
const previewH = img._image.naturalHeight;

// 原寸への拡大率
const scaleX = resource.width  / previewW;
const scaleY = resource.height / previewH;

// 原寸座標に変換（← Allmaps の resourceCoords は必ず target の座標系！）
const pixelArray = pixelPreview.map(([u, v]) => [
  Math.round(u * scaleX),
  Math.round(v * scaleY)
]);

// 4) マスクSVGも原寸座標で作る（重要）
const pointsAttr = pixelArray.map(([x, y]) => `${x},${y}`).join(' ');
const maskSvg = `<svg><polygon points="${pointsAttr}"/></svg>`;

// 5) 変換アルゴリズム（お好みで）
// 角が射影（= ホモグラフィ）っぽいか簡易検知
const H = (() => {
  // buildTransformsの中で計算しているHを返せるならそれを使う
  // ここでは再計算してもOK（img.getCorners() から）
  const corners = img.getCorners(); // [NW,NE,SW,SE]
  const dst = corners.map(ll => {
    const p = map.latLngToLayerPoint(ll);
    return { x: p.x, y: p.y };
  });
  const iw = img._image.naturalWidth, ih = img._image.naturalHeight;
  const src = [{x:0,y:0},{x:iw,y:0},{x:0,y:ih},{x:iw,y:ih}];
  return computeHomography(src, dst);
})();
const p31 = H[2][0], p32 = H[2][1];
const isProjective = Math.hypot(p31, p32) > 1e-8;

// GCP が少なすぎるとTPS/2次は不安定 → 必要なら促す
if (isProjective && latlongArray.length < 6) {
  alert('四隅を動かした（射影）ようなので、GCPを6点以上に増やすと精度が上がります。\n（ポリゴン頂点を増やすのが手早いです）');
}

// 射影なら TPS（推奨）か 2次多項式に
const transform = isProjective
  ? { type: 'thinPlateSpline' }
  : { type: 'polynomial', options: { order: 1 } };   // 歪ませていないなら affine


      // 6) 注釈生成 → ダウンロード
      const annotation = buildAllmapsAnnotation({ resource, pixelArray, latlongArray, maskSvg, transform });
      const json = JSON.stringify(annotation, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'allmaps-georef-annotation.json';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      console.error(err);
      alert('出力に失敗: ' + err.message);
    }
  });

  // ========= ユーティリティ群（1回だけ定義） =========

  function orderToNW_NE_SW_SE(points) {
    const c = points.reduce((a, p) => ({ lat: a.lat + p.lat, lng: a.lng + p.lng }), { lat: 0, lng: 0 });
    c.lat /= 4; c.lng /= 4;
    const pts = points.map(p => ({ p, ang: Math.atan2(p.lat - c.lat, p.lng - c.lng) }))
      .sort((a, b) => a.ang - b.ang).map(o => o.p);
    const idxNW = pts.reduce((best, _, i, arr) =>
      (arr[i].lat > arr[best].lat || (arr[i].lat === arr[best].lat && arr[i].lng < arr[best].lng)) ? i : best, 0);
    const cyc = k => pts[(idxNW + k) % 4];
    const a1 = [cyc(0), cyc(1), cyc(2), cyc(3)];
    const neIsNext = a1[1].lng >= a1[3].lng;
    return neIsNext ? [a1[0], a1[1], a1[3], a1[2]] : [a1[0], a1[3], a1[1], a1[2]];
  }

  // --- 線形代数 ---
  const transpose = (M) => M[0].map((_, i) => M.map(r => r[i]));
  function matMul(A, B) {
    const m = A.length, n = B[0].length, k = B.length;
    const C = Array.from({ length: m }, () => Array(n).fill(0));
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) for (let t = 0; t < k; t++) C[i][j] += A[i][t] * B[t][j];
    return C;
  }
  const matVec = (A, v) => A.map(row => row.reduce((s, a, i) => s + a * v[i], 0));
  function gaussianElimination(A, b) {
    const n = A.length;
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col++) {
      let pivot = col;
      for (let i = col + 1; i < n; i++) if (Math.abs(M[i][col]) > Math.abs(M[pivot][col])) pivot = i;
      if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
      const div = M[col][col] || 1e-12;
      for (let j = col; j <= n; j++) M[col][j] /= div;
      for (let i = 0; i < n; i++) {
        if (i === col) continue;
        const f = M[i][col];
        for (let j = col; j <= n; j++) M[i][j] -= f * M[col][j];
      }
    }
    return M.map(row => row[n]);
  }
  function computeHomography(src, dst) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x: X, y: Y } = src[i], { x: x, y: y } = dst[i];
      A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]); b.push(x);
      A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]); b.push(y);
    }
    const h = gaussianElimination(matMul(transpose(A), A), matVec(transpose(A), b));
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }
  function invert3(M) {
    const [a, b, c] = M[0], [d, e, f] = M[1], [g, h, i] = M[2];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, H = -(a * f - b * d), I = a * e - b * d;
    const det = a * A + b * B + c * C || 1e-12;
    return [[A / det, D / det, G / det], [B / det, E / det, H / det], [C / det, F / det, I / det]];
  }
  const applyH = (H, p) => {
    const x = H[0][0] * p.x + H[0][1] * p.y + H[0][2];
    const y = H[1][0] * p.x + H[1][1] * p.y + H[1][2];
    const w = H[2][0] * p.x + H[2][1] * p.y + H[2][2] || 1e-12;
    return { x: x / w, y: y / w };
  };

  // --- 画像 ⇄ 地図 変換（現在の四隅から） ---
  function buildTransforms(img, map) {
    const corners = img.getCorners(); // [NW, NE, SW, SE]
    const dst = corners.map(ll => {
      const p = map.latLngToLayerPoint(ll);
      return { x: p.x, y: p.y };
    });
    const iw = img._image.naturalWidth;
    const ih = img._image.naturalHeight;
    const src = [{ x: 0, y: 0 }, { x: iw, y: 0 }, { x: 0, y: ih }, { x: iw, y: ih }];
    const H = computeHomography(src, dst);
    const Hinv = invert3(H);
    return {
      latLngToImagePixel: (ll) => {
        const lp = map.latLngToLayerPoint(ll);
        const uv = applyH(Hinv, { x: lp.x, y: lp.y });
        return { u: uv.x, v: uv.y };
      },
      imagePixelToLatLng: (u, v) => {
        const lp = applyH(H, { x: u, y: v });
        return map.layerPointToLatLng(L.point(lp.x, lp.y));
      }
    };
  }

  // --- Allmaps 注釈生成 ---
  function buildAllmapsAnnotation({ resource, pixelArray, latlongArray, maskSvg, transform }) {
    if (!resource || !resource.id || !resource.type) throw new Error('resource is invalid');
    if (!pixelArray?.length || pixelArray.length !== latlongArray?.length || pixelArray.length < 3)
      throw new Error('GCP must have 3 points. pixelArray と latlongArray を同数対応で');

    const target = maskSvg
      ? {
          type: 'SpecificResource',
          source: { id: resource.id, type: resource.type, width: resource.width, height: resource.height, ...(resource.partOf ? { partOf: resource.partOf } : {}) },
          selector: { type: 'SvgSelector', value: maskSvg }
        }
      : { id: resource.id, type: resource.type, width: resource.width, height: resource.height, ...(resource.partOf ? { partOf: resource.partOf } : {}) };

    const features = pixelArray.map(([x, y], i) => {
      const [lat, lng] = latlongArray[i];
      return {
        type: 'Feature',
        properties: { resourceCoords: [x, y] },
        geometry: { type: 'Point', coordinates: [lng, lat] } // GeoJSON は [lon,lat]
      };
    });

    return {
      "@context": [
        "http://iiif.io/api/extension/georef/1/context.json",
        "http://iiif.io/api/presentation/3/context.json"
      ],
      type: "Annotation",
      motivation: "georeferencing",
      target,
      body: {
        type: "FeatureCollection",
        ...(transform ? { transformation: transform } : {}),
        features
      }
    };
  }

})();
