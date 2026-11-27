/* ==========================================================================
   floorFill.js - 바닥 채우기 (결정 334 → 348)
   「바닥 채우기」를 켜고 바닥을 누르면, 변의 자리마다 마주 보는 매장까지 재서
   매장 테두리와 「매장 간격」(기본 20px)만큼 떨어진 선까지 채움 — 사선 매장 앞은 사선으로
   · 매장 사이 1~5px 틈은 한 덩어리로 봄(틈으로 새지 않음)  · 매장을 가로지르는 바닥은 안 함
   · 앞에 매장이 없는 자리는 그대로 · 최대 300px · 외벽이 먼저 나오면 외벽 안 5px
   · 폭 10px 보다 가는 조각·돌기는 지움, 거의 한 줄인 꼭짓점은 합침
   · 미리 보기(주황) → 변을 눌러 끄기/켜기 → 「채우기」/「취소」 · Shift+클릭으로 여러 바닥 함께
   ========================================================================== */

var ffOn = false;     // 바닥 채우기 켬
var ffPrev = null;    // 미리 보기 { items:[{ id, edges:[{ i, n, polys, dmax, on }] }] }
var ffHover = null;
var FF_MAX = 300, FF_GAP_IGNORE = 6, FF_THIN = 5;   // 최대 넓힘 · 이만큼 안의 틈은 무시(1~5px) · 이 2배보다 가는 조각은 지움
var FF_GAP_KEY = 'map_ff_gap', FF_LEAK = 15;   // 옆 자리보다 이만큼 넘게 깊으면 틈으로 샌 것

function ffActive() { return ffOn && typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode && currentZoneCategory === 'floor'; }
// 매장 간격(px): 칸 값, 없으면 기억한 값, 없으면 20
function ffGap() {
    const v = parseFloat(document.getElementById('ff-gap')?.value);
    return Number.isFinite(v) && v >= 1 ? Math.min(v, 100) : 20;
}
function ffGapChanged() {
    try { localStorage.setItem(FF_GAP_KEY, String(ffGap())); } catch (e) { /* 이 기기만 기억 */ }
    ffRefresh();
}

