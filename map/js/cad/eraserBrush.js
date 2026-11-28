/* ==========================================================================
   eraserBrush.js - 동그라미 지우개 (결정 374, 전: 면을 그려 지우던 지우개 결정 216)
   누른 채 문지르면 회색으로 칠해지고, 놓으면 바닥색(흰색)이 됨.
   칠이 매장·기능실 도형이나 매장 연결선에 걸리면 빨갛게 깜빡이고, 놓을 때 「삭제하시겠습니까?」 창에서 골라 지움.
   한 번 되돌리기로 칠과 지운 것이 함께 돌아옴.
   ========================================================================== */

var EB_SIZES = [10, 20, 40];   // 화면 지름(px). [ ] 키로 바꿈
var ebSizeIdx = 1;
var ebStroke = null;           // { pts: [화면 점], targets, hits: Set, poly }
var ebPending = null;          // 놓은 뒤 확인 창을 기다리는 칠

// 「매장·기능실 잠금」: 켜면 지우개가 매장·기능실 도형을 건드리지 않음 (연결선만). 처음엔 켜짐, 이 기기에 기억 (결정 374)
var ebLock = (function () { try { return localStorage.getItem('map_eraser_lock') !== '0'; } catch (e) { return true; } })();
function ebLockChanged(on) {
    ebLock = !!on;
    try { localStorage.setItem('map_eraser_lock', ebLock ? '1' : '0'); } catch (e) { /* 기억 못 해도 됨 */ }
    showToast(ebLock ? '매장·기능실은 지우개에 안 걸립니다.' : '매장·기능실도 지우개에 걸립니다.', 1200);
}
(function () { const c = document.getElementById('chk-eraser-lock'); if (c) c.checked = ebLock; })();

function ebOn() { return typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode && currentZoneCategory === 'erase' && !mapStore.readOnly(); }
function ebDiam() { return EB_SIZES[ebSizeIdx]; }
function ebSvg() { return mapContainer && mapContainer.querySelector('svg'); }
function ebMapPt(p) { const r = mapContainer.getBoundingClientRect(), c = FLOORS[currentFloorIdx].crop; return { x: c.minX + (p.x - r.left) / scale, y: c.minY + (p.y - r.top) / scale }; }
function ebOnMap(e) { return viewport.contains(e.target) && !e.target.closest('.modal-overlay, .floating-controls, .drawing-guide-banner, .map-overlay-btn, #toast, #erase-confirm'); }

// 화면 좌표로 바꾼 점들
function ebScreenPts(el, pts) {
    const m = el.getScreenCTM();
    if (!m) return [];
    return pts.map(q => ({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f }));
}
function ebSegDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function ebNearLine(p, pts, r, closed) {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) if (ebSegDist(p, pts[i], pts[(i + 1) % pts.length]) <= r) return true;
    return false;
}

