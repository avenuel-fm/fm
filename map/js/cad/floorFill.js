/* ==========================================================================
   floorFill.js - 바닥 채우기 (결정 334)
   「바닥 채우기」를 켜고 바닥을 누르면, 변마다 마주 보는 매장 앞 20px 까지 평행하게 넓힘
   · 매장 사이 1~5px 틈은 한 덩어리로 봄(틈으로 새지 않음)  · 매장을 가로지르는 바닥은 안 함
   · 앞에 매장이 없는 변은 그대로 · 최대 300px · 외벽이 먼저 나오면 외벽 안 5px
   · 미리 보기(주황) → 변을 눌러 끄기/켜기 → 「채우기」/「취소」
   · 「매장 따라 계단」: 매장마다 그 앞 20px 까지 계단처럼
   ========================================================================== */

var ffOn = false;     // 바닥 채우기 켬
var ffPrev = null;    // 미리 보기 { id, edges:[{ i, a, b, n, runs:[{t0,t1,d}], quads, on }] }
var ffHover = null;
var FF_GAP = 20, FF_MAX = 300, FF_GAP_IGNORE = 6;   // 매장과 띄움 · 최대 넓힘 · 이만큼 안의 틈은 무시(1~5px)

function ffActive() { return ffOn && typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode && currentZoneCategory === 'floor'; }

function toggleFloorFill(on) {
    ffOn = on === undefined ? !ffOn : !!on;
    if (ffOn && typeof isLayerLocked === 'function' && isLayerLocked('floor')) { ffOn = false; warnLayerLocked(); }
    if (ffOn) {
        drawingZonePoints = [];
        updateZoneDrawingPreview(); updateZoneGuideUI();
        if (typeof feSel !== 'undefined') { feSel = null; feHover = null; feHidePop(); feRender(); }
    }
    ffPrev = null; ffHover = null;
    ffHidePop();
    document.getElementById('btn-floor-fill')?.classList.toggle('active', ffOn);
    const w = document.getElementById('ff-step-wrap'); if (w) w.style.display = ffOn ? 'inline-flex' : 'none';
    ffRender();
    if (ffOn) showToast('채울 바닥을 누르세요. (Esc: 끄기)', 1800);
}
// 구역 그리기를 끝내거나 바닥이 아닌 종류를 고르면 끔
function ffSync() { if (ffOn && !ffActive()) toggleFloorFill(false); }

function ffSegs(pts, closed) { const s = [], m = closed ? pts.length : pts.length - 1; for (let i = 0; i < m; i++) s.push([pts[i], pts[(i + 1) % pts.length]]); return s; }
// 반직선 o + t·n 이 선분과 만나는 가장 가까운 t
function ffRayHit(o, n, segs) {
    let best = Infinity;
    for (const [a, b] of segs) {
        const ex = b.x - a.x, ey = b.y - a.y, den = n.x * ey - n.y * ex;
        if (Math.abs(den) < 1e-9) continue;
        const wx = a.x - o.x, wy = a.y - o.y, t = (wx * ey - wy * ex) / den, u = (wx * n.y - wy * n.x) / den;
        if (t > 0.01 && t < best && u >= -1e-9 && u <= 1 + 1e-9) best = t;
    }
    return best;
}
function ffLerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }

