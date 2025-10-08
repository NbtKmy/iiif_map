
// Leaflet map (IIIF usually uses CRS.Simple)
const map = L.map('map', { crs: L.CRS.Simple });
let currentLayer = null;
let iiifInfo = null;
let iiifBase = null;

let manifestData = null;
let canvasList = []; // [{index, label, base, width, height, thumb}]
let currentCanvasIndex = 0;
let didInitialFit = false;

// Opacity control
let currentOpacity = 1;
// Rotation
let currentRotation = 0;
let rotatedLayer = null;
const SINGLE_IMAGE_MAX_W = 1000;
let autoFitOnRotate = false;
let rotatedMeta = { w:0, h:0, tl:null, tr:null, bl:null, br:null };
let rotationPivot = null;
let chosenWidth = null;
let baseImageURL = null;
let lastRotationDeg = 0;




const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const thumbsPanelEl = $('#thumbsPanel');
const thumbsEl = $('#thumbs');
const thumbsCountEl = $('#thumbsCount');

function setStatus(msg, isError=false){
  statusEl.textContent = msg || '';
  statusEl.style.color = isError ? '#b91c1c' : '#64748b';
}

async function fetchJSON(url){
  const res = await fetch(url, { credentials: 'omit' });
  if(!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  return await res.json();
}

function getApiVersion(info){
  const ctx = (info['@context'] || info.context || '').toString();
  return ctx.includes('/image/3') ? 3 : 2;
}

function buildSingleImageUrl(base, info, rotationDeg){
  const v = getApiVersion(info);
  const sizeSeg = (v === 3) ? 'max' : 'full';
  const rot = Number.isFinite(rotationDeg) ? rotationDeg : 0;
  return `${base}/full/${sizeSeg}/${rot}/default.jpg`.replace(/^http:/, 'https:');
}

function asLL(p){
  if (!p) return null;
  if (typeof p.lat === 'number' && typeof p.lng === 'number') return p;
  if (Array.isArray(p) && p.length >= 2) return L.latLng(p[0], p[1]);
  return null;
}
function toArr(ll){ return [ll.lat, ll.lng]; }


function rotateLatLng(p, pivot, deg){
  const P = asLL(p), C = asLL(pivot);
  if (!P || !C) throw new Error('rotateLatLng: invalid point or pivot');
  const th = deg * Math.PI/180, cos = Math.cos(th), sin = Math.sin(th);
  const x = P.lng, y = P.lat, cx = C.lng, cy = C.lat;
  const dx = x - cx, dy = y - cy;
  // ★ yは上が正（通常の地図座標）
  const xr = cx + (cos*dx - sin*dy);
  const yr = cy + (sin*dx + cos*dy);
  return L.latLng(yr, xr);
}



function chooseScaledDims(info, maxW = SINGLE_IMAGE_MAX_W){
  const W = info.width, H = info.height;
  if (!W || !H) return { w: 2000, h: 2000 };
  if (W <= maxW) return { w: W, h: H };
  const w = maxW, h = Math.round(H * (w / W));
  return { w, h };
}

function overlayCenterFromMeta(meta){
  if (meta && meta.tl && meta.br){
    // 平行四辺形の中心＝対角の中点
    return L.latLng(
      (meta.tl[0] + meta.br[0]) / 2,
      (meta.tl[1] + meta.br[1]) / 2
    );
  }
  if (iiifInfo){
    // 画像そのものの中心
    return L.latLng(iiifInfo.height/2, iiifInfo.width/2);
  }
  return map.getCenter();
}

// pivot（LatLng）を中心に、幅w×高hの画像矩形をdeg度だけ回した3点（TL/TR/BL）を返す
function computeCornersAroundPivot(imgW, imgH, deg, pivotLatLng){
  const C = asLL(pivotLatLng);
  if (!C) throw new Error('computeCornersAroundPivot: invalid pivot');
  const cx = C.lng, cy = C.lat;
  const th = deg * Math.PI/180, cos = Math.cos(th), sin = Math.sin(th);
  const w2 = imgW/2, h2 = imgH/2;

  // 画像中心(0,0)→四隅を回転→pivotへ平行移動
  const rot = (ux, uy) => {
    // (ux,uy) は画像中心原点のローカル座標（-w2..w2, -h2..h2）
    const xr = cx + (cos*ux + sin*uy);
    const yr = cy + (-sin*ux + cos*uy);
    return L.latLng(yr, xr);
  };

  const TL = rot(-w2, -h2);
  const TR = rot( +w2, -h2);
  const BL = rot(-w2, +h2);
  const BR = rot( +w2, +h2);
  return { TL, TR, BL, BR };
}

function computeRotatedCorners(w, h, deg){
  // CRS.Simple では lng=x, lat=y と対応
  const cx = w/2, cy = h/2;
  const th = deg * Math.PI/180, cos = Math.cos(th), sin = Math.sin(th);
  const rot = (x,y) => {
    const dx = x - cx, dy = y - cy;
    const X = cx + cos*dx - sin*dy;
    const Y = cy + sin*dx + cos*dy;
    return [Y, X]; // [lat, lng]
  };
  const TL = rot(0,   0);
  const TR = rot(w,   0);
  const BL = rot(0,   h);
  const BR = rot(w,   h);
  return { TL, TR, BL, BR };
}

/*
function addClientRotatedOverlay(base, info, rotationDeg = 0){
  // 画像URLはキャンバスごとに固定（回転で変えない）
  const url = baseImageURL || `${base}/full/${chooseScaledDims(info).w},/0/default.jpg`.replace(/^http:/,'https:');

  // タイル拘束は解除
  map.setMaxBounds(null);

  // すでに配置済み → 「差分回転」で更新（ズーム/中心は一切いじらない）
  if (rotatedLayer && rotatedMeta.tl && rotatedMeta.tr && rotatedMeta.bl){
    const delta = rotationDeg - lastRotationDeg;
    const pivot = rotationPivot || map.getCenter();

    try{
      const newTL = rotateLatLng(rotatedMeta.tl, pivot, delta);
      const newTR = rotateLatLng(rotatedMeta.tr, pivot, delta);
      const newBL = rotateLatLng(rotatedMeta.bl, pivot, delta);

      rotatedLayer.reposition(newTL, newTR, newBL);
      rotatedMeta.tl = newTL; rotatedMeta.tr = newTR; rotatedMeta.bl = newBL;
      if (rotatedMeta.br) rotatedMeta.br = rotateLatLng(rotatedMeta.br, pivot, delta);

      lastRotationDeg = rotationDeg;
      applyOpacity();
      setStatus(`Client rotation (Δ=${delta.toFixed(1)}° → ${rotationDeg}°)`);
      return;
    }catch(e){
      console.warn('delta-rotate failed, reinitializing', e);
      rotatedLayer = null; // 失敗したら初期化ルートへ
    }
  }

  // ★ 初回配置：まず「非回転＆正しい向き」で原点に置く（上下逆さ対策）
  //   原点(0,0) から 右へ w / 下へ h が画像
  const w = chosenWidth || chooseScaledDims(info).w;
  const h = Math.round(info.height * (w / info.width));

  let TL = L.latLng(  0, 0);
  let TR = L.latLng(  0, w);
  let BL = L.latLng(-h, 0);
  let BR = L.latLng(-h, w);

  clearLayer();
  rotatedLayer = L.imageOverlay.rotated(url, TL, TR, BL, { opacity: currentOpacity, crossOrigin: true }).addTo(map);
  rotatedMeta  = { w, h, tl: TL, tr: TR, bl: BL, br: BR };
  currentLayer = rotatedLayer;

  // 初回だけ全体を見せる（大きすぎ問題を回避）
  if (!didInitialFit){
    const b = L.latLngBounds([TL, TR, BL, BR]);
    map.fitBounds(b, { padding: [20,20] });
    didInitialFit = true;
  }

  // ★ 回転角が 0 以外なら、「非回転で置いた四隅」を基準に差分回転
  if ((rotationDeg || 0) !== 0){
    // 回転の軸＝現在の地図中心（＝今見ている中心）
    const pivot = rotationPivot || map.getCenter();
    const newTL = rotateLatLng(rotatedMeta.tl, pivot, rotationDeg);
    const newTR = rotateLatLng(rotatedMeta.tr, pivot, rotationDeg);
    const newBL = rotateLatLng(rotatedMeta.bl, pivot, rotationDeg);
    rotatedLayer.reposition(newTL, newTR, newBL);

    rotatedMeta.tl = newTL; rotatedMeta.tr = newTR; rotatedMeta.bl = newBL;
    if (rotatedMeta.br) rotatedMeta.br = rotateLatLng(rotatedMeta.br, pivot, rotationDeg);
  }

  lastRotationDeg = rotationDeg;
  setStatus(`Client rotation: ${rotationDeg}°`);
}
*/

function addClientRotatedOverlay(base, info, rotationDeg = 0){
  // 画像URLはキャンバスごとに固定（回転で変えない）
  const url = baseImageURL || `${base}/full/${chooseScaledDims(info).w},/0/default.jpg`.replace(/^http:/,'https:');

  // タイル拘束は解除
  map.setMaxBounds(null);

  // すでに配置済み → 「差分回転」で更新（ズーム/中心は一切いじらない）
  if (rotatedLayer && rotatedMeta.tl && rotatedMeta.tr && rotatedMeta.bl){
    const delta = rotationDeg - lastRotationDeg;
    const pivot = rotationPivot || map.getCenter();

    try{
      const newTL = rotateLatLng(rotatedMeta.tl, pivot, delta);
      const newTR = rotateLatLng(rotatedMeta.tr, pivot, delta);
      const newBL = rotateLatLng(rotatedMeta.bl, pivot, delta);

      rotatedLayer.reposition(newTL, newTR, newBL);
      rotatedMeta.tl = newTL; rotatedMeta.tr = newTR; rotatedMeta.bl = newBL;
      if (rotatedMeta.br) rotatedMeta.br = rotateLatLng(rotatedMeta.br, pivot, delta);

      lastRotationDeg = rotationDeg;
      applyOpacity();
      setStatus(`Client rotation (Δ=${delta.toFixed(1)}° → ${rotationDeg}°)`);
      return;
    }catch(e){
      console.warn('delta-rotate failed, reinitializing', e);
      rotatedLayer = null; // 初期化ルートへ
    }
  }

  // ----★ 初回配置：ズームを一切いじらず、いま見ている中心に置く（非回転・正向き） ----
  const w = chosenWidth || chooseScaledDims(info).w;
  const h = Math.round(info.height * (w / info.width));

  // 非回転での正しい向き（CRS.Simple は lat が上に増えるので、下は負）
  // 原点(0,0)基準での四隅
  const TL0 = L.latLng(  0, 0);
  const TR0 = L.latLng(  0, w);
  const BL0 = L.latLng(-h, 0);
  const BR0 = L.latLng(-h, w);

  // 原点矩形の中心（非回転時）
  const center0 = L.latLng(-h/2, w/2);

  // pivot＝現在の地図中心に合わせて、四隅を平行移動（ズームはそのまま）
  const pivot = rotationPivot || map.getCenter();
  const dLat = pivot.lat - center0.lat;
  const dLng = pivot.lng - center0.lng;

  let TL = L.latLng(TL0.lat + dLat, TL0.lng + dLng);
  let TR = L.latLng(TR0.lat + dLat, TR0.lng + dLng);
  let BL = L.latLng(BL0.lat + dLat, BL0.lng + dLng);
  let BR = L.latLng(BR0.lat + dLat, BR0.lng + dLng);

  clearLayer();
  rotatedLayer = L.imageOverlay.rotated(url, TL, TR, BL, { opacity: currentOpacity, crossOrigin: true }).addTo(map);
  rotatedMeta  = { w, h, tl: TL, tr: TR, bl: BL, br: BR };
  currentLayer = rotatedLayer;

  // 回転角が 0 以外なら、“今見ている中心”を軸に差分回転（ズーム・中心は不変）
  if ((rotationDeg || 0) !== 0){
    const newTL = rotateLatLng(rotatedMeta.tl, pivot, rotationDeg);
    const newTR = rotateLatLng(rotatedMeta.tr, pivot, rotationDeg);
    const newBL = rotateLatLng(rotatedMeta.bl, pivot, rotationDeg);
    rotatedLayer.reposition(newTL, newTR, newBL);
    rotatedMeta.tl = newTL; rotatedMeta.tr = newTR; rotatedMeta.bl = newBL;
    if (rotatedMeta.br) rotatedMeta.br = rotateLatLng(rotatedMeta.br, pivot, rotationDeg);
  }

  lastRotationDeg = rotationDeg;
  setStatus(`Client rotation: ${rotationDeg}°`);
}


function orderCorners(TL, TR, BL, BR){
  const pts = [asLL(TL), asLL(TR), asLL(BL), asLL(BR)].filter(Boolean);
  // 上（latが小さい）2点、下（latが大きい）2点に分割
  const sortedByLat = [...pts].sort((a,b)=> a.lat - b.lat);
  const top2    = sortedByLat.slice(0,2).sort((a,b)=> a.lng - b.lng); // 左→右
  const bottom2 = sortedByLat.slice(2).sort((a,b)=> a.lng - b.lng);   // 左→右
  return { TL: top2[0], TR: top2[1], BL: bottom2[0], BR: bottom2[1] };
}


function toHttps(u){ return (typeof u === 'string') ? u.replace(/^http:/, 'https:') : u; }
function firstLangString(label){
  if (!label) return '';
  if (typeof label === 'string') return label;
  if (Array.isArray(label)) return label[0]?.value || label[0] || '';
  if (typeof label === 'object'){
    const keys = Object.keys(label);
    if (keys.length > 0){
      const v = label[keys[0]];
      return Array.isArray(v) ? (v[0] || '') : (v || '');
    }
  }
  return '';
}

// ---- Extract Image Service base from Canvas ----
function baseFromV3Canvas(canvas){
  // Canvas -> AnnotationPage -> Annotation -> body -> service(s)
  const page = canvas.items?.[0];
  const anns = page?.items || [];
  for (const ann of anns){
    const bodies = Array.isArray(ann.body) ? ann.body : (ann.body ? [ann.body] : []);
    for (const b of bodies){
      const svcs = b.service || b.services;
      if (svcs){
        const arr = Array.isArray(svcs) ? svcs : [svcs];
        const svc = arr[0];
        const base = svc?.id || svc?.['@id'];
        if (base) return base;
      }
      // Fallback: sometimes body.id is a full image URL with /full/
      const bid = b?.id || b?.['@id'];
      if (typeof bid === 'string' && bid.includes('/full/')){
        return bid.split('/full/')[0];
      }
    }
  }
  return null;
}

function baseFromV2Canvas(canvas){
  try{
    const img = canvas.images?.[0]?.resource;
    const svc = Array.isArray(img?.service) ? img.service[0] : img?.service;
    const base = svc?.id || svc?.['@id'];
    if (base) return base;
    const rid = img?.id || img?.['@id'];
    if (typeof rid === 'string' && rid.includes('/full/')){
      return rid.split('/full/')[0];
    }
  }catch(_e){}
  return null;
}

// ---- Extract canvases list from a manifest (v2/v3) ----
function extractCanvases(manifest){
  const list = [];
  if (manifest.items?.length){ // v3
    manifest.items.forEach((canvas, idx) => {
      const base = baseFromV3Canvas(canvas);
      const label = firstLangString(canvas.label) || `Page ${idx+1}`;
      const w = canvas.width, h = canvas.height;
      // thumbnail (prefer provided one)
      let thumb = null;
      const t = canvas.thumbnail;
      if (t){
        const tObj = Array.isArray(t) ? t[0] : t;
        thumb = tObj?.id || tObj?.['@id'] || null;
      }
      // fallback via Image API
      const b = base ? toHttps(base.replace(/\/$/, '')) : null;
      if (!thumb && b){
        thumb = `${b}/full/200,/0/default.jpg`;
      }
      list.push({ index: idx, label, base: b, width: w, height: h, thumb: thumb ? toHttps(thumb) : null });
    });
  } else if (manifest.sequences){ // v2
    const canvases = manifest.sequences[0]?.canvases || [];
    canvases.forEach((canvas, idx) => {
      const base = baseFromV2Canvas(canvas);
      const label = (typeof canvas.label === 'string') ? canvas.label : firstLangString(canvas.label) || `Page ${idx+1}`;
      const w = canvas.width, h = canvas.height;
      // thumbnail
      let thumb = null;
      const t = canvas.thumbnail;
      if (t){
        const tObj = Array.isArray(t) ? t[0] : t;
        thumb = tObj?.id || tObj?.['@id'] || null;
      }
      const b = base ? toHttps(base.replace(/\/$/, '')) : null;
      if (!thumb && b){
        thumb = `${b}/full/200,/0/default.jpg`;
      }
      list.push({ index: idx, label, base: b, width: w, height: h, thumb: thumb ? toHttps(thumb) : null });
    });
  }
  return list;
}

// ---- Thumbnails UI ----
function renderThumbnails(list){
  if (!list.length){
    thumbsPanelEl.classList.add('hidden');
    thumbsEl.innerHTML = '';
    return;
  }
  thumbsPanelEl.classList.remove('hidden');
  thumbsCountEl.textContent = `${list.length} page(s)`;

  thumbsEl.innerHTML = '';
  list.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'thumb' + (item.index === currentCanvasIndex ? ' active' : '');
    btn.title = item.label;

    const img = document.createElement('img');
    img.alt = item.label;
    img.loading = 'lazy';
    img.src = item.thumb || '';
    img.onerror = () => { img.style.opacity = 0.4; };

    const cap = document.createElement('div');
    cap.className = 'tlabel';
    cap.textContent = item.label;

    btn.appendChild(img);
    btn.appendChild(cap);

    btn.addEventListener('click', async () => {
      if (item.index === currentCanvasIndex) return;
      currentCanvasIndex = item.index;
      document.querySelectorAll('.thumb').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      if (item.base){
        await loadCanvasByBase(item.base);
      } else {
        setStatus('No Image Service on this canvas', true);
      }
    });

    thumbsEl.appendChild(btn);
  });
}