function toggleFloorFill(on) {
    ffOn = on === undefined ? !ffOn : !!on;
    if (ffOn && typeof isLayerLocked === 'function' && isLayerLocked('floor')) { ffOn = false; warnLayerLocked(); }
    if (ffOn) {
        drawingZonePoints = [];
        updateZoneDrawingPreview(); updateZoneGuideUI();
        if (typeof feSel !== 'undefined') { feSel = null; feHover = null; feHidePop(); feRender(); }
        const inp = document.getElementById('ff-gap');
        if (inp && !inp.dataset.loaded) { try { const v = localStorage.getItem(FF_GAP_KEY); if (v) inp.value = v; } catch (e) { /* 기본 20 */ } inp.dataset.loaded = '1'; }
    }
    ffPrev = null; ffHover = null;
    ffHidePop();
    document.getElementById('btn-floor-fill')?.classList.toggle('active', ffOn);
    const w = document.getElementById('ff-gap-wrap'); if (w) w.style.display = ffOn ? 'inline-flex' : 'none';
    ffRender();
    if (ffOn) showToast('채울 바닥을 누르세요. Shift+클릭: 여러 바닥 (Esc: 끄기)', 1800);
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
function ffName(el) { return ((currentStores.find(s => s.polygonElement === el) || {}).name) || '매장'; }

// 넓힐 변 계산. 매장을 가로지르면 { cross: 매장 이름 }
// 변의 자리(약 2px)마다 앞 매장까지 재고, 그 자리 앞 ±6px 의 가장 가까운 값으로 틈(1~5px)을 메움
function ffCompute(z, gap) {
    const P = z.points, n = P.length, ring = feRing(P);
    const polys = shapeSnapPolys().filter(c => c.pts.length >= 3);
    const cross = polys.find(c => !isUtilEl(c.el) && polygonClipping.intersection([ring], [feRing(c.pts)]).some(q => ringArea(q[0]) > 1));
    if (cross) return { cross: ffName(cross.el) };
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
        const K = Math.max(2, Math.min(300, Math.ceil(L / 2)));
        const ds = [];
        for (let k = 0; k < K; k++) {
            const o = ffLerp(a, b, (k + 0.5) / K), hs = ffRayHit(o, nn, ss);
            ds.push(hs > FF_MAX ? null : Math.min(hs - gap, ffRayHit(o, nn, ws) - FLOOR_WALL_GAP));
        }
        if (!ds.some(d => d !== null)) continue;
        const w = Math.max(1, Math.ceil(FF_GAP_IGNORE / (L / K)));
        // 틈으로 샌 자리(옆보다 15px 넘게 깊음)·매장 없는 자리만 옆 값으로 — 사선은 제 값 그대로
        const dd = ds.map((d, k) => {
            let m = Infinity;
            for (let j = Math.max(0, k - w); j <= Math.min(K - 1, k + w); j++) if (ds[j] !== null) m = Math.min(m, ds[j]);
            if (m === Infinity) return 0;
            return Math.max(0, d === null || d - m > FF_LEAK ? m : d);
        });
        // 변 끝 10px 안에서 끊기면 끝까지 이어 붙임 (바닥 모서리에 작은 턱이 안 생기게)
        const step = L / K, firstK = dd.findIndex(d => d > 0.5), lastK = dd.length - 1 - [...dd].reverse().findIndex(d => d > 0.5);
        if (firstK > 0 && firstK * step <= 10) for (let k = 0; k < firstK; k++) dd[k] = dd[firstK];
        if (firstK >= 0 && lastK < K - 1 && (K - 1 - lastK) * step <= 10) for (let k = lastK + 1; k < K; k++) dd[k] = dd[lastK];
        // 넓어지는 자리끼리 이어 한 덩어리 (점은 자리 가운데, 양 끝은 그 자리 끝) → 사선 앞은 사선
        const out = [];
        let run = null;
        dd.forEach((d, k) => {
            if (d > 0.5) {
                const t = (k + 0.5) / K, p = ffLerp(a, b, t);
                if (!run) { const p0 = ffLerp(a, b, k / K); run = { base0: p0, tips: [{ x: p0.x + nx * d, y: p0.y + ny * d }] }; }
                run.tips.push({ x: p.x + nx * d, y: p.y + ny * d });
                run.last = { k, d };
            } else if (run) { out.push(ffRunPoly(a, b, K, nx, ny, run)); run = null; }
        });
        if (run) out.push(ffRunPoly(a, b, K, nx, ny, run));
        if (!out.length) continue;
        edges.push({ i, n: nn, polys: out, dmax: Math.max(...dd), on: true });
    }
    return { edges };
}
function ffRunPoly(a, b, K, nx, ny, run) {
    const p1 = ffLerp(a, b, (run.last.k + 1) / K), d = run.last.d;
    return [run.base0, ...run.tips, { x: p1.x + nx * d, y: p1.y + ny * d }, p1];
}

