// ================= 후방복도 (결정 380) =================
// 업체 도면의 회색 후방 구역(Staff area)을 기능실 도형(종류 「후방복도」)으로 만듦. 맨 아래 층(#corridor-layer)에 두고,
// 저장할 때마다 깎기 전 모양(cs.base)에서 외벽 밖과 매장·기능실 자리(둘레 1px)를 빼서 다시 그림 (cs.pathData = 깎은 모양)
var CORRIDOR_KIND = '후방복도', CORRIDOR_COLOR = '#b4bfcc', CORRIDOR_GAP = 1, CORRIDOR_MIN_AREA = 900;
var corridorSig = {};   // 층마다 마지막으로 깎은 조건 — 같으면 다시 안 깎음

function corridorFlagKey(code) { return `lotte_corridor_init_${code}${typeof getBuildingStorageSuffix === 'function' ? getBuildingStorageSuffix() : ''}`; }
function corridorCsOf(store) {
    if (!store || !store.isCustom) return null;
    return getCustomStores(FLOORS[currentFloorIdx].code).find(c => String(c.id) === String(store.id) && c.kind === CORRIDOR_KIND) || null;
}
function corridorPathD(polys) {
    return polys.map(poly => poly.map(r => 'M' + r.slice(0, r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? -1 : r.length)
        .map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z').join('')).join('');
}

// 업체 도면의 후방 구역 고리들 [{ src, ring }] — 아이콘처럼 작은 것과 지도 밖(월드타워 쪽)은 뺌
function corridorSources(svgEl, floor) {
    const els = new Set(svgEl.querySelectorAll('g[name="Staff area"] path'));
    svgEl.querySelectorAll('g[name="Staff area"]').forEach(g => {
        if (g.id) svgEl.querySelectorAll(`path[data-parent-id="${CSS.escape(g.id)}"]`).forEach(p => els.add(p));
    });
    const vb = String(floor.crop && floor.crop.viewBox || '').split(/[\s,]+/).map(Number);
    const root = svgEl.getScreenCTM();
    const out = [];
    els.forEach(el => {
        let pts = parseSvgPathPoints(el.getAttribute('d') || '');
        if (pts.length < 3) return;
        const m = root && el.getScreenCTM() ? root.inverse().multiply(el.getScreenCTM()) : null;   // 묶음 transform 까지 도면 좌표로
        if (m) pts = pts.map(p => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f }));
        const ring = pts.map(p => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
        if (ringArea(ring) < CORRIDOR_MIN_AREA) return;
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        if (vb.length === 4 && !(cx >= vb[0] && cx <= vb[0] + vb[2] && cy >= vb[1] && cy <= vb[1] + vb[3])) return;
        out.push({ src: el.id || '', ring, el });
    });
    return out;
}

// 원본 회색 구역은 숨김 (1px 간격에 회색이 비치지 않게). 고르기·자석·지우개 대상에서도 빠짐
function corridorHideSources(list) {
    list.forEach(s => { s.el.setAttribute('data-corridor-src', '1'); s.el.style.visibility = 'hidden'; s.el.classList.remove('store-polygon'); });
}

function corridorNewCs(s, id, code, keep) {
    const base = 'M' + s.ring.map(q => q[0] + ' ' + q[1]).join('L') + 'Z';
    const cx = s.ring.reduce((a, q) => a + q[0], 0) / s.ring.length, cy = s.ring.reduce((a, q) => a + q[1], 0) / s.ring.length;
    return Object.assign({ id, name: withFloorName(CORRIDOR_KIND, code), type: 'utility', fillColor: CORRIDOR_COLOR }, keep || {},
        { kind: CORRIDOR_KIND, src: s.src, base, pathData: base, x: cx, y: cy, shape: (keep && keep.shape) || `c:${id}` });
}
function corridorNextId(list) { return Math.max(90000, ...list.map(c => +c.id || 0)) + 1; }

// 층을 처음 열 때 한 번: 아베뉴엘 층에 후방복도를 만듦 (도면을 불러온 뒤, 매장 묶기 전에 부름)
function corridorInit(floor) {
    const svgEl = mapContainer.querySelector('svg');
    if (!svgEl || !floor || floor.crop !== AVENUEL_CROP) return;
    const srcs = corridorSources(svgEl, floor);
    const list = getCustomStores(floor.code), mine = list.filter(c => c.kind === CORRIDOR_KIND);
    corridorHideSources(srcs.filter(s => mine.some(c => c.src === s.src)));
    if (mapStore.readOnly() || mapStore.getItem(corridorFlagKey(floor.code))) return;
    if (!mine.length && srcs.length) {
        srcs.forEach(s => list.push(corridorNewCs(s, corridorNextId(list), floor.code)));
        saveCustomStores(floor.code, list);
        corridorHideSources(srcs);
    }
    mapStore.setItem(corridorFlagKey(floor.code), '1');
}

// 깎기: base ∩ 외벽 안 − (매장·기능실 + 둘레 1px). 외벽에 닿는 변은 외벽선에 딱 붙음
function corridorRefit(force) {
    if (typeof polygonClipping === 'undefined' || typeof currentStores === 'undefined') return false;
    const svgEl = mapContainer && mapContainer.querySelector('svg');
    if (!svgEl) return false;
    const floor = FLOORS[currentFloorIdx];
    const list = getCustomStores(floor.code), cors = list.filter(c => c.kind === CORRIDOR_KIND && c.base);
    corridorPlace(svgEl);
    if (!cors.length) return false;
    const editing = typeof shapeEdit !== 'undefined' && shapeEdit ? shapeEdit.store.polygonElement : null;
    const others = shapeSnapPolys().filter(c => c.pts.length >= 3);
    const wallSig = JSON.stringify(typeof wallZonesOf === 'function' ? wallZonesOf(floor.code).map(z => z.points) : []);
    const sig = cors.map(c => c.id + c.base + c.name).join('|') + '#' + others.map(c => c.d).join('|') + '#' + wallSig;
    if (!force && corridorSig[floor.code] === sig && cors.every(c => svgEl.querySelector(`#corridor-layer g.store-group[data-store-id="${c.id}"] path`))) return false;
    corridorSig[floor.code] = sig;
    const area = typeof wallArea === 'function' ? wallArea(0) : null;
    let changed = false;
    cors.forEach(cs => {
        const g = svgEl.querySelector(`g.store-group[data-store-id="${cs.id}"]`), p = g && g.querySelector('path');
        if (!p || p === editing) return;
        const bp = parseSvgPathPoints(cs.base);
        if (bp.length < 3) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        bp.forEach(q => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
        let res = [[bp.map(q => [q.x, q.y])]];
        try {
            if (area) res = polygonClipping.intersection(res, area);
            const cut = [], gp = CORRIDOR_GAP;
            others.forEach(c => {
                if (c.x1 < x0 - gp || c.x0 > x1 + gp || c.y1 < y0 - gp || c.y0 > y1 + gp) return;
                cut.push([c.pts.map(q => [q.x, q.y])], ...edgeBands(c.pts, gp));
            });
            if (cut.length && res.length) res = polygonClipping.difference(res, ...cut);
        } catch (err) { console.warn('후방복도 깎기 실패', err); return; }
        res = res.filter(poly => ringArea(poly[0]) > 2);
        const d = corridorPathD(res);
        p.setAttribute('fill-rule', 'evenodd');
        if (p.getAttribute('d') !== d) { p.setAttribute('d', d); changed = true; }
        if (cs.pathData !== d) { cs.pathData = d; changed = true; }
        corridorLabel(svgEl, g, cs, res);
    });
    if (changed && !mapStore.readOnly()) saveCustomStores(floor.code, list);
    currentStores.forEach(s => { if (s.isCustom && isCorridorEl(s.polygonElement)) s.pathData = s.polygonElement.getAttribute('d'); });
    return changed;
}

// 이름은 가장 큰 조각 안에 (여러 조각이라 도형 전체로 자리를 잡으면 틈에 떨어짐)
function corridorLabel(svgEl, g, cs, res) {
    const t = g.querySelector('text');
    if (!t) return;
    if (!res.length) { t.textContent = ''; return; }
    const big = res.reduce((a, poly) => ringArea(poly[0]) > ringArea(a[0]) ? poly : a);
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tmp.setAttribute('d', corridorPathD([[big[0]]]));
    svgEl.appendChild(tmp);
    try { layoutStoreLabel(t, StoreBook.show(cs.name), tmp, true); } finally { tmp.remove(); }
}

// 후방복도 묶음은 맨 아래 층으로, 아니게 된 것은 직접 그린 매장 층으로
function corridorPlace(svgEl) {
    const layer = ensureSvgLayer(svgEl, 'corridor-layer');
    svgEl.querySelectorAll('#custom-stores-top-layer > g.store-group[data-util-kind="후방복도"]').forEach(g => layer.appendChild(g));
    const top = svgEl.querySelector('#custom-stores-top-layer');
    if (top) layer.querySelectorAll(':scope > g.store-group:not([data-util-kind="후방복도"])').forEach(g => top.appendChild(g));
    return layer;
}

// 보기 체크 (화면만, 저장 안 함)
function onCorridorCheckboxChange(on) { mapContainer.classList.toggle('hide-corridor', !on); }

// 편집 메뉴 「후방복도 다시 맞추기」: 업체 회색 구역에서 다시 만들고, 겹치는 옛 후방복도의 이름·색·번호는 이어 받음
function rebuildCorridors() {
    if (typeof closeAllPopovers === 'function') closeAllPopovers();
    if (mapStore.readOnly()) return;
    if (isLayerLocked('corridor')) { warnLayerLocked(); return; }
    const svgEl = mapContainer.querySelector('svg'), floor = FLOORS[currentFloorIdx];
    if (!svgEl) return;
    const srcs = corridorSources(svgEl, floor);
    if (!srcs.length) { showToast('이 층 도면에는 후방 구역(회색)이 없습니다.', 2000); return; }
    pushUndoState('후방복도 다시 맞추기');
    const list = getCustomStores(floor.code), old = list.filter(c => c.kind === CORRIDOR_KIND), rest = list.filter(c => c.kind !== CORRIDOR_KIND);
    const used = new Set();
    let next = corridorNextId(list);
    const overlap = (a, b) => { try { return polygonClipping.intersection([a], [b]).reduce((s, poly) => s + ringArea(poly[0]), 0); } catch (e) { return 0; } };
    const ringOf = d => parseSvgPathPoints(d || '').map(q => [q.x, q.y]);
    const made = srcs.map(s => {
        let hit = old.find(c => !used.has(c) && c.src && c.src === s.src);
        if (!hit) {
            let best = 0;
            old.forEach(c => { if (used.has(c)) return; const v = overlap(s.ring, ringOf(c.base)); if (v > best) { best = v; hit = c; } });
        }
        if (hit) used.add(hit);
        const keep = hit ? { id: hit.id, name: hit.name, fillColor: hit.fillColor, shape: hit.shape, lblDx: hit.lblDx, lblDy: hit.lblDy } : null;
        return corridorNewCs(s, keep ? keep.id : next++, floor.code, keep);
    });
    old.forEach(c => { const g = svgEl.querySelector(`g.store-group[data-store-id="${c.id}"]`); if (g) g.remove(); });
    saveCustomStores(floor.code, rest.concat(made));
    corridorHideSources(srcs);
    delete corridorSig[floor.code];
    syncSvgCache();
    selectFloor(currentFloorIdx, true);
    showToast(`후방복도 ${made.length}곳을 다시 맞췄습니다.`, 1800);
}
