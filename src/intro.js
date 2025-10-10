// ---------- 小ユーティリティ ----------
const $ = sel => document.querySelector(sel);
const status = msg => { $('#status').textContent = msg || ''; };

// Image API: プレビュー用の単一画像URLを作る（!w,h は長辺フィット）
function buildPreviewUrl(imageServiceBase, max=2000){
  return `${imageServiceBase.replace(/\/$/, '')}/full/!${max},${max}/0/default.jpg`;
}
function safeLabel(label){
  if (!label) return '';
  if (typeof label === 'string') return label;
  // v3: {en:["..."]} 等
  const firstLang = Object.values(label)[0];
  return Array.isArray(firstLang) ? firstLang[0] : String(firstLang);
}

// v2/v3を吸収して Canvas 配列を返す
async function loadIiif(inputUrl){
  // info.json の場合は 1枚モード
  if (/\/info\.json(\?|$)/.test(inputUrl)) {
    const info = await fetch(inputUrl).then(r=>r.json());
    const ctx = Array.isArray(info['@context']) ? info['@context'].join(' ') : String(info['@context']||'');
    const apiVer = /image\/3/i.test(ctx) ? 3 : 2;
    const imageServiceBase = inputUrl.replace(/\/info\.json.*/,'');
    return {
      type: 'infojson',
      canvases: [{
        id: imageServiceBase,
        label: info['label'] || '',
        width: info.width, height: info.height,
        imageServiceBase, apiVer
      }],
      manifestUrl: null
    };
  }

  // Manifest の場合
  const m = await fetch(inputUrl).then(r=>r.json());
  const isV3 = !!m.items;
  const canvases = [];

  if (isV3) {
    for (const cav of (m.items || [])) {
      const label = safeLabel(cav.label);
      const width = cav.width, height = cav.height;
      // painting の ImageService を拾って base を得る
      let svcBase = null;
      try {
        const annopage = cav.items?.[0];
        const anno = annopage?.items?.[0];
        const body = anno?.body;
        const svc = (Array.isArray(body?.service) ? body.service[0] : body?.service) || {};
        svcBase = svc.id || svc['@id'] || null;
      } catch (_) {}
      canvases.push({
        id: cav.id,
        label, width, height,
        imageServiceBase: svcBase,
        apiVer: 3
      });
    }
  } else {
    const seq = (m.sequences && m.sequences[0]) || {};
    for (const cav of (seq.canvases || [])) {
      const label = safeLabel(cav.label);
      const width = cav.width, height = cav.height;
      let svcBase = null;
      try {
        const img = cav.images?.[0];
        const svc = img?.resource?.service || {};
        svcBase = svc['@id'] || svc.id || null;
      } catch(_) {}
      canvases.push({
        id: cav['@id'] || cav.id,
        label, width, height,
        imageServiceBase: svcBase,
        apiVer: 2
      });
    }
  }

  return { type:'manifest', canvases, manifestUrl: inputUrl };
}

// ---------- UI ロジック ----------
let model = {
  manifestUrl: null,
  canvases: [],
  selectedIndex: 0,
};

$('#load').addEventListener('click', async ()=>{
  const url = $('#iiifUrl').value.trim();
  if (!url) return;
  try{
    status('Loading…');
    const { type, canvases, manifestUrl } = await loadIiif(url);
    model.manifestUrl = manifestUrl;
    model.canvases = canvases;
    model.selectedIndex = 0;
    renderMain(); renderThumbs();
    status(type === 'manifest' ? `Manifest OK → ${canvases.length} page(s)` : 'info.json OK → 1 image');
    $('#goEdit').disabled = false;
  } catch(e){
    console.error(e);
    status('読み込み失敗: ' + e.message);
    $('#goEdit').disabled = true;
  }
});

function renderMain() {
  const cav = model.canvases[model.selectedIndex];
  const img = document.querySelector('#mainImage');

  if (img && cav?.imageServiceBase) {
    img.src = buildPreviewUrl(cav.imageServiceBase, 2400);
  } else if (img) {
    img.removeAttribute('src');
  }

  const pc = document.querySelector('#pageCount');
  if (pc) pc.textContent = `${model.canvases.length} page(s)`;
}


function renderThumbs(){
  const wrap = $('#thumbs');
  wrap.innerHTML = '';
  model.canvases.forEach((cav, i)=>{
    const div = document.createElement('div');
    div.className = 'thumb' + (i===model.selectedIndex ? ' active':'');
    const img = document.createElement('img');
    img.alt = cav.label || `Page ${i+1}`;
    img.src = cav.imageServiceBase ? buildPreviewUrl(cav.imageServiceBase, 400) : '';
    div.appendChild(img);
    div.addEventListener('click', ()=>{
      model.selectedIndex = i;
      renderMain(); renderThumbs();
    });
    wrap.appendChild(div);
  });
}


// ---------- エディット画面へ遷移（データの受け渡し） ----------
// 方法A: localStorage（大きいデータもOK）
$('#goEdit').addEventListener('click', ()=>{
  const cav = model.canvases[model.selectedIndex];
  const payload = {
    manifestUrl: model.manifestUrl,      // info.json の場合は null
    canvas: {
      id: cav.id,
      label: cav.label,
      width: cav.width,
      height: cav.height,
      imageServiceBase: cav.imageServiceBase,
      apiVer: cav.apiVer
    }
  };
  localStorage.setItem('iiif-edit-payload', JSON.stringify(payload));
  // 例: editor.html に遷移
  location.href = './editor.html';
});

// 方法B: URL パラメータ（必要なら。短い情報向き）
/*
// 代替：URLSearchParams で渡す場合
const p = new URLSearchParams({
  manifest: model.manifestUrl || '',
  canvas: model.canvases[model.selectedIndex].id,
});
location.href = './editor.html?' + p.toString();
*/