// ---- Display helpers ----
function clearLayer(){
  if (currentLayer){
    try { map.removeLayer(currentLayer); } catch(_e){}
    currentLayer = null;
  }
}

function addSingleImageOverlay(base, info, rotationDeg = 0){
  const url = buildSingleImageUrl(base, info, rotationDeg);
  const w = info.width, h = info.height;
  const bounds = [[0,0], [h,w]];
  clearLayer();
  currentLayer = L.imageOverlay(url, bounds, { crossOrigin: true, opacity: currentOpacity }).addTo(map);
  map.fitBounds(bounds);
  setStatus(`Single image loaded (rot=${rotationDeg}°)`);
}


function addIiifTileLayer(base){
  if (currentRotation !== 0){
    // タイルでは一般に回転不可 → 単一画像に切替
    addSingleImageOverlay(iiifBase, iiifInfo, currentRotation);
    return;
  }
  clearLayer();
  currentLayer = L.tileLayer.iiif(`${base}/info.json`, {
    fitBounds: true,
    setMaxBounds: true,
    quality: 'default',
    opacity: currentOpacity
  }).addTo(map);

  currentLayer.on('load', () => setStatus(`Tiles loaded`));
  currentLayer.on('tileerror', (e) => {
    console.warn('tileerror', e);
    setStatus('Tile error → fallback to single image', true);
    if (iiifInfo && iiifBase) addSingleImageOverlay(iiifBase, iiifInfo, currentRotation);
  });
}

