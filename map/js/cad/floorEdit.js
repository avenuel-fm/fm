/* ==========================================================================
   floorEdit.js - 구역 그리기(바닥)에서 그린 바닥 고르기 · 고치기 (결정 330)
   마우스를 올리면 강조 · 누르면 선택(꼭짓점 · 변 가운데 점 · 편집창)
   꼭짓점 끌기 / 눌러 고른 뒤 클릭해 놓기 · 변 끌면 평행 이동 · 가운데 점 끌면 새 꼭짓점
   자석(매장 · 바닥 · 외벽) · Shift = 가로/세로만 · 꼭짓점 두 번 누르면 지움 · 겹치면 옆 바닥과 합치기
   놓으면 바닥 그리기와 같은 규칙으로 맞춤 (매장 관통 · 기능실 피함 · 외벽 안, 결정 316·328)
   ========================================================================== */

var feSel = null;        // 고른 바닥 id
var feHover = null;      // 마우스 올린 바닥 id
var feDrag = null;       // 끄는 중 { id, kind:'v'|'m'|'e', i, vi, start, base, orig, pts, cx, cy, moved }
var fePick = null;       // 눌러 고른 꼭짓점 — 다음 클릭에 놓음 (feDrag 와 같은 모양)
var feSnapPt = null;     // 자석으로 붙은 자리 (초록 동그라미)
var feSkipClick = false; // 끌기 뒤 따라오는 클릭은 버림
var FE_HANDLE_PX = 8;    // 손잡이 누르는 범위 (화면 px)
var feLastDown = null;   // 꼭짓점 두 번 누르기 판단 { id, i, t }

function feBase() { return typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode && currentZoneCategory === 'floor' && !(typeof isLayerLocked === 'function' && isLayerLocked('floor')); }
function feOn() { return feBase() && !drawingZonePoints.length && !isSpacePressed && !(typeof ffOn !== 'undefined' && ffOn); }   // 바닥 채우기 중엔 고르기 안 함
function feCode() { return FLOORS[currentFloorIdx].code; }
function feZones() { return getFloorZones(feCode()).filter(z => z.category === 'floor' && z.points && z.points.length >= 3); }
function feZone(id) { return id ? feZones().find(z => z.id === id) || null : null; }
function feSvgPt(e) { const r = mapContainer.getBoundingClientRect(), c = FLOORS[currentFloorIdx].crop; return { x: c.minX + (e.clientX - r.left) / scale, y: c.minY + (e.clientY - r.top) / scale }; }
function feRing(pts) { return pts.map(p => [p.x, p.y]); }
function feToPts(r) { return r.map(q => ({ x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10 })); }

// 마우스 아래 바닥 (겹치면 작은 것)
function feFloorAt(p) {
    let best = null, ba = Infinity;
    feZones().forEach(z => { if (isPointInsidePolygon(p, z.points)) { const a = ringArea(feRing(z.points)); if (a < ba) { ba = a; best = z; } } });
    return best;
}

// 손잡이 꼭짓점: 꺾인 곳만 (외벽 곡선 따라 잘린 잔점은 빼고). 점이 적으면 모두
function feCorners(P) {
    const n = P.length;
    if (n <= 12) return P.map((_, i) => i);
    return P.map((_, i) => i).filter(i => {
        const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
        const t = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
        return Math.min(t, 2 * Math.PI - t) > 12 * Math.PI / 180;
    });
}

// 고른 바닥에서 누른 것: 꼭짓점 v > 변 가운데 점 m > 변 e
function feHit(z, p) {
    const r = FE_HANDLE_PX / scale, P = z.points, n = P.length;
    for (const i of feCorners(P)) if (Math.hypot(P[i].x - p.x, P[i].y - p.y) <= r) return { kind: 'v', i };
    for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        if (Math.hypot(b.x - a.x, b.y - a.y) * scale < 40) continue;
        if (Math.hypot((a.x + b.x) / 2 - p.x, (a.y + b.y) / 2 - p.y) <= r) return { kind: 'm', i };
    }
    for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        if (Math.hypot(b.x - a.x, b.y - a.y) * scale < 20) continue;
        const q = projectPointToSegment(p, a, b);
        if (Math.hypot(q.x - p.x, q.y - p.y) <= r * 0.75) return { kind: 'e', i };
    }
    return null;
}