// 지울 수 있는 것: 매장·기능실 도형(지울 수 없는 매장 빼고), 매장 연결선 (잠긴 레이어 빼고)
function ebTargets() {
    const out = [], floor = FLOORS[currentFloorIdx];
    if (!ebLock) (typeof currentStores !== 'undefined' ? currentStores : []).forEach(s => {
        const p = s.polygonElement;
        if (!p || !p.isConnected || isImmutableStore(s.name)) return;
        const kind = isCorridorEl(p) ? 'corridor' : s.type === 'utility' ? 'utility' : 'store';   // 후방복도 열쇠 (결정 380)
        if (typeof isLayerLocked === 'function' && isLayerLocked(kind)) return;
        const pts = ebScreenPts(p, shapePts(p));
        if (pts.length >= 3) out.push({ key: 's:' + (s.id || s.name), kind, store: s, el: p, pts, label: StoreBook.show(s.name) });
    });
    const lines = getFloorUtilityLines(floor.code);
    mapContainer.querySelectorAll('#utility-lines-layer .util-line-item-group').forEach(g => {
        const pl = g.querySelector('.util-feeder-line'), line = lines.find(l => l.id === g.getAttribute('data-id'));
        if (!pl || !line || (typeof isLayerLocked === 'function' && isLayerLocked(line.subType || 'power'))) return;
        const pts = ebScreenPts(pl, Array.from(pl.points || []).map(q => ({ x: q.x, y: q.y })));
        if (pts.length >= 2) out.push({ key: 'l:' + line.id, kind: 'line', line, el: pl, pts, label: `${line.sourceName || '매장'} → ${line.targetName || '기능실'} (${line.subTypeLabel || '설비'})` });
    });
    return out;
}
// 닫힌 외벽 안인지 (외벽이 없으면 어디든 됨). area = wallArea(0) 결과 [[[x,y]...]...]
function ebInWall(p) {
    const a = ebStroke.area;
    if (!a) return true;
    const q = ebMapPt(p);
    let n = 0;
    a.forEach(poly => poly.forEach(r => { if (isPointInsidePolygon(q, r.map(([x, y]) => ({ x, y })))) n++; }));
    return n % 2 === 1;
}
function ebHitTest(p) {
    if (!ebInWall(p)) return;   // 외벽 밖은 못 지움 (결정 376)
    const r = ebDiam() / 2;
    ebStroke.targets.forEach(t => {
        if (ebStroke.hits.has(t)) return;
        const hit = t.kind === 'line' ? ebNearLine(p, t.pts, r + 2, false) : (isPointInsidePolygon(p, t.pts) || ebNearLine(p, t.pts, r, true));
        if (hit) { ebStroke.hits.add(t); t.el.classList.add('erase-hit'); }
    });
}

// 칠 (회색 → 놓으면 흰색). 지도 단위 굵기 = 화면 지름 / 배율
function ebDrawPoly() {
    const svg = ebSvg();
    if (!svg || !ebStroke) return;
    let g = svg.querySelector('#eraser-temp-layer');
    if (!g) { g = document.createElementNS(NS_SVG, 'g'); g.setAttribute('id', 'eraser-temp-layer'); g.setAttribute('pointer-events', 'none'); }
    svg.appendChild(g);   // 늘 맨 위
    if (!ebStroke.poly) {
        const pl = document.createElementNS(NS_SVG, 'polyline');
        Object.entries({ fill: 'none', stroke: '#94a3b8', 'stroke-opacity': '0.75', 'stroke-width': ebDiam() / scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }).forEach(([n, v]) => pl.setAttribute(n, v));
        g.appendChild(pl); ebStroke.poly = pl;
    }
    const pts = ebStroke.pts.map(ebMapPt);
    if (pts.length === 1) pts.push({ x: pts[0].x + 0.01, y: pts[0].y });   // 한 번 콕 눌러도 동그라미로
    ebStroke.poly.setAttribute('points', pts.map(q => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' '));
}
function ebClearTemp() {
    ebSvg()?.querySelector('#eraser-temp-layer')?.remove();
    mapContainer.querySelectorAll('.erase-hit').forEach(el => el.classList.remove('erase-hit'));
}

// 동그라미 커서
function ebCursor(e) {
    let c = document.getElementById('eraser-cursor');
    const show = e && ebOn() && ebOnMap(e) && !ebPending && !isSpacePressed;
    if (!show) { if (c) c.style.display = 'none'; return; }
    if (!c) { c = document.createElement('div'); c.id = 'eraser-cursor'; document.body.appendChild(c); }
    const d = ebDiam();
    Object.assign(c.style, { display: 'block', width: d + 'px', height: d + 'px', left: (e.clientX - d / 2) + 'px', top: (e.clientY - d / 2) + 'px' });
    c.classList.toggle('down', !!ebStroke);
}

// 지우개 켜짐: 연결선을 모두 보이게(이름표는 숨김), 마우스 화살표 대신 동그라미
function ebSync() {
    const on = ebOn();
    document.body.classList.toggle('eraser-brush', on);
    const layer = mapContainer?.querySelector('#utility-lines-layer');
    if (on && layer) layer.querySelectorAll('.util-line-item-group').forEach(g => {
        g.style.display = '';
        const b = g.querySelector('.util-spec-badge-group'); if (b) b.style.display = 'none';
    });
    else if (!on && layer && document.body.dataset.ebLines && typeof clearUtilityLineHighlight === 'function') clearUtilityLineHighlight();
    if (on) document.body.dataset.ebLines = '1'; else delete document.body.dataset.ebLines;
    if (!on) { ebCursor(null); if (ebStroke) { ebStroke = null; ebClearTemp(); } }
}