// 가는 조각·돌기 지우기: 5px 깎았다가 5px 다시 붙임(원래 모양 안에서만)
function ffOpen(mp) {
    if (!mp.length) return mp;
    const bands = m => m.flatMap(poly => poly.flatMap(r => edgeBands(r.slice(0, -1).map(([x, y]) => ({ x, y })), FF_THIN)));
    // 깎을 땐 변 띠만 (꼭짓점 네모까지 쓰면 사선 변이 더 깎여 간격이 커짐)
    const strips = m => m.flatMap(poly => poly.flatMap(r => { const out = []; for (let i = 0; i < r.length - 1; i++) { const [px, py] = r[i], [qx, qy] = r[i + 1], L = Math.hypot(qx - px, qy - py); if (L < 1e-6) continue; const nx = -(qy - py) / L * FF_THIN, ny = (qx - px) / L * FF_THIN; out.push([[[px + nx, py + ny], [qx + nx, qy + ny], [qx - nx, qy - ny], [px - nx, py - ny]]]); } return out; }));
    try {
        const b1 = strips(mp);
        const eroded = b1.length ? polygonClipping.difference(mp, polygonClipping.union(...b1)) : mp;
        if (!eroded.length) return [];
        const grown = polygonClipping.union(eroded, ...bands(eroded));
        return polygonClipping.intersection(grown, mp);
    } catch (err) { console.warn('가는 조각 정리 실패, 그대로', err); return mp; }
}
// 거의 한 줄인 꼭짓점·겹친 점 합치기
function ffSimplify(r) {
    let pts = r.slice();
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    let changed = true;
    while (changed && pts.length > 3) {
        changed = false;
        for (let i = 0; i < pts.length && pts.length > 3; i++) {
            const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], s = pts[(i + 1) % pts.length];
            const L = Math.hypot(s[0] - p[0], s[1] - p[1]);
            const dist = L < 1e-9 ? Math.hypot(q[0] - p[0], q[1] - p[1]) : Math.abs((s[0] - p[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (s[1] - p[1])) / L;
            if (dist < 0.05) { pts.splice(i, 1); changed = true; i--; }   // 아주 작게: 여러 번 지워도 모양이 밀리지 않게
        }
    }
    return pts;
}

// 켜진 변으로 넓힌 모양 (점 목록) — 모서리도 채우고, 매장 간격 안 · 외벽 밖 · 가는 조각은 뺌
function ffShape(z, edges, gap) {
    const on = edges.filter(e => e.on);
    if (!on.length) return null;
    const P = z.points, n = P.length, byI = new Map(on.map(e => [e.i, e]));
    const parts = on.flatMap(e => e.polys.map(q => [feRing(q)]));
    on.forEach(e => {   // 이어진 두 변이 모두 꼭짓점까지 넓어지면 그 사이 모서리
        const f = byI.get((e.i + 1) % n);
        if (!f) return;
        const pe = e.polys[e.polys.length - 1], pf = f.polys[0], c = P[(e.i + 1) % n];
        const A = pe[pe.length - 2], B = pf[1];
        if (Math.hypot(pe[pe.length - 1].x - c.x, pe[pe.length - 1].y - c.y) > 0.5 || Math.hypot(pf[0].x - c.x, pf[0].y - c.y) > 0.5) return;
        const db = Math.hypot(B.x - c.x, B.y - c.y);
        parts.push([feRing([c, A, { x: A.x + f.n.x * db, y: A.y + f.n.y * db }, B])]);
    });
    let added = polygonClipping.union(...parts);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    added.forEach(poly => poly[0].forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    const cut = [];
    shapeSnapPolys().forEach(c => {
        if (c.pts.length < 3 || c.x1 < x0 - gap || c.x0 > x1 + gap || c.y1 < y0 - gap || c.y0 > y1 + gap) return;
        cut.push([feRing(c.pts)], ...edgeBands(c.pts, gap - 0.05));
    });
    if (cut.length) added = polygonClipping.difference(added, polygonClipping.union(...cut));
    added = polygonClipping.difference(added, [feRing(P)]);   // 넓힌 부분만 보고 가는 조각 정리
    added = ffOpen(added);
    let rings = outerRings(polygonClipping.union([feRing(P)], ...added.map(poly => [poly[0]])));
    try { rings = clipRingsToWall(rings, FLOOR_WALL_GAP); } catch (err) { console.warn('외벽 자르기 실패', err); }
    if (!rings.length) return null;
    const best = rings.reduce((m, r) => ringArea(r) > ringArea(m) ? r : m);
    return feToPts(ffSimplify(best));
}

function ffItem(id) { return ffPrev && ffPrev.items.find(it => it.id === id); }
// 바닥 하나를 미리 보기에 넣음 (add: Shift — 있으면 빼고 없으면 더함)
function ffStart(z, add) {
    const gap = ffGap();
    if (add && ffItem(z.id)) {
        ffPrev.items = ffPrev.items.filter(it => it.id !== z.id);
        if (!ffPrev.items.length) ffPrev = null;
        ffRender(); ffShowPop(); return;
    }
    const r = ffCompute(z, gap);
    const keep = add && ffPrev ? ffPrev.items : [];
    if (r.cross) { showToast(`매장(${r.cross})을 가로지르는 바닥은 채우지 않습니다.`, 2000); if (!add) { ffPrev = null; ffHidePop(); ffRender(); } return; }
    if (!r.edges.length) { showToast(`넓힐 곳이 없습니다. (앞에 매장이 없거나 이미 매장과 ${gap}px 안)`, 2000); if (!add) { ffPrev = null; ffHidePop(); ffRender(); } return; }
    ffPrev = { items: keep.concat([{ id: z.id, edges: r.edges }]) };
    ffRender();
    ffShowPop();
}
// 간격을 바꾸면 미리 보기 다시 (끈 변은 그대로 끔)
function ffRefresh() {
    if (!ffPrev) return;
    const gap = ffGap(), items = [];
    ffPrev.items.forEach(it => {
        const z = feZone(it.id);
        if (!z) return;
        const off = new Set(it.edges.filter(e => !e.on).map(e => e.i));
        const r = ffCompute(z, gap);
        if (r.cross || !r.edges.length) return;
        r.edges.forEach(e => { if (off.has(e.i)) e.on = false; });
        items.push({ id: it.id, edges: r.edges });
    });
    ffPrev = items.length ? { items } : null;
    if (!ffPrev) ffHidePop();
    ffRender();
    if (ffPrev) ffShowPop();
}

function ffApply() {
    if (!ffPrev) return;
    const gap = ffGap(), code = feCode(), zones = getFloorZones(code), done = [];
    ffPrev.items.forEach(it => {
        const z = feZone(it.id), i = zones.findIndex(q => q.id === it.id);
        if (!z || i < 0) return;
        let pts = null;
        try { pts = ffShape(z, it.edges, gap); } catch (err) { console.warn('바닥 채우기 실패', err); }
        if (!pts) return;
        if (!done.length) pushUndoState('바닥 채우기');
        zones[i] = Object.assign({}, zones[i], { points: pts });
        done.push(it.id);
    });
    if (!done.length) { showToast('켜진 변이 없거나 채울 곳이 없습니다.', 1800); return; }
    saveFloorZones(code, zones);
    renderFloorZones(code);
    syncSvgCache();
    ffPrev = null;
    ffHidePop();
    ffRender();
    // 넓힌 바닥과 겹치는 바닥 (넓힌 바닥끼리 포함)
    const all = feZones(), hit = new Set();
    done.forEach(id => {
        const a = all.find(q => q.id === id);
        all.forEach(o => { if (o.id !== id && polygonClipping.intersection([feRing(a.points)], [feRing(o.points)]).some(q => ringArea(q[0]) > 1)) { hit.add(id); hit.add(o.id); } });
    });
    const msg = done.length > 1 ? `바닥 ${done.length}개를 채웠습니다.` : '바닥을 채웠습니다.';
    if (hit.size) showToastAction(`${msg} 겹친 바닥 ${hit.size}개가 있습니다.`, `겹친 바닥 ${hit.size}개 합치기`, () => ffMergeAll([...hit]), 8000);
    else showToast(msg + ' (되돌리기 가능)', 1500);
}
// 겹친 바닥들을 이어진 덩어리마다 한 장으로 (되돌리기 한 번)
function ffMergeAll(ids) {
    const code = feCode(), zones = getFloorZones(code);
    let groups = ids.map(id => zones.find(z => z.id === id)).filter(Boolean).map(z => ({ ids: [z.id], ring: feRing(z.points), cl: z.cl || [] }));
    let merged = true;
    while (merged) {
        merged = false;
        outer: for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
            if (!polygonClipping.intersection([groups[i].ring], [groups[j].ring]).some(q => ringArea(q[0]) > 1)) continue;
            const rs = outerRings(polygonClipping.union([groups[i].ring], [groups[j].ring]));
            if (rs.length !== 1) continue;
            groups[i] = { ids: groups[i].ids.concat(groups[j].ids), ring: rs[0], cl: groups[i].cl.concat(groups[j].cl) };
            groups.splice(j, 1);
            merged = true;
            break outer;
        }
    }
    groups = groups.filter(g => g.ids.length > 1);
    if (!groups.length) { showToast('한 장으로 이어지는 바닥이 없어 합치지 못했습니다.', 1800); return; }
    pushUndoState('바닥 합치기');
    const drop = new Set(groups.flatMap(g => g.ids.slice(1)));
    const keep = new Map(groups.map(g => [g.ids[0], g]));
    saveFloorZones(code, zones.filter(z => !drop.has(z.id)).map(z => keep.has(z.id) ? Object.assign({}, z, { points: feToPts(keep.get(z.id).ring), cl: keep.get(z.id).cl }) : z));
    renderFloorZones(code);
    syncSvgCache();
    showToast(`바닥 ${drop.size + groups.length}개를 ${groups.length}장으로 합쳤습니다. (되돌리기 가능)`, 1800);
}
function ffCancel() { ffPrev = null; ffHidePop(); ffRender(); }

function ffHidePop() { document.getElementById('floor-fill-pop')?.remove(); }
function ffShowPop() {
    ffHidePop();
    if (!ffPrev) return;
    const zs = ffPrev.items.map(it => feZone(it.id)).filter(Boolean);
    if (!zs.length) return;
    const pop = document.createElement('div');
    pop.id = 'floor-fill-pop';
    const edges = ffPrev.items.flatMap(it => it.edges), nOn = edges.filter(e => e.on).length;
    pop.innerHTML = '<div class="wall-seg-title"></div><div class="ff-hint">주황 칸(변)을 누르면 끄기·켜기<br>Shift+클릭: 바닥 더하기·빼기</div>'
        + '<button type="button" class="ff-ok" onclick="ffApply()">채우기 (Enter)</button>'
        + '<button type="button" onclick="ffCancel()">취소 (Esc)</button>';
    pop.querySelector('.wall-seg-title').textContent = (zs.length > 1 ? `바닥 ${zs.length}개` : zs[0].name) + ` · 넓힐 변 ${nOn}/${edges.length}개`;
    const r = mapContainer.getBoundingClientRect(), c = FLOORS[currentFloorIdx].crop;
    const all = zs.flatMap(z => z.points).concat(...edges.map(e => e.polys.flat()));
    const xs = all.map(q => r.left + (q.x - c.minX) * scale), ys = all.map(q => r.top + (q.y - c.minY) * scale);
    let top = Math.max(...ys) + 16;
    if (top > window.innerHeight - 170) top = Math.max(8, Math.min(...ys) - 180);
    pop.style.left = Math.max(8, Math.min((Math.min(...xs) + Math.max(...xs)) / 2 - 90, window.innerWidth - 200)) + 'px';
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
    const h = feZone(ffHover);
    if (h && !ffItem(h.id)) poly(h.points, { class: 'ff-hover', fill: 'rgba(234,88,12,0.10)', stroke: '#ea580c', 'stroke-width': 2.5 * k });
    if (!ffPrev) return;
    const gap = ffGap();
    ffPrev.items.forEach(it => {
        const z = feZone(it.id);
        if (!z) return;
        let shape = null;
        try { shape = ffShape(z, it.edges, gap); } catch (err) { shape = null; }
        if (shape) poly(shape, { class: 'ff-shape', fill: 'rgba(234,88,12,0.10)', stroke: '#ea580c', 'stroke-width': 2 * k, 'stroke-dasharray': `${7 * k} ${4 * k}` });
        it.edges.forEach(e => e.polys.forEach(q => poly(q, e.on
            ? { class: 'ff-edge on', fill: 'rgba(234,88,12,0.22)', stroke: 'none' }
            : { class: 'ff-edge off', fill: 'rgba(148,163,184,0.25)', stroke: '#94a3b8', 'stroke-width': 1 * k, 'stroke-dasharray': `${3 * k} ${3 * k}` })));
        poly(z.points, { fill: 'none', stroke: '#1e3a5f', 'stroke-width': 2.5 * k });
    });
}

(function initFloorFill() {
    if (typeof viewport === 'undefined' || !viewport) return;
    const onMap = e => viewport.contains(e.target) && !e.target.closest('.modal-overlay, .floating-controls, .drawing-guide-banner, .map-overlay-btn, #toast');

    viewport.addEventListener('click', e => {
        if (!ffActive() || !onMap(e) || (typeof e.button === 'number' && e.button !== 0) || isSpacePressed) return;
        if (typeof hasDraggedDuringInteraction !== 'undefined' && hasDraggedDuringInteraction) return;
        e.stopPropagation();   // 채우기 중엔 점을 찍지 않음
        const p = feSvgPt(e), shift = e.shiftKey || !!window.isShiftKeyPressed;
        if (ffPrev && !shift) {
            const ed = ffPrev.items.flatMap(it => it.edges).find(x => x.polys.some(q => isPointInsidePolygon(p, q)));
            if (ed) { ed.on = !ed.on; ffRender(); ffShowPop(); return; }
        }
        const z = feFloorAt(p);
        if (z) ffStart(z, shift && !!ffPrev);
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