// 자석: 매장 · 기능실 · 다른 바닥 · 외벽의 꼭짓점 먼저, 없으면 변
function feSnap(p, skipId) {
    const r = SHAPE_SNAP_PX / scale, near = o => o.x1 >= p.x - r && o.x0 <= p.x + r && o.y1 >= p.y - r && o.y0 <= p.y + r;
    const box = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; pts.forEach(q => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }); return { x0, y0, x1, y1 }; };
    const rings = [];
    shapeSnapPolys().forEach(c => { if (c.pts.length >= 2 && near(c)) rings.push({ pts: c.pts, closed: true }); });
    getFloorZones(feCode()).forEach(z => {
        if (z.id === skipId || !z.points || z.points.length < 2 || (z.category !== 'floor' && z.category !== 'wall')) return;
        if (near(box(z.points))) rings.push({ pts: z.points, closed: z.geometry === 'polygon' });
    });
    let best = null, bd = r;
    rings.forEach(o => o.pts.forEach(q => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = { x: q.x, y: q.y }; } }));
    if (best) return best;
    rings.forEach(o => {
        const P = o.pts, m = o.closed ? P.length : P.length - 1;
        for (let i = 0; i < m; i++) { const q = projectPointToSegment(p, P[i], P[(i + 1) % P.length]), d = Math.hypot(q.x - p.x, q.y - p.y); if (d < bd) { bd = d; best = { x: q.x, y: q.y }; } }
    });
    return best;
}