function ebFinish() {
    const st = ebStroke;
    ebStroke = null;
    if (!st || !st.poly) { ebClearTemp(); return; }
    st.poly.setAttribute('stroke', '#ffffff');
    st.poly.setAttribute('stroke-opacity', '1');
    const zone = {
        id: 'zone_' + Date.now(), category: 'erase', geometry: 'stroke', createdAt: Date.now(),
        w: Math.round(ebDiam() / scale * 10) / 10,
        keep: eraserKeepKeys().join(','),   // 지금 열쇠로 잠긴 레이어는 이 칠에 안 지워짐 (나중에 풀어도 그대로)
        points: (st.pts.length > 1 ? st.pts : [st.pts[0], { x: st.pts[0].x + 0.01, y: st.pts[0].y }]).map(ebMapPt).map(q => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 }))
    };
    const hits = Array.from(st.hits);
    if (!hits.length) { ebCommit(zone, []); return; }
    ebAsk(zone, hits);
}

// 「삭제하시겠습니까?」 — 걸린 것 모두 체크된 채로, 확인 = 체크한 것만 지움, 취소 = 칠까지 없앰
function ebAsk(zone, hits) {
    ebPending = { zone, hits };
    ebCursor(null);
    const name = { store: '매장', utility: '기능실', line: '연결선' };
    const box = document.createElement('div');
    box.id = 'erase-confirm';
    box.innerHTML = `<div class="ec-card" role="dialog" aria-modal="true" aria-labelledby="ec-title">
        <div class="ec-title" id="ec-title">삭제하시겠습니까?</div>
        <div class="ec-sub">지우개에 걸린 항목입니다. 체크한 것만 지웁니다.</div>
        <div class="ec-list"></div>
        <div class="ec-btns"><button type="button" class="ec-cancel">취소</button><button type="button" class="ec-ok">확인</button></div></div>`;
    const list = box.querySelector('.ec-list');
    hits.forEach((t, i) => {
        const row = document.createElement('label');
        row.className = 'ec-row';
        row.innerHTML = `<input type="checkbox" checked data-i="${i}"><span class="ec-kind ec-${t.kind}"></span><span class="ec-name"></span>`;
        row.querySelector('.ec-kind').textContent = name[t.kind];
        row.querySelector('.ec-name').textContent = t.label;
        row.querySelector('input').onchange = ev => t.el.classList.toggle('erase-hit', ev.target.checked);
        list.appendChild(row);
    });
    const close = () => { box.remove(); document.removeEventListener('keydown', key, true); ebPending = null; };
    const cancel = () => { close(); ebClearTemp(); showToast('지우개 칠을 취소했습니다.', 1200); };
    const ok = () => { const pick = hits.filter((t, i) => box.querySelector(`input[data-i="${i}"]`).checked); close(); ebCommit(zone, pick); };
    const key = ev => {
        if (ev.key === 'Escape') { ev.stopImmediatePropagation(); ev.preventDefault(); cancel(); }
        else if (ev.key === 'Enter') { ev.stopImmediatePropagation(); ev.preventDefault(); ok(); }
    };
    box.querySelector('.ec-cancel').onclick = cancel;
    box.querySelector('.ec-ok').onclick = ok;
    ['mousedown', 'click', 'dblclick', 'wheel'].forEach(t => box.addEventListener(t, e => e.stopPropagation()));
    document.addEventListener('keydown', key, true);
    document.body.appendChild(box);
    box.querySelector('.ec-ok').focus();
}