// 넓힐 변 계산. 매장을 가로지르면 { cross: 매장 이름 }
function ffCompute(z, stepped) {
    const P = z.points, n = P.length, ring = feRing(P);
    const polys = shapeSnapPolys().filter(c => c.pts.length >= 3);
    const cross = polys.find(c => !isUtilEl(c.el) && polygonClipping.intersection([ring], [feRing(c.pts)]).some(q => ringArea(q[0]) > 1));
    if (cross) return { cross: ((currentStores.find(s => s.polygonElement === cross.el) || {}).name) || '매장' };
    const storeSegs = polys.flatMap(c => ffSegs(c.pts, true));
    const wallSegs = getFloorZones(feCode()).filter(w => w.category === 'wall' && w.points && w.points.length >= 2).flatMap(w => ffSegs(w.points, w.geometry === 'polygon'));
    const edges = [];
    for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y);
        if (L < 4) continue;
        let nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
        const mid = ffLerp(a, b, 0.5);
        if (isPointInsidePolygon({ x: mid.x + nx * 0.5, y: mid.y + ny * 0.5 }, P)) { nx = -nx; ny = -ny; }   // 바깥쪽
        const nn = { x: nx, y: ny };
        const xs = [a.x, b.x, a.x + nx * FF_MAX, b.x + nx * FF_MAX], ys = [a.y, b.y, a.y + ny * FF_MAX, b.y + ny * FF_MAX];
        const bx = { x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, y0: Math.min(...ys) - 1, y1: Math.max(...ys) + 1 };
        const inBox = ([p, q]) => Math.max(p.x, q.x) >= bx.x0 && Math.min(p.x, q.x) <= bx.x1 && Math.max(p.y, q.y) >= bx.y0 && Math.min(p.y, q.y) <= bx.y1;
        const ss = storeSegs.filter(inBox), ws = wallSegs.filter(inBox);
        if (!ss.length) continue;   // 앞에 매장 없음
        const K = Math.max(2, Math.min(200, Math.ceil(L / 2)));
        const ts = [], ds = [];
        for (let k = 0; k < K; k++) {
            const t = (k + 0.5) / K, o = ffLerp(a, b, t), hs = ffRayHit(o, nn, ss);
            ts.push(t);
            ds.push(hs > FF_MAX ? null : Math.min(hs - FF_GAP, ffRayHit(o, nn, ws) - FLOOR_WALL_GAP));
        }
        if (!ds.some(d => d !== null)) continue;
        let runs;
        if (!stepped) {
            const D = Math.min(...ds.filter(d => d !== null));   // 가장 가까운 매장에 맞춤 → 틈으로 새는 점은 저절로 무시
            if (D <= 0.5) continue;
            runs = [{ t0: 0, t1: 1, d: D }];
        } else {
            // 계단: 점마다 앞 매장까지. 1~5px 틈은 옆 점들(±6px)의 최솟값으로 메움. 앞에 매장 없는 점은 0
            const w = Math.max(1, Math.ceil(FF_GAP_IGNORE / (L / K)));
            const dd = ds.map((_, k) => { let m = Infinity; for (let j = Math.max(0, k - w); j <= Math.min(K - 1, k + w); j++) if (ds[j] !== null) m = Math.min(m, ds[j]); return m === Infinity ? 0 : Math.max(0, Math.round(m * 10) / 10); });
            runs = [];
            dd.forEach((d, k) => {
                const t0 = k / K, t1 = (k + 1) / K, last = runs[runs.length - 1];
                if (last && Math.abs(last.d - d) < 0.5) last.t1 = t1; else runs.push({ t0, t1, d });
            });
            runs = runs.filter(r => r.d > 0.5);
            if (!runs.length) continue;
        }
        const quads = runs.map(r => { const p0 = ffLerp(a, b, r.t0), p1 = ffLerp(a, b, r.t1); return [p0, p1, { x: p1.x + nx * r.d, y: p1.y + ny * r.d }, { x: p0.x + nx * r.d, y: p0.y + ny * r.d }]; });
        edges.push({ i, a, b, n: nn, runs, quads, on: true });
    }
    return { edges };
}