function renderCurrentCanvas(){
  if (!iiifBase || !iiifInfo){ setStatus('No canvas loaded', true); return; }
  addClientRotatedOverlay(iiifBase, iiifInfo, currentRotation);
}





// ---- Core loaders ----
async function loadCanvasByBase(base){
  setStatus('Loading canvas…');
  iiifBase = toHttps(base.replace(/\/$/, ''));
  const infoUrl = `${iiifBase}/info.json`;
  iiifInfo = await fetchJSON(infoUrl);

  // Prefer service-reported base/id
  iiifBase = toHttps((iiifInfo['@id'] || iiifInfo['id'] || iiifBase).replace(/\/$/, ''));

  // ★ 追加：このキャンバスでは常に同じ縮小幅・URLを使う（回転時に再DLしない）
  chosenWidth = chooseScaledDims(iiifInfo).w;
  baseImageURL = `${iiifBase}/full/${chosenWidth},/0/default.jpg`.replace(/^http:/, 'https:');

  // ★ 回転状態を初期化
  rotatedLayer = null;
  rotatedMeta = { w:0, h:0, tl:null, tr:null, bl:null, br:null };
  lastRotationDeg = currentRotation;   // 現在角を基準に
  rotationPivot = map.getCenter();     // 初期ピボット＝現在見てる場所
  
  didInitialFit = false;
  renderCurrentCanvas();
}


