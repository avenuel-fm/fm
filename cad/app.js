// c:\avenuel\avenuel-fm-apps\fm\cad\app.js
// 에비뉴엘 온라인 CAD 뷰어 메인 애플리케이션

import {decodeDXF, parsePairs, Doc} from './dxf.js';
import {Scene} from './scene.js';
import {Viewer} from './viewer.js';
import {CATS, catColor} from './layers.js';

const $ = id => document.getElementById(id);
const S = {
  items: [],
  cats: [],
  canDel: false,
  cat: 'all',
  filtered: [],
  currentDoc: null,
  currentScene: null,
  viewer: null,
  theme: 'light',
  mode: 'cat',
  isFull: false
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const formatSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, isErr ? 6000 : 3500);
}

// 브리지 가져오기
function getBridge() {
  if (window.parent && window.parent.WS_CAD) return window.parent.WS_CAD;
  if (window.WS_CAD) return window.WS_CAD;
  return null;
}

// ==========================================================================
// 1. 목록 뷰 컨트롤
// ==========================================================================
async function loadList() {
  const bridge = getBridge();
  if (!bridge) {
    toast('업무지원 통로(WS_CAD)를 찾을 수 없습니다.', true);
    return;
  }
  try {
    const list = await bridge.list();
    S.items = Array.isArray(list) ? list : [];
    if (bridge.cats) { const c = await bridge.cats(); S.cats = c.cats || []; S.canDel = !!c.canDel; }
    if (S.cat !== 'all' && S.cat !== 'none' && !S.cats.some(c => String(c.id) === String(S.cat))) S.cat = 'all';
    renderCatBar();
    filterList($('searchBox').value || '');
  } catch (err) {
    console.error('loadList error:', err);
    toast('도면 목록을 불러오지 못했습니다: ' + err.message, true);
  }
}

function filterList(query) {
  const q = query.trim().toLowerCase();
  const inCat = it => S.cat === 'all' || (S.cat === 'none' ? !it.cat_id : String(it.cat_id) === String(S.cat));
  const base = S.items.filter(inCat);
  if (!q) {
    S.filtered = base;
  } else {
    S.filtered = base.filter(it =>
      (it.name && it.name.toLowerCase().includes(q)) ||
      (it.floor && it.floor.toLowerCase().includes(q)) ||
      (it.memo && it.memo.toLowerCase().includes(q)) ||
      (it.by && it.by.toLowerCase().includes(q))
    );
  }
  renderList();
}