// 끄는 중 모양: 변은 평행 이동, 꼭짓점은 자석 · Shift 가로/세로
function feDragPts(d, p) {
    let dx = p.x - d.start.x, dy = p.y - d.start.y;
    const P = d.orig.map(q => ({ x: q.x, y: q.y })), n = P.length;
    feSnapPt = null;
    if (d.kind === 'e') {
        const a = d.orig[d.i], b = d.orig[(d.i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, t = dx * nx + dy * ny;
        P[d.i] = { x: a.x + nx * t, y: a.y + ny * t };
        P[(d.i + 1) % n] = { x: b.x + nx * t, y: b.y + ny * t };
        return P;
    }
    if (window.isShiftKeyPressed) { if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0; }
    let q = { x: d.base.x + dx, y: d.base.y + dy };
    if (!window.isShiftKeyPressed) { const s = feSnap(q, d.id); if (s) { q = s; feSnapPt = s; } }
    P[d.vi] = q;
    return P;
}

function feStart(z, h, p, e) {
    const orig = z.points.map(q => ({ x: q.x, y: q.y }));
    const d = { id: z.id, kind: h.kind, i: h.i, start: p, cx: e.clientX, cy: e.clientY, moved: false };
    if (h.kind === 'm') { const a = orig[h.i], b = orig[(h.i + 1) % orig.length]; orig.splice(h.i + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }); d.vi = h.i + 1; }
    else if (h.kind === 'v') d.vi = h.i;
    d.orig = orig; d.pts = orig;
    if (d.vi != null) d.base = orig[d.vi];
    return d;
}

// 고친 모양 저장: 바닥 그리기와 같은 규칙으로 맞춤. force = 매장 위로 그대로
function feApply(id, pts, force) {
    const code = feCode(), zones = getFloorZones(code), i = zones.findIndex(z => z.id === id);
    if (i < 0) return;
    let rings;
    floorForcePass = !!force;
    try { rings = floorAvoidStores(clipRingsToWall([feRing(pts)], FLOOR_WALL_GAP)); }
    catch (err) { console.warn('바닥 맞추기 실패, 옮긴 그대로', err); rings = [feRing(pts)]; }
    finally { floorForcePass = false; }
    const cut = force ? [] : floorCutNames.slice();
    if (!rings.length) { showToast('옮긴 바닥이 모두 매장 안이거나 외벽 밖이라 남는 곳이 없습니다.', 2000); feRender(); return; }
    const before = JSON.parse(JSON.stringify(zones));
    pushUndoState('바닥 모양 고치기');
    rings.sort((a, b) => ringArea(b) - ringArea(a));
    const z = zones[i], nF = zones.filter(q => q.category === 'floor').length;
    const extra = rings.slice(1).map((r, k) => Object.assign({}, z, { id: z.id + '_e' + Date.now() + k, name: `바닥 ${nF + k + 1}`, points: feToPts(r) }));
    zones.splice(i, 1, Object.assign({}, z, { points: feToPts(rings[0]) }), ...extra);
    saveFloorZones(code, zones);
    renderFloorZones(code);
    syncSvgCache();
    feSel = id;
    feRender();
    if (cut.length) {
        showToastAction(`바닥을 고쳤습니다. ${[...new Set(cut)].join('·')} 자리는 비웠습니다.`, '매장 위로 그대로', () => {
            if (feCode() !== code || !feBase()) { showToast('바닥을 그리던 그대로일 때만 바꿀 수 있습니다.', 1800); return; }
            saveFloorZones(code, before);
            feApply(id, pts, true);
        }, 6000);
        return;
    }
    const ring = [feRing(zones[i].points)];
    const other = feZones().find(o => o.id !== id && polygonClipping.intersection(ring, [feRing(o.points)]).some(q => ringArea(q[0]) > 1));
    if (other) showToastAction(`바닥을 고쳤습니다. ${other.name}와 겹칩니다.`, '옆 바닥과 합치기', () => feMerge(id, other.id), 8000);
    else showToast('바닥을 고쳤습니다. (되돌리기 가능)', 1500);
}

// 두 바닥을 한 장으로
function feMerge(a, b) {
    const code = feCode(), zones = getFloorZones(code), A = zones.find(z => z.id === a), B = zones.find(z => z.id === b);
    if (!A || !B) return;
    const rs = outerRings(polygonClipping.union([feRing(A.points)], [feRing(B.points)]));
    if (rs.length !== 1) { showToast('두 바닥이 한 장으로 이어지지 않아 합치지 못했습니다.', 1800); return; }
    pushUndoState('바닥 합치기');
    saveFloorZones(code, zones.filter(z => z.id !== b).map(z => z.id === a ? Object.assign({}, z, { points: feToPts(rs[0]), cl: (A.cl || []).concat(B.cl || []) }) : z));
    renderFloorZones(code);
    syncSvgCache();
    feSel = a;
    feRender();
    showToast(`'${B.name}'을 합쳤습니다. (되돌리기 가능)`, 1500);
}

function feDeleteVertex(id, i) {
    const z = feZone(id);
    if (!z) return;
    if (z.points.length <= 3) { showToast('꼭짓점이 3개뿐이라 더 지울 수 없습니다.', 1500); return; }
    feApply(id, z.points.filter((_, k) => k !== i));
}

function feDelete() {
    const z = feZone(feSel);
    if (!z) return;
    const code = feCode();
    pushUndoState('바닥 삭제');
    saveFloorZones(code, getFloorZones(code).filter(q => q.id !== z.id));
    feSel = null;
    feHidePop();
    renderFloorZones(code);
    syncSvgCache();
    feRender();
    showToast(`'${z.name}'을 지웠습니다. (되돌리기 가능)`, 1500);
}

function feHidePop() { document.getElementById('floor-sel-pop')?.remove(); }
function feShowPop(z) {
    feHidePop();
    const pop = document.createElement('div');
    pop.id = 'floor-sel-pop';
    pop.innerHTML = `<div class="wall-seg-title"></div>`
        + '<button type="button" class="wall-seg-del" onclick="feDelete()">삭제 (Del)</button>'
        + '<button type="button" onclick="feRename()">이름 바꾸기</button>'
        + '<button type="button" onclick="feSel=null;feHidePop();feRender()">닫기 (Esc)</button>';
    pop.querySelector('.wall-seg-title').textContent = `${z.name} · 꼭짓점 ${feCorners(z.points).length}개`;
    // 바닥 아래 가운데 (손잡이를 가리지 않게). 화면 밖이면 위로
    const r = mapContainer.getBoundingClientRect(), c = FLOORS[currentFloorIdx].crop;
    const xs = z.points.map(q => r.left + (q.x - c.minX) * scale), ys = z.points.map(q => r.top + (q.y - c.minY) * scale);
    let top = Math.max(...ys) + 16;
    if (top > window.innerHeight - 150) top = Math.max(8, Math.min(...ys) - 160);
    pop.style.left = Math.max(8, Math.min((Math.min(...xs) + Math.max(...xs)) / 2 - 85, window.innerWidth - 190)) + 'px';
    pop.style.top = top + 'px';
    pop.addEventListener('click', e => e.stopPropagation());
    document.body.appendChild(pop);
}
function feRename() { const z = feZone(feSel); feHidePop(); if (z) openZoneModal(z); }

function feSelect(id, e) {
    feSel = id; feHover = null; fePick = null;
    const z = feZone(id);
    if (z) feShowPop(z);
    feRender();
}

// 강조 · 손잡이 그리기 (맨 위 층, 눌림은 받지 않음 — 누름은 좌표로 판단)
function feRender(hoverPt) {
    const svg = typeof mapContainer !== 'undefined' && mapContainer && mapContainer.querySelector('svg');
    let g = svg && svg.querySelector('#floor-edit-layer');
    if (!feBase() || !svg) {
        if (g) g.remove();
        feSel = feHover = feDrag = fePick = null;
        feHidePop();
        return;
    }
    if (feSel && !feZone(feSel)) { feSel = null; feHidePop(); }
    if (!g) { g = document.createElementNS(NS_SVG, 'g'); g.setAttribute('id', 'floor-edit-layer'); g.style.pointerEvents = 'none'; }
    svg.appendChild(g);
    g.textContent = '';
    const k = 1 / scale;
    const mk = (tag, at) => { const el = document.createElementNS(NS_SVG, tag); Object.entries(at).forEach(([a, v]) => el.setAttribute(a, v)); g.appendChild(el); return el; };
    const poly = (P, at) => mk('polygon', Object.assign({ points: P.map(p => p.x + ',' + p.y).join(' ') }, at));
    const live = feDrag && feDrag.moved ? feDrag : fePick;
    if (feHover && feHover !== feSel && !live) {
        const z = feZone(feHover);
        if (z) {
            poly(z.points, { class: 'fe-hover', fill: 'rgba(30,58,95,0.14)', stroke: '#1e3a5f', 'stroke-width': 2.5 * k });
            if (hoverPt) { const t = mk('text', { x: hoverPt.x + 10 * k, y: hoverPt.y - 10 * k, 'font-size': 12 * k, fill: '#1e3a5f', 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 * k }); t.textContent = z.name; }
        }
    }
    const s = feZone(feSel);
    if (!s) return;
    if (live) poly(s.points, { fill: 'none', stroke: '#94a3b8', 'stroke-width': 1.5 * k, 'stroke-dasharray': `${6 * k} ${4 * k}` });
    const P = live ? live.pts : s.points;
    poly(P, { class: 'fe-sel', fill: 'rgba(30,58,95,0.18)', stroke: '#1e3a5f', 'stroke-width': 3 * k });
    if (live) {
        if (live.vi != null) mk('circle', { cx: P[live.vi].x, cy: P[live.vi].y, r: 7 * k, fill: '#ea580c', stroke: '#fff', 'stroke-width': 2 * k });
        else { const n = P.length; mk('line', { x1: P[live.i].x, y1: P[live.i].y, x2: P[(live.i + 1) % n].x, y2: P[(live.i + 1) % n].y, stroke: '#ea580c', 'stroke-width': 3 * k }); }
        if (feSnapPt) mk('circle', { cx: feSnapPt.x, cy: feSnapPt.y, r: 10 * k, fill: 'none', stroke: '#10b981', 'stroke-width': 2.5 * k });
        return;
    }
    const n = P.length;
    for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        if (Math.hypot(b.x - a.x, b.y - a.y) * scale >= 40) mk('circle', { class: 'fe-mid', cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: 4 * k, fill: '#1e3a5f', opacity: 0.55 });
    }
    feCorners(P).forEach(i => mk('circle', { class: 'fe-vtx', cx: P[i].x, cy: P[i].y, r: 6 * k, fill: '#fff', stroke: '#1e3a5f', 'stroke-width': 2 * k }));
}