async function loadFromInput(){
  setStatus('Loading…');
  thumbsPanelEl.classList.add('hidden');
  thumbsEl.innerHTML = '';
  manifestData = null;
  canvasList = [];
  currentCanvasIndex = 0;

  const input = $('#manifestUrl').value.trim();
  try{
    if (input.endsWith('/info.json')) {
      // info.json directly → no thumbnails
      const base = toHttps(input.replace(/\/info\.json$/, ''));
      await loadCanvasByBase(base);
      setStatus(`info.json OK → displaying image`);
      return;
    }

    if (/\/iiif\/\d+\//.test(input) && !/manifest/.test(input)) {
      // service base directly → no thumbnails
      const base = toHttps(input.replace(/\/$/, ''));
      await loadCanvasByBase(base);
      setStatus(`Image Service base OK → displaying image`);
      return;
    }

    // Treat as manifest
    manifestData = await fetchJSON(input);
    const canvases = extractCanvases(manifestData);
    canvasList = canvases;
    if (!canvases.length){
      throw new Error('No canvases or image services found in manifest');
    }

    // Render thumbs and load first canvas
    renderThumbnails(canvases);
    currentCanvasIndex = 0;
    const first = canvases[0];
    if (!first.base) throw new Error('First canvas has no Image Service base');
    await loadCanvasByBase(first.base);
    setStatus(`Manifest OK → ${canvases.length} page(s)`);

  }catch(err){
    console.error(err);
    setStatus(`Load failed: ${err.message}`, true);
  }
}