// 켜진 변으로 넓힌 모양 (점 목록) — 모서리도 채우고, 매장 20px 안 · 외벽 밖은 뺌
function ffShape(z, edges) {
    const on = edges.filter(e => e.on);
    if (!on.length) return null;
    const P = z.points, n = P.length, byI = new Map(on.map(e => [e.i, e]));
    const parts = on.flatMap(e => e.quads.map(q => [feRing(q)]));
    on.forEach(e => {   // 이어진 두 변이 모두 넓어지면 그 사이 모서리
        const f = byI.get((e.i + 1) % n), r1 = e.runs[e.runs.length - 1], r2 = f && f.runs[0];
        if (!f || r1.t1 < 1 || r2.t0 > 0) return;
        const c = e.b, A = { x: c.x + e.n.x * r1.d, y: c.y + e.n.y * r1.d }, B = { x: c.x + f.n.x * r2.d, y: c.y + f.n.y * r2.d };
        parts.push([feRing([c, A, { x: A.x + f.n.x * r2.d, y: A.y + f.n.y * r2.d }, B])]);
    });
    let added = polygonClipping.union(...parts);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    added.forEach(poly => poly[0].forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    const cut = [];
    shapeSnapPolys().forEach(c => {
        if (c.pts.length < 3 || c.x1 < x0 - FF_GAP || c.x0 > x1 + FF_GAP || c.y1 < y0 - FF_GAP || c.y0 > y1 + FF_GAP) return;
        cut.push([feRing(c.pts)], ...edgeBands(c.pts, FF_GAP - 0.05));
    });
    if (cut.length) added = polygonClipping.difference(added, polygonClipping.union(...cut));
    let rings = outerRings(polygonClipping.union([feRing(P)], ...added.map(poly => [poly[0]])));
    try { rings = clipRingsToWall(rings, FLOOR_WALL_GAP); } catch (err) { console.warn('외벽 자르기 실패', err); }
    if (!rings.length) return null;
    return feToPts(rings.reduce((m, r) => ringArea(r) > ringArea(m) ? r : m));
}

function ffStart(z) {
    const r = ffCompute(z, !!document.getElementById('chk-ff-step')?.checked);
    if (r.cross) { ffPrev = null; ffHidePop(); ffRender(); showToast(`매장(${r.cross})을 가로지르는 바닥은 채우지 않습니다.`, 2000); return; }
    if (!r.edges.length) { ffPrev = null; ffHidePop(); ffRender(); showToast('넓힐 변이 없습니다. (앞에 매장이 없거나 이미 매장과 20px 안)', 2000); return; }
    ffPrev = { id: z.id, edges: r.edges };
    ffRender();
    ffShowPop();
}
// 「매장 따라 계단」을 바꾸면 미리 보기 다시 (끈 변은 그대로 끔)
function ffRefresh() {
    if (!ffPrev) return;
    const z = feZone(ffPrev.id), off = new Set(ffPrev.edges.filter(e => !e.on).map(e => e.i));
    if (!z) { ffCancel(); return; }
    ffStart(z);
    if (ffPrev) { ffPrev.edges.forEach(e => { if (off.has(e.i)) e.on = false; }); ffRender(); ffShowPop(); }
}

function ffApply() {
    if (!ffPrev) return;
    const id = ffPrev.id, z = feZone(id);
    if (!z) { ffCancel(); return; }
    let pts;
    try { pts = ffShape(z, ffPrev.edges); } catch (err) { console.warn('바닥 채우기 실패', err); pts = null; }
    if (!pts) { showToast('켜진 변이 없거나 채울 곳이 없습니다.', 1800); return; }
    const code = feCode(), zones = getFloorZones(code), i = zones.findIndex(q => q.id === id);
    pushUndoState('바닥 채우기');
    zones[i] = Object.assign({}, zones[i], { points: pts });
    saveFloorZones(code, zones);
    renderFloorZones(code);
    syncSvgCache();
    ffPrev = null;
    ffHidePop();
    ffRender();
    const other = feZones().find(o => o.id !== id && polygonClipping.intersection([feRing(pts)], [feRing(o.points)]).some(q => ringArea(q[0]) > 1));
    if (other) showToastAction(`바닥을 채웠습니다. ${other.name}와 겹칩니다.`, '옆 바닥과 합치기', () => feMerge(id, other.id), 8000);
    else showToast('바닥을 채웠습니다. (되돌리기 가능)', 1500);
}
function ffCancel() { ffPrev = null; ffHidePop(); ffRender(); }

function ffHidePop() { document.getElementById('floor-fill-pop')?.remove(); }
function ffShowPop() {
    ffHidePop();
    const z = ffPrev && feZone(ffPrev.id);
    if (!z) return;
    const pop = document.createElement('div');
    pop.id = 'floor-fill-pop';
    const nOn = ffPrev.edges.filter(e => e.on).length;
    pop.innerHTML = '<div class="wall-seg-title"></div><div class="ff-hint">주황 칸(변)을 누르면 끄기·켜기</div>'
        + '<button type="button" class="ff-ok" onclick="ffApply()">채우기 (Enter)</button>'
        + '<button type="button" onclick="ffCancel()">취소 (Esc)</button>';
    pop.querySelector('.wall-seg-title').textContent = `${z.name} · 넓힐 변 ${nOn}/${ffPrev.edges.length}개`;
    const r = mapContainer.getBoundingClientRect(), c = FLOORS[currentFloorIdx].crop;
    const all = z.points.concat(...ffPrev.edges.map(e => e.quads.flat()));
    const xs = all.map(q => r.left + (q.x - c.minX) * scale), ys = all.map(q => r.top + (q.y - c.minY) * scale);
    let top = Math.max(...ys) + 16;
    if (top > window.innerHeight - 150) top = Math.max(8, Math.min(...ys) - 160);
    pop.style.left = Math.max(8, Math.min((Math.min(...xs) + Math.max(...xs)) / 2 - 85, window.innerWidth - 190)) + 'px';
    pop.style.top = top + 'px';
    pop.addEventListener('click', e => e.stopPropagation());
    document.body.appendChild(pop);
}

function ffRender() {
    const svg = typeof mapContainer !== 'undefined' && mapContainer && mapContainer.querySelector('svg');
    let g = svg && svg.querySelector('#floor-fill-layer');
    if (!svg || !ffActive()) { if (g) g.remove(); return; }
    if (!g) { g = document.createElementNS(NS_SVG, 'g'); g.setAttribute('id', 'floor-fill-layer'); g.style.pointerEvents = 'none'; }
    svg.appendChild(g);
    g.textContent = '';
    const k = 1 / scale;
    const poly = (P, at) => { const el = document.createElementNS(NS_SVG, 'polygon'); el.setAttribute('points', P.map(p => p.x + ',' + p.y).join(' ')); Object.entries(at).forEach(([a, v]) => el.setAttribute(a, v)); g.appendChild(el); return el; };
    const h = !ffPrev && feZone(ffHover);
    if (h) poly(h.points, { class: 'ff-hover', fill: 'rgba(234,88,12,0.10)', stroke: '#ea580c', 'stroke-width': 2.5 * k });
    if (!ffPrev) return;
    const z = feZone(ffPrev.id);
    if (!z) return;
    let shape = null;
    try { shape = ffShape(z, ffPrev.edges); } catch (err) { shape = null; }
    if (shape) poly(shape, { class: 'ff-shape', fill: 'rgba(234,88,12,0.08)', stroke: '#ea580c', 'stroke-width': 2 * k, 'stroke-dasharray': `${7 * k} ${4 * k}` });
    ffPrev.edges.forEach(e => e.quads.forEach(q => poly(q, e.on
        ? { class: 'ff-edge on', fill: 'rgba(234,88,12,0.28)', stroke: '#ea580c', 'stroke-width': 1 * k }
        : { class: 'ff-edge off', fill: 'rgba(148,163,184,0.25)', stroke: '#94a3b8', 'stroke-width': 1 * k, 'stroke-dasharray': `${3 * k} ${3 * k}` })));
    poly(z.points, { fill: 'none', stroke: '#1e3a5f', 'stroke-width': 2.5 * k });
}

(function initFloorFill() {
    if (typeof viewport === 'undefined' || !viewport) return;
    const onMap = e => viewport.contains(e.target) && !e.target.closest('.modal-overlay, .floating-controls, .drawing-guide-banner, .map-overlay-btn, #toast');

    viewport.addEventListener('click', e => {
        if (!ffActive() || !onMap(e) || (typeof e.button === 'number' && e.button !== 0) || isSpacePressed) return;
        if (typeof hasDraggedDuringInteraction !== 'undefined' && hasDraggedDuringInteraction) return;
        e.stopPropagation();   // 채우기 중엔 점을 찍지 않음
        const p = feSvgPt(e);
        if (ffPrev) {
            const ed = ffPrev.edges.find(x => x.quads.some(q => isPointInsidePolygon(p, q)));
            if (ed) { ed.on = !ed.on; ffRender(); ffShowPop(); return; }
        }
        const z = feFloorAt(p);
        if (z) ffStart(z);
    }, true);

    window.addEventListener('pointermove', e => {
        if (!ffActive()) { if (document.getElementById('floor-fill-layer')) ffRender(); return; }
        if (!onMap(e)) return;
        const z = feFloorAt(feSvgPt(e)), id = z ? z.id : null;
        viewport.style.cursor = z ? 'pointer' : '';
        if (id !== ffHover) { ffHover = id; ffRender(); }
    });

    window.addEventListener('keydown', e => {
        if (!ffActive() || ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
        if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); if (ffPrev) ffCancel(); else toggleFloorFill(false); }
        else if (e.key === 'Enter' && ffPrev) { e.stopImmediatePropagation(); e.preventDefault(); ffApply(); }
    }, true);
})();