// 칠 저장 + 고른 것 지우기 (되돌리기 한 번)
function ebCommit(zone, pick) {
    const floor = FLOORS[currentFloorIdx];
    pushUndoState('지우개');
    const zones = getFloorZones(floor.code);
    zone.name = `지우개 ${zones.filter(z => z.category === 'erase').length + 1}`;
    zones.push(zone);
    saveFloorZones(floor.code, zones);
    const stores = pick.filter(t => t.kind !== 'line'), lineIds = new Set(pick.filter(t => t.kind === 'line').map(t => t.line.id));
    stores.forEach(t => removeStoreShape(t.store));
    if (lineIds.size) {
        saveFloorUtilityLines(floor.code, getFloorUtilityLines(floor.code).filter(l => !lineIds.has(l.id)));
        if (lineIds.has(activeSelectedUtilLineId)) activeSelectedUtilLineId = null;
    }
    ebClearTemp();
    renderFloorZones(floor.code);
    if (lineIds.size && typeof renderFloorUtilityLines === 'function') renderFloorUtilityLines();
    if (stores.length) renderStoreList(currentStores);
    syncSvgCache();
    ebSync();
    if (pick.length) showToast(`${pick.length}개를 지웠습니다. (되돌리기로 칠과 함께 돌아옴)`, 1800);
}

(function initEraserBrush() {
    if (typeof viewport === 'undefined' || !viewport) return;
    // 지도 끌기·점 찍기보다 먼저 받음
    window.addEventListener('mousedown', e => {
        if (!ebOn() || e.button !== 0 || !ebOnMap(e) || ebPending || isSpacePressed) return;
        e.stopPropagation(); e.preventDefault();
        const area = typeof wallArea === 'function' ? wallArea(0) : null;
        ebStroke = { pts: [{ x: e.clientX, y: e.clientY }], targets: ebTargets(), hits: new Set(), poly: null, area: area && area.length ? area : null };
        ebHitTest(ebStroke.pts[0]);
        ebDrawPoly();
        ebCursor(e);
    }, true);
    window.addEventListener('mousemove', e => {
        ebCursor(e);
        if (!ebStroke) return;
        const last = ebStroke.pts[ebStroke.pts.length - 1];
        let p = { x: e.clientX, y: e.clientY };
        if (e.shiftKey) {   // Shift: 누른 곳부터 가로·세로로만 (결정 376)
            const a = ebStroke.anchor = ebStroke.anchor || last;
            p = Math.abs(p.x - a.x) >= Math.abs(p.y - a.y) ? { x: p.x, y: a.y } : { x: a.x, y: p.y };
        } else ebStroke.anchor = null;
        const d = Math.hypot(p.x - last.x, p.y - last.y), step = Math.max(1, ebDiam() / 4);
        if (d < 1) return;
        for (let s = step; s < d; s += step) ebHitTest({ x: last.x + (p.x - last.x) * s / d, y: last.y + (p.y - last.y) * s / d });   // 빠르게 문질러도 사이를 놓치지 않게
        ebHitTest(p);
        ebStroke.pts.push(p);
        ebDrawPoly();
    }, true);
    window.addEventListener('mouseup', e => {
        if (!ebStroke) return;
        e.stopPropagation();
        ebFinish();
        ebCursor(e);
    }, true);
    ['click', 'dblclick'].forEach(t => window.addEventListener(t, e => {
        if (ebOn() && ebOnMap(e) && !isSpacePressed) { e.stopPropagation(); e.preventDefault(); }   // 지우개 중엔 점 찍기·도형 고르기 안 함
    }, true));
    window.addEventListener('keydown', e => {
        if (!ebOn() || ebPending || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
        if (e.key === '[' || e.key === ']') {
            e.preventDefault();
            ebSizeIdx = Math.max(0, Math.min(EB_SIZES.length - 1, ebSizeIdx + (e.key === ']' ? 1 : -1)));
            const c = document.getElementById('eraser-cursor');
            if (c && c.style.display !== 'none') {
                const r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, d = ebDiam();
                Object.assign(c.style, { width: d + 'px', height: d + 'px', left: (cx - d / 2) + 'px', top: (cy - d / 2) + 'px' });
            }
            showToast(`지우개 크기 ${ebDiam()}px`, 900);
        }
    });
})();