(function initFloorEdit() {
    if (typeof viewport === 'undefined' || !viewport) return;
    const onMap = e => viewport.contains(e.target) && !e.target.closest('.modal-overlay, .floating-controls, .drawing-guide-banner, .map-overlay-btn, #toast');

    viewport.addEventListener('pointerdown', e => {
        if (!feOn() || e.button !== 0 || !onMap(e)) return;
        const z = feZone(feSel), p = feSvgPt(e), h = z && feHit(z, p);
        // 같은 꼭짓점을 0.4초 안에 두 번 누르면 그 꼭짓점 지움
        if (h && h.kind === 'v' && feLastDown && feLastDown.id === z.id && feLastDown.i === h.i && Date.now() - feLastDown.t < 400) {
            e.stopPropagation(); e.preventDefault();
            feLastDown = null; fePick = null; feSkipClick = true; setTimeout(() => { feSkipClick = false; }, 300);
            feDeleteVertex(z.id, h.i);
            return;
        }
        feLastDown = h && h.kind === 'v' ? { id: z.id, i: h.i, t: Date.now() } : null;
        if (!h || fePick) return;
        e.stopPropagation(); e.preventDefault();
        feDrag = feStart(z, h, p, e);
        feHidePop();
        feRender();
    }, true);

    window.addEventListener('pointermove', e => {
        if (feDrag) {
            if (Math.hypot(e.clientX - feDrag.cx, e.clientY - feDrag.cy) > 3) feDrag.moved = true;
            if (feDrag.moved) { feDrag.pts = feDragPts(feDrag, feSvgPt(e)); feRender(); }
            return;
        }
        if (fePick) { fePick.pts = feDragPts(fePick, feSvgPt(e)); feRender(); return; }
        if (!feBase()) { if (feSel || feHover || document.getElementById('floor-edit-layer')) feRender(); return; }
        if (!feOn() || !onMap(e)) { if (feHover) { feHover = null; feRender(); } return; }
        const p = feSvgPt(e), z = feFloorAt(p), s = feZone(feSel), h = s && feHit(s, p);
        viewport.style.cursor = h ? (h.kind === 'e' ? 'move' : 'pointer') : (z ? 'pointer' : '');
        if ((z ? z.id : null) !== feHover || z) { feHover = z ? z.id : null; feRender(p); }
    });

    window.addEventListener('pointerup', () => {
        if (!feDrag) return;
        const d = feDrag;
        feDrag = null;
        feSkipClick = true;
        setTimeout(() => { feSkipClick = false; }, 300);
        if (d.moved) { feSnapPt = null; feApply(d.id, d.pts); }
        else if (d.vi != null) { fePick = d; showToast('놓을 곳을 클릭하세요. (Esc: 그만)', 1500); feRender(); }
        else feRender();
    });

    viewport.addEventListener('click', e => {
        if (!onMap(e)) return;
        if (feSkipClick) { feSkipClick = false; e.stopPropagation(); return; }
        if (!feOn() || (typeof e.button === 'number' && e.button !== 0)) return;
        if (typeof hasDraggedDuringInteraction !== 'undefined' && hasDraggedDuringInteraction) return;
        const p = feSvgPt(e);
        if (fePick) {
            e.stopPropagation();
            const d = fePick, pts = feDragPts(d, p);
            fePick = null; feSnapPt = null;
            if (Math.hypot(pts[d.vi].x - d.base.x, pts[d.vi].y - d.base.y) > 0.5) feApply(d.id, pts); else feRender();
            return;
        }
        if (e.shiftKey) return;   // Shift + 클릭 = 바닥 안에서도 새 바닥 첫 점
        const z = feFloorAt(p);
        if (z) { e.stopPropagation(); feSelect(z.id, e); return; }
        if (feSel) { e.stopPropagation(); feSel = null; feHidePop(); feRender(); }
    }, true);

    window.addEventListener('keydown', e => {
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || !feBase()) return;
        if (e.key === 'Escape' && (fePick || feDrag || feSel)) {
            e.stopImmediatePropagation(); e.preventDefault();
            if (fePick || feDrag) { fePick = feDrag = null; feSnapPt = null; } else { feSel = null; feHidePop(); }
            feRender();
        } else if ((e.key === 'Delete' || e.code === 'Delete') && feSel && !fePick && !feDrag) {
            e.stopImmediatePropagation(); e.preventDefault();
            feDelete();
        }
    }, true);
})();