function renderList() {
  const container = $('itemsContainer');
  const empty = $('emptyState');

  if (!S.filtered.length) {
    container.innerHTML = '';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  container.innerHTML = S.filtered.map(item => `
    <div class="cad-card" data-id="${esc(item.id)}">
      <div class="cad-card-head">
        <span class="cad-card-title">${esc(item.name)}</span>
        <span class="floor-badge">${esc(item.cat || '미분류')}</span>
      </div>
      ${item.memo ? `<div class="cad-card-memo">${esc(item.memo)}</div>` : ''}
      <div class="cad-card-meta">
        <span>${esc(item.floor || '-')}</span>
        <span>등록: ${esc(item.by || '직원')}</span>
        <span>날짜: ${esc(item.date || '-')}</span>
        <span>크기: ${formatSize(item.size || 0)}</span>
      </div>
    </div>
  `).join('');
}

// ==========================================================================
// 2. 도면 열기 및 뷰어 렌더링
// ==========================================================================
async function openCad(id) {
  const bridge = getBridge();
  if (!bridge) return;

  toast('도면을 불러오는 중입니다...');
  try {
    const res = await bridge.open(id);
    if (!res || !res.dxfBlob) throw new Error('도면 파일 데이터가 없습니다.');

    const buf = await res.dxfBlob.arrayBuffer();
    const {text, enc, ver} = decodeDXF(buf);
    const {C, V} = parsePairs(text);

    S.currentDoc = new Doc(C, V, enc, ver);
    S.currentScene = new Scene(S.currentDoc);

    // 뷰어 화면으로 전환
    $('listView').hidden = true;
    $('viewerView').hidden = false;
    $('docTitle').textContent = res.name || id;
    const item = S.items.find(x => x.id === id);
    $('docFloor').textContent = item ? item.floor : '도면';
    fillCatSelect($('docCat'), item ? item.cat_id : '');
    $('docCat').dataset.id = id;

    // 뷰어 인스턴스 초기화
    if (!S.viewer) {
      S.viewer = new Viewer($('cv'), {
        onCursor: (x, y) => {
          $('coordStat').textContent = `X ${x.toFixed(2)}  Y ${y.toFixed(2)}`;
        }
      });
    }
    S.viewer.theme = S.theme;
    S.viewer.mode = S.mode;
    S.viewer.setScene(S.currentScene, false);

    $('elemStat').textContent = `도형 ${S.currentScene.prims.length.toLocaleString('ko-KR')}개`;

    renderLayerDrawer();
    toast(`${res.name || '도면'}을 열었습니다.`);
  } catch (err) {
    console.error('openCad error:', err);
    toast('도면을 여는 중 오류가 발생했습니다: ' + err.message, true);
  }
}

function renderLayerDrawer(filter = '') {
  const listEl = $('layerList');
  if (!S.currentScene) return;

  const q = filter.trim().toLowerCase();
  const layers = [...S.currentScene.layers.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ko', {numeric: true})
  );

  listEl.innerHTML = layers.filter(l => !q || l.name.toLowerCase().includes(q)).map(l => {
    const checked = !S.viewer.hiddenLayers.has(l.key);
    const color = catColor(l.cat, S.theme);
    return `
      <li class="layer-item" data-key="${esc(l.key)}">
        <input type="checkbox" ${checked ? 'checked' : ''} aria-label="${esc(l.name)}">
        <span class="layer-swatch" style="--c:${color}"></span>
        <span class="layer-name" title="${esc(l.name)}">${esc(l.name)}</span>
        <span class="layer-count">${l.count}</span>
      </li>
    `;
  }).join('');
}

// ==========================================================================
// 3. 이벤트 바인딩
// ==========================================================================
function bindEvents() {
  // 검색
  $('searchBox').addEventListener('input', e => filterList(e.target.value));

  // 목록에서 도면 카드 클릭
  $('itemsContainer').addEventListener('click', e => {
    const card = e.target.closest('.cad-card');
    if (card && card.dataset.id) openCad(card.dataset.id);
  });

  // 목록으로 돌아가기
  $('btnBackToList').addEventListener('click', () => {
    $('viewerView').hidden = true;
    $('listView').hidden = false;
    $('layerDrawer').hidden = true;
  });

  // 레이어 패널 토글
  $('btnToggleLayers').addEventListener('click', () => {
    const drawer = $('layerDrawer');
    drawer.hidden = !drawer.hidden;
  });
  $('btnCloseLayers').addEventListener('click', () => {
    $('layerDrawer').hidden = true;
  });
  $('layerSearchInput').addEventListener('input', e => {
    renderLayerDrawer(e.target.value);
  });

  // 레이어 체크박스 켜기/끄기
  $('layerList').addEventListener('click', e => {
    const item = e.target.closest('.layer-item');
    if (!item) return;
    const cb = item.querySelector('input[type=checkbox]');
    if (e.target !== cb) cb.checked = !cb.checked;
    const key = item.dataset.key;
    S.viewer.toggleLayer(key, cb.checked);
  });

  // 분류색 / 원본색 전환
  $('btnCatMode').addEventListener('click', () => {
    S.mode = 'cat';
    $('btnCatMode').setAttribute('aria-pressed', 'true');
    $('btnOrigMode').setAttribute('aria-pressed', 'false');
    if (S.viewer) { S.viewer.mode = 'cat'; S.viewer.schedule(); }
    renderLayerDrawer($('layerSearchInput').value);
  });
  $('btnOrigMode').addEventListener('click', () => {
    S.mode = 'orig';
    $('btnCatMode').setAttribute('aria-pressed', 'false');
    $('btnOrigMode').setAttribute('aria-pressed', 'true');
    if (S.viewer) { S.viewer.mode = 'orig'; S.viewer.schedule(); }
    renderLayerDrawer($('layerSearchInput').value);
  });

  // 밝게 / 어둡게 테마
  $('btnLightTh').addEventListener('click', () => {
    S.theme = 'light';
    document.documentElement.dataset.theme = 'light';
    $('btnLightTh').setAttribute('aria-pressed', 'true');
    $('btnDarkTh').setAttribute('aria-pressed', 'false');
    if (S.viewer) { S.viewer.theme = 'light'; S.viewer.schedule(); }
    renderLayerDrawer($('layerSearchInput').value);
  });
  $('btnDarkTh').addEventListener('click', () => {
    S.theme = 'dark';
    document.documentElement.dataset.theme = 'dark';
    $('btnLightTh').setAttribute('aria-pressed', 'false');
    $('btnDarkTh').setAttribute('aria-pressed', 'true');
    if (S.viewer) { S.viewer.theme = 'dark'; S.viewer.schedule(); }
    renderLayerDrawer($('layerSearchInput').value);
  });

  // 화면 가득 (전체화면)
  $('btnFullscreen').addEventListener('click', async () => {
    const bridge = getBridge();
    S.isFull = !S.isFull;
    if (bridge && bridge.full) {
      await bridge.full(S.isFull);
    }
  });

  // 뷰 맞춤 (Fit)
  $('btnFitView').addEventListener('click', () => {
    if (S.viewer) S.viewer.fit();
  });
}

// ==========================================================================
// 3-2. 분류 (칩 · 관리 창 · 도면 분류 바꾸기)
// ==========================================================================
function fillCatSelect(sel, cur) {
  sel.innerHTML = '<option value="">미분류</option>' + S.cats.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  sel.value = cur ? String(cur) : '';
}

function renderCatBar() {
  const chip = (key, label, n) => `<button type="button" class="cat-chip" data-cat="${esc(key)}" aria-pressed="${String(S.cat) === String(key)}">${esc(label)} ${n}</button>`;
  const none = S.items.filter(i => !i.cat_id).length;
  $('catBar').innerHTML = chip('all', '전체', S.items.length) + S.cats.map(c => chip(c.id, c.name, S.items.filter(i => String(i.cat_id) === String(c.id)).length)).join('') + chip('none', '미분류', none);
}

function renderCatMgr(warnId) {
  const warn = S.cats.find(c => String(c.id) === String(warnId));
  $('catList').innerHTML = S.cats.map(c => `
    <div class="cat-row"><span>${esc(c.name)} <span class="n">${S.items.filter(i => String(i.cat_id) === String(c.id)).length}개</span></span>
    ${S.canDel ? `<button type="button" class="cat-del" data-del="${esc(c.id)}">삭제</button>` : ''}</div>`).join('')
    + '<div class="cat-row" style="background:var(--tint,#f3f5f8)"><span>미분류</span><span class="n">지울 수 없음</span></div>'
    + (S.canDel ? '' : '<div class="up-note">분류 삭제는 소장·부소장·관리자만 할 수 있습니다.</div>')
    + (warn ? `<div class="cat-warn">「${esc(warn.name)}」을 삭제하면 도면 ${S.items.filter(i => String(i.cat_id) === String(warn.id)).length}개는 「미분류」로 옮겨지고, 도면은 지워지지 않습니다.
      <div class="up-row"><button type="button" class="btn btn-secondary btn-sm" data-delno="1">취소</button><button type="button" class="cat-del" data-delyes="${esc(warn.id)}">삭제</button></div></div>` : '');
}

async function refreshAfterCat() {
  const b = getBridge();
  await loadList();
  fillCatSelect($('upCat'), $('upCat').value);
}

function bindCats() {
  const b = () => getBridge();
  $('catBar').addEventListener('click', e => {
    const c = e.target.closest('.cat-chip'); if (!c) return;
    S.cat = c.dataset.cat; renderCatBar(); filterList($('searchBox').value || '');
  });
  $('btnCatMgr').addEventListener('click', () => { $('catMsg').textContent = ''; renderCatMgr(); $('catDlg').showModal(); });
  $('catClose').addEventListener('click', () => $('catDlg').close());
  $('catAdd').addEventListener('click', async () => {
    const name = $('catNew').value.trim();
    if (!name) { $('catMsg').textContent = '분류 이름을 적어 주세요.'; return; }
    try { await b().catAdd(name); $('catNew').value = ''; $('catMsg').textContent = '분류를 만들었습니다.'; await refreshAfterCat(); renderCatMgr(); }
    catch (err) { $('catMsg').textContent = err.message; }
  });
  $('catList').addEventListener('click', async e => {
    const d = e.target.closest('[data-del]'), y = e.target.closest('[data-delyes]'), n = e.target.closest('[data-delno]');
    if (d) renderCatMgr(d.dataset.del);
    else if (n) renderCatMgr();
    else if (y) {
      try { const r = await b().catDel(y.dataset.delyes); if (String(S.cat) === String(y.dataset.delyes)) S.cat = 'all'; $('catMsg').textContent = '삭제했습니다.' + (r && r.moved ? ' 도면 ' + r.moved + '개는 미분류로 옮겼습니다.' : ''); await refreshAfterCat(); renderCatMgr(); }
      catch (err) { $('catMsg').textContent = err.message; renderCatMgr(); }
    }
  });
  $('docCat').addEventListener('change', async e => {
    try { await b().setCat(e.target.dataset.id, e.target.value); toast('분류를 바꿨습니다'); await refreshAfterCat(); }
    catch (err) { toast('분류를 바꾸지 못했습니다: ' + err.message, true); }
  });
}

// ==========================================================================
// 4. 도면 올리기 (전 직원): 파일 → 업무지원 통로 upload (서버 + 구글 드라이브)
// ==========================================================================
function bindUpload() {
  const dlg = $('uploadDlg');
  const msg = t => { $('upMsg').textContent = t; };
  $('btnUpload').addEventListener('click', () => {
    const b = getBridge();
    if (!b || !b.upload) return toast('이 화면에서는 올릴 수 없습니다 (업무지원 앱에서 여세요)', true);
    msg(''); $('upFile').value = ''; fillCatSelect($('upCat'), S.cat !== 'all' && S.cat !== 'none' ? S.cat : ''); dlg.showModal();
  });
  $('upCancel').addEventListener('click', () => dlg.close());
  $('upFile').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f && !$('upName').value) $('upName').value = f.name.replace(/\.dxf$/i, '');
  });
  $('upGo').addEventListener('click', async () => {
    const f = $('upFile').files[0], name = $('upName').value.trim();
    if (!f || !/\.dxf$/i.test(f.name)) return msg('.dxf 파일을 고르세요. (DWG는 CAD 변환기에서 DXF로 바꾼 뒤 올립니다)');
    if (!name) return msg('도면 이름을 적어 주세요.');
    if (f.size > 50 * 1048576) return msg('파일이 너무 큽니다 (50MB 넘음).');
    $('upGo').disabled = true; msg('올리는 중… (구글 드라이브에도 저장합니다)');
    try {
      const r = await getBridge().upload({ file: f, name, floor: $('upFloor').value.trim(), memo: $('upMemo').value.trim(), cat_id: $('upCat').value });
      dlg.close(); toast(r && r.drive === false ? '올렸습니다 (구글 드라이브 저장은 실패 — 나중에 다시 올려 주세요)' : '올렸습니다');
      $('upName').value = ''; $('upFloor').value = ''; $('upMemo').value = '';
      loadList();
    } catch (err) { msg('올리지 못했습니다: ' + err.message); }
    finally { $('upGo').disabled = false; }
  });
}

// 시작점
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  bindUpload();
  bindCats();
  loadList();
});
