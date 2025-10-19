// ===== プロジェクト保存（Annotation の配列） =====
const PROJECT_KEY = 'allmaps-project-items';

function loadProject() {
  try { return JSON.parse(localStorage.getItem(PROJECT_KEY) || '[]'); }
  catch { return []; }
}
function saveProject(arr) {
  localStorage.setItem(PROJECT_KEY, JSON.stringify(arr));
}
function addToProject(item) {
  const p = loadProject();
  p.push(item);
  saveProject(p);
  return p;
}
function removeFromProject(idx) {
  const p = loadProject();
  p.splice(idx, 1);
  saveProject(p);
  return p;
}

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
    alert('No data found. Back to index.html');
    location.href = './index.html';
    return;
  }

  async function ensureImageReady(img) {
    const im = img && img._image;
    if (!im) throw new Error('image element missing');
    if (im.complete && im.naturalWidth > 0) return;
    await new Promise((res, rej) => {
      im.addEventListener('load',  res, { once:true });
      im.addEventListener('error', () => rej(new Error('image load failed')), { once:true });
    });
  }


  // ========= 画像URL（IIIF Image API 単画像） =========
  const imageUrlFromServiceBase = (base, max = 2400) =>
    base ? `${base.replace(/\/$/, '')}/full/!${max},${max}/0/default.jpg` : null;

  const IMAGE_URL = imageUrlFromServiceBase(payload.canvas.imageServiceBase, 2400);
  if (!IMAGE_URL) {
    alert('No ImageService found');
    return;
  }

  function makeAllmapsSource(payload, resource) {
    // かならずベースURL（/full/... を除去 & 末尾スラ削除）
    const baseId = (resource.id || payload.canvas.imageServiceBase || '')
      .replace(/\/info\.json$/, '')
      .replace(/\/full\/.*$/, '')
      .replace(/\/$/, '');

    const type = resource.type || (payload.canvas.apiVer === 3 ? 'ImageService3' : 'ImageService2');

    return {
      id: baseId,
      type,
      // 念のため整数化
      width: (resource.width|0),
      height: (resource.height|0),
      partOf: [
        {
          id: payload.canvas.id,
          type: 'Canvas',
          width: (payload.canvas.width|0),
          height: (payload.canvas.height|0),
          ...(payload.manifestUrl ? {
            partOf: [
              {
                id: payload.manifestUrl,
                type: 'Manifest',
                // ラベルが取れるなら付ける（任意）
                ...(payload.canvas.manifestLabel ? { label: payload.canvas.manifestLabel } : {})
              }
            ]
          } : {})
        }
      ]
    };
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

 // ========= 右上 UI（保存/追加/終了 と リスト） =========
const Ctl = L.Control.extend({
  onAdd: function () {
    const el = L.DomUtil.create('div', 'ctl');
    el.style.maxWidth = '300px';
    el.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
        <label style="white-space:nowrap;">Opacity:
          <input id="opacity" type="range" min="0" max="1" step="0.05" value="0.7">
        </label>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="saveToProject">Save this item into your project</button>
        <button id="addAnother">Add a new image</button>
        <button id="downloadPage" class="primary">Download AnnotationPage</button>
      </div>

      <div id="savedCount" style="font-weight:600;margin:6px 0 4px;">
        Saved items（${loadProject().length}）
      </div>
      <div id="projectList" style="max-height:240px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;padding:6px;background:#fff;"></div>
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

function chooseResource() {
  if (resourceCanvas) return resourceCanvas;
  if (resourceImageService) return resourceImageService;
  return null;
}

// ===== 今の編集結果から Annotation を作る（原寸座標で） =====
async function buildAnnotationForCurrent() {
  await ensureImageReady(img);
  const layers = Object.values(drawnItems._layers)
  .filter(l => typeof l.getLatLngs === 'function');
  if (!layers.length) throw new Error('Please write a polygon on the image.');
  const poly = layers[layers.length - 1];                // 一番最後に描いたもの
  let latlngs = poly.getLatLngs();
  latlngs = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  if (latlngs.length >= 2) {
    const a = latlngs[0], b = latlngs[latlngs.length - 1];
    if (a.lat === b.lat && a.lng === b.lng) latlngs.pop();
  }
  // 変換 LatLng -> プレビュー ピクセル
  const T = buildTransforms(img, map);
  const latlongArray = latlngs.map(ll => [ll.lat, ll.lng]);
  /*
  const pixelPreviewRaw = latlngs.map(ll => {
    const { u, v } = T.latLngToImagePixel(ll);
    return [u, v];
  });

  const prevW = T.iw, prevH = T.ih;
  const pixelPreview = pixelPreviewRaw.map(([u, v]) => ([
  Math.max(0, Math.min(prevW - 1, Math.round(u))),
  Math.max(0, Math.min(prevH - 1, Math.round(v)))
]));
  */
  const prevW = T.iw;
  const prevH = T.ih;
  const pixelPreview = latlngs.map(ll => {
    const { u, v } = T.latLngToImagePixel(ll);
    // 小数のままクランプ
    const uu = Math.max(0, Math.min(prevW - 1, u));
    const vv = Math.max(0, Math.min(prevH - 1, v));
    return [uu, vv];
  });

  //const serviceId = payload.canvas.imageServiceBase.replace(/\/$/, '');
  const resource = resourceImageService || resourceCanvas || await (async () => {
    const base = IMAGE_URL.replace(/\/full\/.*$/, '');
    const info = await fetch(base + '/info.json', { mode: 'cors' }).then(r => r.json());
    const ctx = Array.isArray(info['@context']) ? info['@context'].join(' ') : String(info['@context'] || '');
    const type = /image\/3/i.test(ctx) ? 'ImageService3' : 'ImageService2';
    return { type, id: base, width: (info.width|0), height: (info.height|0) }; // 整数化
  })();
  const source = makeAllmapsSource(payload, resource);

  if (!resource.width || !resource.height) throw new Error('原寸サイズ（info.json）が取得できません');

  // 原寸へスケール（最後だけ丸める）
const scaleX = resource.width  / T.iw;
const scaleY = resource.height / T.ih;

const pixelArray = pixelPreview.map(([u, v]) => [u * scaleX, v * scaleY]);

/*
const pixelArray = pixelPreview.map(([u, v]) => ([
  Math.max(0, Math.min(resource.width  - 1, Math.round(u * scaleX))),
  Math.max(0, Math.min(resource.height - 1, Math.round(v * scaleY)))
]));
*/
  // 射影なら TPS、そうでなければ affine
  const [nw, ne, sw, se] = img.getCorners();
  const dst = [nw, ne, sw, se].map(ll => {
    const p = map.latLngToLayerPoint(ll);
    return { x: p.x, y: p.y };
  });

  const iw = img._image.naturalWidth, ih = img._image.naturalHeight;

  const src = [
    { x: 0,  y: 0  },  // NW
    { x: iw, y: 0  },  // NE
    { x: 0,  y: ih },  // SW
    { x: iw, y: ih }   // SE
  ];

  const isProjective = Math.hypot(T.H[2][0], T.H[2][1]) > 1e-8;
  let transform = { type: 'polynomial', options: { order: 1 } };
  if (isProjective) {
    transform = { type: 'polynomial', options: { order: 2 } };
  }
  
  // === 誤差ログ：ここから（pixelArray 計算の直後、maskSvg の直前）===
  try {
    // 1) 地図→プレビューpx→地図 の往復誤差（メートル）
    const backErrs = latlngs.map((ll) => {
      const { u, v } = T.latLngToImagePixel(ll);
      const ll2 = T.imagePixelToLatLng(u, v);
      return ll.distanceTo(ll2); // meters
    });
    const maxBack = Math.max(...backErrs);

    // 2) 原寸px → プレビューpxに戻して地図へ（丸め/スケーリングの影響を見る）
    const llBackFromFull = pixelArray.map(([X, Y]) => {
      const u = X / scaleX; // back to preview
      const v = Y / scaleY;
      return T.imagePixelToLatLng(u, v);
    });
    const fullRoundTripErrs = llBackFromFull.map((ll2, i) => latlngs[i].distanceTo(ll2));
    const maxFullRound = Math.max(...fullRoundTripErrs);

    // 3) GCP(px) と マスク頂点(px) の最大差（ピクセル）
    //    ※ マスクは toFixed(2) だが、数値としての差を確認
    const pxDiffs = pixelArray.map(([X, Y], i) => {
      const { u, v } = T.latLngToImagePixel(latlngs[i]); // preview px
      const X2 = u * scaleX; // expected full px from preview
      const Y2 = v * scaleY;
      return Math.hypot(X - X2, Y - Y2);
    });
    const maxPxDiff = Math.max(...pxDiffs);

    console.groupCollapsed('[Georef debug]');
    console.log('Preview size (iw,ih):', T.iw, T.ih);
    console.log('Resource size        :', resource.width, resource.height);
    console.log('scaleX, scaleY       :', scaleX, scaleY);
    console.log('isProjective         :', isProjective);
    console.log('Back-proj err (m)    : max =', maxBack.toFixed(3), 'each =', backErrs.map(e=>e.toFixed(3)));
    console.log('Full roundtrip (m)   : max =', maxFullRound.toFixed(3), 'each =', fullRoundTripErrs.map(e=>e.toFixed(3)));
    console.log('Mask vs GCP (px)     : max =', maxPxDiff.toFixed(3), 'each =', pxDiffs.map(e=>e.toFixed(3)));
    console.log('pixelPreview (px)    :', pixelPreview);
    console.log('pixelArray (full px) :', pixelArray);
    console.groupEnd();
  } catch (e) {
    console.warn('[Georef debug] logging failed:', e);
  }
  // === 誤差ログ：ここまで ===


  // マスクSVG（原寸）
  //const pointsAttr = pixelArray.map(([x,y]) => `${x},${y}`).join(' ');
  const pointsAttr = pixelArray
    .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const maskSvg = `<svg width="${resource.width}" height="${resource.height}"><polygon points="${pointsAttr}"/></svg>`;
  
  // Annotation 生成
  const anno = buildAllmapsAnnotation({ source, pixelArray, latlongArray, maskSvg, transform });

  // リスト表示用の軽いメタ情報
  const label = (payload.canvas.label || '').toString() || new URL(resource.id).pathname.split('/').pop();
  const thumb = payload.canvas.imageServiceBase ? `${payload.canvas.imageServiceBase.replace(/\/$/,'')}/full/!300,300/0/default.jpg` : '';

  return { annotation: anno, label, thumb };
}

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
    // DistortableImage は [NW, NE, SW, SE] で安定利用
    const [nw, ne, sw, se] = img.getCorners();

    const iw = img._image.naturalWidth;
    const ih = img._image.naturalHeight;

    // 画像座標（Y下向き）も NW,NE,SW,SE の順
    const src = [
      { x: 0,  y: 0  },  // NW
      { x: iw, y: 0  },  // NE
      { x: 0,  y: ih },  // SW
      { x: iw, y: ih }   // SE
    ];

    // 地図レイヤピクセル（同順）
    const dst = [nw, ne, sw, se].map(ll => {
      const p = map.latLngToLayerPoint(ll);
      return { x: p.x, y: p.y };
    });

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
      },
      // 使い回し用
      H, Hinv, iw, ih
    };
  }


  // --- Allmaps 注釈生成 ---
  function buildAllmapsAnnotation({ source, pixelArray, latlongArray, maskSvg, transform }) {
    if (!source?.id || !source?.width || !source?.height) {
      throw new Error('source(id/width/height) が不足');
    }
    if (!pixelArray?.length || pixelArray.length !== latlongArray?.length) {
      throw new Error('The length of pixelArray and latlongArray must be same.');
    }

    const target = {
      type: 'SpecificResource',
      source,
      selector: { type: 'SvgSelector', value: maskSvg }
    };

    const features = pixelArray.map(([x, y], i) => {
      const [lat, lng] = latlongArray[i];
      return {
        type: 'Feature',
        //properties: { resourceCoords: [x|0, y|0] }, // 念のため整数化
        properties: { resourceCoords: [x, y] }, // 小数のまま
        geometry: { type: 'Point', coordinates: [lng, lat] }
      };
    });

    const annoId = `${source.id}#${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    return {
      id: annoId,
      type: 'Annotation',
      "@context": [
        "http://iiif.io/api/extension/georef/1/context.json",
        "http://iiif.io/api/presentation/3/context.json"
      ],
      motivation: "georeferencing",
      target,
      body: {
        type: "FeatureCollection",
        ...(transform ? { transformation: transform } : {}),
        features
      }
    };
  }

  renderProjectList(loadProject());
  // UI: 追加ボタン（index.htmlへ戻って別画像を選ぶ）
  document.getElementById('addAnother').addEventListener('click', ()=>{
    // editorを閉じず、プロジェクト配列は保持
    location.href = './index.html';
  });

  // UI: Annotation をプロジェクトに保存
  document.getElementById('saveToProject').addEventListener('click', async ()=>{
    try {
      const item = await buildAnnotationForCurrent();
      const arr = addToProject(item);
      renderProjectList(arr);
      alert('item saved to the current project.');
    } catch (e) {
      console.error(e); alert('error occurred in the saving process : ' + e.message);
    }
  });

  // UI: AnnotationPage をダウンロード
  document.getElementById('downloadPage').addEventListener('click', ()=>{
    const arr = loadProject();
    if (!arr.length) { alert('There is no item!'); return; }
    const page = {
      "@context": "http://www.w3.org/ns/anno.jsonld",
      "type": "AnnotationPage",
      "items": arr.map(x => x.annotation) // 中身は各単独 Annotation
    };

    const json = JSON.stringify(page, null, 2);
    const blob = new Blob([json], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'allmaps-annotation-page.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });


  // 右パネルのリスト描画（削除付き）
  function renderProjectList(arr) {
    const box = document.getElementById('projectList');
    if (!box) return;
    box.innerHTML = '';
    arr.forEach((item, i) => {
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = '48px 1fr auto';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '6px';
      row.style.borderBottom = '1px solid #eee';

      const imgEl = document.createElement('img');
      imgEl.src = item.thumb || '';
      imgEl.style.width = '48px';
      imgEl.style.height = '48px';
      imgEl.style.objectFit = 'cover';
      imgEl.alt = '';

      const cap = document.createElement('div');
      cap.textContent = item.label || `item ${i+1}`;
      cap.style.fontSize = '12px';

      const del = document.createElement('button');
      del.textContent = '🗑️';
      del.title = '削除';
      del.addEventListener('click', ()=>{
        const after = removeFromProject(i);
        renderProjectList(after);
      });

       // 件数ラベルの更新
      const titleEl = document.querySelector('.ctl div:nth-of-type(3)');
      if (titleEl) titleEl.firstChild.textContent = `Saved items（${arr.length}）`;

      row.appendChild(imgEl);
      row.appendChild(cap);
      row.appendChild(del);
      box.appendChild(row);
    });
  }
})();