const opacityInput = document.querySelector('#opacity');
const opacityVal = document.querySelector('#opacityVal');

if (opacityInput){
  opacityInput.addEventListener('input', (e) => {
    currentOpacity = parseFloat(e.target.value);
    if (opacityVal) opacityVal.textContent = `${Math.round(currentOpacity*100)}%`;
    applyOpacity();
  });
}

const rotationInput = document.querySelector('#rotation');
const rotationVal   = document.querySelector('#rotationVal');
const rotationReset = document.querySelector('#rotationReset');

const autoFitChk = document.querySelector('#autoFit');
const fitNowBtn  = document.querySelector('#fitNow');

if (autoFitChk){
  autoFitChk.addEventListener('change', (e) => {
    autoFitOnRotate = !!e.target.checked;
  });
}

if (fitNowBtn){
  fitNowBtn.addEventListener('click', () => {
    if (!rotatedMeta.tl || !rotatedMeta.tr || !rotatedMeta.bl) return;
    const b = L.latLngBounds([rotatedMeta.tl, rotatedMeta.tr, rotatedMeta.bl, rotatedMeta.br].filter(Boolean));
    map.fitBounds(b, { padding: [20,20] });
  });
}

function debounce(fn, delay=200){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), delay); };
}

if (rotationInput){
  const applyRot = debounce(() => {
    currentRotation = parseInt(rotationInput.value, 10) || 0;
    if (rotationVal) rotationVal.textContent = `${currentRotation}°`;

    rotationPivot = map.getCenter();   // ★ いま見えてる中心で回す
    renderCurrentCanvas();
  }, 200);

  rotationInput.addEventListener('input', applyRot);
}


if (rotationReset){
  rotationReset.addEventListener('click', () => {
    currentRotation = 0;
    if (rotationInput) rotationInput.value = '0';
    if (rotationVal) rotationVal.textContent = '0°';
    renderCurrentCanvas();
  });
}



// UI wire
$('#btnLoad').addEventListener('click', loadFromInput);

// Initial blank view (avoid empty white)
(function initBlank(){
  const bounds = [[0,0],[1000,1000]];
  L.rectangle(bounds, { color:'#ddd', weight:1, fill:false }).addTo(map);
  map.fitBounds(bounds);
  setStatus('Enter a IIIF manifest or info.json URL, then click “Load”.');
})();

/////////////////////
// Opacity control //
/////////////////////

function applyOpacity(){
  if (!currentLayer) return;
  if (typeof currentLayer.setOpacity === 'function'){
    currentLayer.setOpacity(currentOpacity);
  }
}
