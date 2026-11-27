/* ==========================================================================
   wallTools.js - 외벽 경계 (결정 316)
   외벽(구역 그리기 「외벽」)은 경계 역할만: 닫힌 외벽 밖으로 도형·선이 나가지 않게 자름.
   외벽 그릴 때 자석 · 같은 도형 테두리 따라가기 · 끊긴 곳 표시 · 밖으로 나간 도형 맞추기 · 다른 층 복사
   ========================================================================== */

var WALL_JOIN_TOL = 1.5;     // 외벽 끝점끼리 이 거리(지도 단위) 안이면 이어진 것으로
var FLOOR_WALL_GAP = 5;      // 바닥은 외벽선 안쪽 5px 까지
var WALL_SNAP_PX = 14;       // 외벽 그릴 때 자석 거리 (화면 px)
var WALL_CURVE_STEP = 0.25;  // 곡선 테두리를 따라갈 때 점 간격 (지도 단위, 결정 318)
var WALL_SIMPLIFY_TOL = 0.05;
var WALL_FIT_GAP = 2;        // 「안쪽으로 맞추기」 때 매장·기능실·방화구역은 외벽선 안쪽 2px (바닥은 FLOOR_WALL_GAP)

// 점 줄이기 (더글라스-포이커). 모양이 tol 안에서 같은 점만 뺌
function wallSimplify(pts, tol) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
        const [i, j] = stack.pop();
        let bi = -1, bd = tol;
        for (let k = i + 1; k < j; k++) {
            const q = projectPointToSegment(pts[k], pts[i], pts[j]), d = Math.hypot(q.x - pts[k].x, q.y - pts[k].y);
            if (d > bd) { bd = d; bi = k; }
        }
        if (bi > 0) { keep[bi] = 1; stack.push([i, bi], [bi, j]); }
    }
    return pts.filter((p, i) => keep[i]);
}

// 곡선이 있는 매장 path → 곧은 변은 꼭짓점만, 곡선은 WALL_CURVE_STEP 간격 점 (null = 곡선 없음)
var wallDenseCache = new WeakMap();
function wallDensePts(el) {
    const d = el.getAttribute('d') || '';
    if (!/[CcSsQqTtAa]/.test(d)) return null;
    const c = wallDenseCache.get(el);
    if (c && c.d === d) return c.pts;
    const segs = d.match(/[A-Za-z][^A-Za-z]*/g) || [];
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    (el.parentNode || mapContainer.querySelector('svg')).appendChild(tmp);
    const pts = [];
    try {
        let prefix = '', cum = 0, step = WALL_CURVE_STEP;
        const total = el.getTotalLength();
        if (total / step > 40000) step = total / 40000;   // shortcut: 아주 큰 곡선 도형은 점 4만 개로 제한
        for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (/^[Mm]/.test(s) && i > 0) break;   // 첫 고리만 (매장 도형은 한 고리)
            prefix += s;
            tmp.setAttribute('d', prefix);
            const L = tmp.getTotalLength(), at = t => { const p = tmp.getPointAtLength(t); return { x: p.x, y: p.y }; };
            if (i === 0) { pts.push(at(0)); cum = L; continue; }
            if (/^[CcSsQqTtAa]/.test(s)) { const m = Math.ceil((L - cum) / step); for (let j = 1; j < m; j++) pts.push(at(cum + (L - cum) * j / m)); }   // 고르게 나눠 간격 ≤ step
            if (L > cum + 1e-6) pts.push(at(L));
            cum = L;
        }
    } finally { tmp.remove(); }
    const f = pts[0], l = pts[pts.length - 1];
    if (pts.length > 2 && Math.hypot(f.x - l.x, f.y - l.y) < 0.01) pts.pop();
    wallDenseCache.set(el, { d, pts });
    return pts;
}

function wallFloorCode() { return FLOORS[currentFloorIdx].code; }
function wallZonesOf(code) { return getFloorZones(code).filter(z => z.category === 'wall' && z.points && z.points.length >= 2); }

// 외벽 선들을 끝점끼리 이어 → { rings: 닫힌 고리들, open: 아직 열린 줄들 }
function wallChains(code) {
    const eq = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= WALL_JOIN_TOL;
    const rings = [];
    let open = [];
    wallZonesOf(code || wallFloorCode()).forEach(z => {
        const pts = z.points.map(p => ({ x: p.x, y: p.y }));
        if (z.geometry === 'polygon' && pts.length >= 3) rings.push(pts); else open.push(pts);
    });
    for (let changed = true; changed;) {
        changed = false;
        for (let i = 0; i < open.length && !changed; i++) {
            const a = open[i];
            if (a.length >= 4 && eq(a[0], a[a.length - 1])) { rings.push(a.slice(0, -1)); open.splice(i, 1); changed = true; break; }
            for (let j = i + 1; j < open.length; j++) {
                const b = open[j], ae = a[a.length - 1], be = b[b.length - 1];
                let m = null;
                if (eq(ae, b[0])) m = a.concat(b.slice(1));
                else if (eq(ae, be)) m = a.concat(b.slice(0, -1).reverse());
                else if (eq(a[0], be)) m = b.concat(a.slice(1));
                else if (eq(a[0], b[0])) m = b.slice().reverse().concat(a.slice(1));
                if (m) { open[i] = m; open.splice(j, 1); changed = true; break; }
            }
        }
    }
    return { rings, open };
}

// 닫힌 외벽 안쪽 (polygonClipping 여러 면) 또는 null. gap 이 있으면 그만큼 안쪽으로 줄인 것
function wallArea(gap, code) {
    if (typeof polygonClipping === 'undefined') return null;
    const raw = wallChains(code).rings;
    if (!raw.length) return null;
    // 곡선 0.25 점은 0.05 안에서 줄여 계산 (모양 차이 0.05 이하). 계산 도구가 실패하면 조금 덜 촘촘하게 다시
    for (const tol of [WALL_SIMPLIFY_TOL, 0.1, 0.2]) {
        try {
            const rings = raw.map(r => wallSimplify(r, tol));
            let area = polygonClipping.union(...rings.map(r => [r.map(p => [p.x, p.y])]));
            if (gap) {
                const cut = [];
                rings.forEach(r => cut.push(...edgeBands(r, gap)));
                area = polygonClipping.difference(area, polygonClipping.union(...cut));   // 띠를 먼저 합쳐야 곡선에서 안 깨짐
            }
            return area;
        } catch (err) { console.warn('외벽 경계 계산 다시', tol, err); }
    }
    return null;
}

// 그린 면들을 외벽 안으로 자름 (rings: [[x,y],...] 목록). 외벽이 없거나 안 닫혔으면 그대로
function clipRingsToWall(rings, gap) {
    const area = wallArea(gap);
    if (!area || !rings.length) return rings;
    return outerRings(polygonClipping.intersection(rings.map(r => [r]), area));
}

function wallInside(pt, area) { return area.some(poly => isPointInsidePolygon(pt, poly[0].map(q => ({ x: q[0], y: q[1] })))); }
function wallEdges(area) {
    const segs = [];
    area.forEach(poly => poly.forEach(r => { for (let i = 0; i < r.length - 1; i++) segs.push([{ x: r[i][0], y: r[i][1] }, { x: r[i + 1][0], y: r[i + 1][1] }]); }));
    return segs;
}
function segCross(p, q, a, b) {   // 선분 p→q 와 a→b 가 만나는 p→q 위의 비율 t, 없으면 null
    const rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den, u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

// 선(제연구획 등)을 외벽 안 부분만 남김 → 가장 긴 조각 (외벽이 없으면 그대로)
function clipPolylineToWall(pts, gap) {
    const area = wallArea(gap || 0);
    if (!area || pts.length < 2) return pts;
    const edges = wallEdges(area), pieces = [];
    let cur = [];
    for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1];
        const ts = [0, 1];
        edges.forEach(([a, b]) => { const t = segCross(p, q, a, b); if (t !== null) ts.push(t); });
        ts.sort((x, y) => x - y);
        const at = t => ({ x: Math.round((p.x + (q.x - p.x) * t) * 10) / 10, y: Math.round((p.y + (q.y - p.y) * t) * 10) / 10 });
        for (let k = 0; k < ts.length - 1; k++) {
            if (ts[k + 1] - ts[k] < 1e-9) continue;
            const inside = wallInside(at((ts[k] + ts[k + 1]) / 2), area);
            if (inside) { if (!cur.length) cur.push(at(ts[k])); cur.push(at(ts[k + 1])); }
            else if (cur.length) { pieces.push(cur); cur = []; }
        }
    }
    if (cur.length) pieces.push(cur);
    const len = l => l.reduce((a, p, i) => i ? a + Math.hypot(p.x - l[i - 1].x, p.y - l[i - 1].y) : 0, 0);
    return pieces.filter(l => l.length >= 2).reduce((a, l) => (!a || len(l) > len(a) ? l : a), null) || [];
}

// ================= 외벽 그릴 때 자석 · 테두리 따라가기 =================
var lastWallSnap = null;   // 바로 앞에 찍은 점이 붙은 테두리 (따라가기용)

function wallOutlines() {
    const out = shapeSnapPolys().filter(c => c.pts.length >= 3).map(c => ({ key: c.el, pts: wallDensePts(c.el) || c.pts, closed: true }));
    getFloorZones(wallFloorCode()).forEach(z => {
        if (!z.points || z.points.length < 2) return;
        if (z.category === 'floor' && z.points.length >= 3) out.push({ key: 'z:' + z.id, pts: z.points, closed: true });
        if (z.category === 'wall') out.push({ key: 'w:' + z.id, pts: z.points, closed: z.geometry === 'polygon' });
    });
    if (typeof drawingZonePoints !== 'undefined' && drawingZonePoints.length >= 2) out.push({ key: 'cur', pts: drawingZonePoints.slice(), closed: false });
    return out;
}

// 가까운 테두리에 붙기 (꼭짓점 먼저, 그다음 변) → { x, y, isSnapped, key, pts, closed, pos(꼭짓점 번호 + 변 위 비율) } 또는 null
function wallSnap(x, y) {
    if (window.isShiftKeyPressed) return null;   // Shift = 자석 끄고 곧게
    const R = WALL_SNAP_PX / (typeof scale !== 'undefined' && scale ? scale : 1);
    const outs = wallOutlines();
    let best = null, bd = R;
    outs.forEach(o => o.pts.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { x: p.x, y: p.y, o, pos: i }; } }));
    if (!best) {
        bd = R;
        outs.forEach(o => {
            const n = o.closed ? o.pts.length : o.pts.length - 1;
            for (let i = 0; i < n; i++) {
                const a = o.pts[i], b = o.pts[(i + 1) % o.pts.length], q = projectPointToSegment({ x, y }, a, b), d = Math.hypot(q.x - x, q.y - y);
                if (d < bd) { bd = d; const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; best = { x: q.x, y: q.y, o, pos: i + Math.hypot(q.x - a.x, q.y - a.y) / L }; }
            }
        });
    }
    if (!best) return null;
    return { x: Math.round(best.x * 100) / 100, y: Math.round(best.y * 100) / 100, isSnapped: true, key: best.o.key, pts: best.o.pts, closed: best.o.closed, pos: best.pos };
}

// 같은 테두리 위 두 점 사이 꼭짓점들 (짧은 쪽). 곡선은 잘게 찍힌 점이라 그대로 같은 곡률
function wallTraceBetween(a, b) {
    if (!a || !b || a.key !== b.key || a.key === 'cur') return [];
    const P = a.pts, n = P.length, pa = a.pos, pb = b.pos;
    const walk = dir => {
        const pts = [];
        if (a.closed) {
            const span = dir > 0 ? ((pb - pa) % n + n) % n : ((pa - pb) % n + n) % n;
            for (let k = dir > 0 ? Math.floor(pa) + 1 : Math.ceil(pa) - 1, g = 0; g <= n; g++, k += dir) {
                const off = dir > 0 ? ((k - pa) % n + n) % n : ((pa - k) % n + n) % n;
                if (off >= span - 1e-9) break;
                pts.push(P[((k % n) + n) % n]);
            }
        } else if (dir > 0 ? pb > pa : pb < pa) {
            for (let k = dir > 0 ? Math.floor(pa) + 1 : Math.ceil(pa) - 1; dir > 0 ? k < pb - 1e-9 : k > pb + 1e-9; k += dir) pts.push(P[k]);
        } else return null;
        let len = 0, prev = a;
        pts.concat([b]).forEach(p => { len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; });
        return { pts, len };
    };
    const f = walk(1), r = walk(-1);
    const pick = !f ? r : !r ? f : (f.len <= r.len ? f : r);
    // t: 따라간 점 (직접 찍은 점이 아님) — 구간 삭제·꼭짓점 손잡이는 직접 찍은 점 기준. 0.01 단위로 남겨 0.25 간격 유지
    return pick ? pick.pts.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, t: 1 })) : [];
}

// ================= 외벽 바뀐 뒤 검사: 끊긴 곳 · 밖으로 나간 도형 =================
function wallGaps(open) {
    if (!open.length) return [];
    const left = open.map(c => c.slice()), chain = left.shift(), gaps = [];
    let end = chain[chain.length - 1];
    while (left.length) {
        let bi = 0, rev = false, bd = Infinity;
        left.forEach((c, i) => {
            const d0 = Math.hypot(c[0].x - end.x, c[0].y - end.y), d1 = Math.hypot(c[c.length - 1].x - end.x, c[c.length - 1].y - end.y);
            if (d0 < bd) { bd = d0; bi = i; rev = false; }
            if (d1 < bd) { bd = d1; bi = i; rev = true; }
        });
        const c = left.splice(bi, 1)[0], s = rev ? c.slice().reverse() : c;
        gaps.push([end, s[0]]);
        end = s[s.length - 1];
    }
    gaps.push([end, chain[0]]);
    return gaps.filter(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) > WALL_JOIN_TOL);
}

function showWallGaps(gaps) {
    const svgEl = mapContainer?.querySelector('svg');
    if (!svgEl) return;
    svgEl.querySelector('#wall-gap-mark')?.remove();
    const ns = 'http://www.w3.org/2000/svg', k = 1 / (typeof scale !== 'undefined' && scale ? scale : 1);
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('id', 'wall-gap-mark');
    g.style.pointerEvents = 'none';
    const mk = (tag, at) => { const e = document.createElementNS(ns, tag); Object.entries(at).forEach(([n, v]) => e.setAttribute(n, v)); g.appendChild(e); };
    gaps.forEach(([a, b]) => {
        mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#dc2626', 'stroke-width': 3 * k, 'stroke-dasharray': `${8 * k} ${5 * k}` });
        [a, b].forEach(p => mk('circle', { cx: p.x, cy: p.y, r: 9 * k, fill: 'rgba(220,38,38,.15)', stroke: '#dc2626', 'stroke-width': 2 * k }));
    });
    svgEl.appendChild(g);
    setTimeout(() => g.remove(), 8000);
}

function showWallBar(html) {
    let bar = document.getElementById('wall-check-bar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'wall-check-bar'; document.body.appendChild(bar); }
    bar.innerHTML = html + '<button type="button" class="wall-bar-x" onclick="hideWallBar()" aria-label="닫기">✕</button>';
    bar.style.display = 'flex';
    clearTimeout(showWallBar.t);
    showWallBar.t = setTimeout(hideWallBar, 12000);
}
function hideWallBar() { const b = document.getElementById('wall-check-bar'); if (b) b.style.display = 'none'; }

// 외벽을 그리거나 고친 뒤 부름
function afterWallChange() {
    const { rings, open } = wallChains();
    if (open.length) {
        const gaps = wallGaps(open);
        if (gaps.length) {
            showWallGaps(gaps);
            showWallBar(`<span>외벽이 닫히지 않았습니다 (끊긴 곳 ${gaps.length}). 닫힐 때까지 경계로 쓰지 않습니다.</span><button type="button" class="wall-bar-btn" onclick="closeWallGaps()">이어 닫기</button>`);
            return;
        }
    }
    if (!rings.length) return;
    const outs = shapesOutsideWall();
    if (!outs.length) { hideWallBar(); return; }
    flashOutside(outs);
    showWallBar(`<span>외벽 밖으로 나간 도형 ${outs.length}개</span><button type="button" class="wall-bar-btn" onclick="fitShapesInsideWall()">안쪽으로 맞추기</button>`);
}

function closeWallGaps() {
    const gaps = wallGaps(wallChains().open);
    hideWallBar();
    if (!gaps.length) return;
    pushUndoState('외벽 이어 닫기');
    const code = wallFloorCode(), zones = getFloorZones(code);
    gaps.forEach(([a, b], i) => zones.push({ id: 'zone_' + Date.now() + '_g' + i, name: '외벽', category: 'wall', geometry: 'line', points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }], createdAt: Date.now() }));
    saveFloorZones(code, zones);
    renderFloorZones(code);
    syncSvgCache();
    showToast(`끊긴 곳 ${gaps.length}개를 이어 외벽을 닫았습니다.`, 1800);
    afterWallChange();
}

// 직접 그린 매장·기능실, 바닥, 방화구역·제연구획 중 외벽 밖으로 나간 것 → [{ kind, id, store?, zone? }]
function shapesOutsideWall() {
    const area = wallArea(0), inset = wallArea(FLOOR_WALL_GAP);
    if (!area) return [];
    const outside = (pts, a) => pts.length >= 3 && polygonClipping.difference([pts.map(p => [p.x, p.y])], a).some(p => ringArea(p[0]) > 1);
    const res = [];
    currentStores.filter(s => s.isCustom && s.polygonElement).forEach(s => {
        if (outside(parseSvgPathPoints(s.polygonElement.getAttribute('d')), area)) res.push({ kind: 'store', id: s.id, store: s });
    });
    getFloorZones(wallFloorCode()).forEach(z => {
        if (!z.points) return;
        if (z.category === 'floor' && outside(z.points, inset)) res.push({ kind: 'zone', id: z.id, zone: z });
        else if (z.category === 'fire' && z.geometry === 'polygon' && outside(z.points, area)) res.push({ kind: 'zone', id: z.id, zone: z });
        else if ((z.category === 'smoke' || z.category === 'fire') && z.geometry !== 'polygon' && z.points.length >= 2) {
            const c = clipPolylineToWall(z.points);
            if (c.length !== z.points.length || c.some((p, i) => Math.hypot(p.x - z.points[i].x, p.y - z.points[i].y) > 0.5)) res.push({ kind: 'zone', id: z.id, zone: z });
        }
    });
    return res;
}

function flashOutside(outs) {
    const svgEl = mapContainer?.querySelector('svg');
    if (!svgEl) return;
    const els = [];
    outs.forEach(o => {
        if (o.store) els.push(o.store.polygonElement);
        else svgEl.querySelectorAll(`.user-floor-line[data-zone-id="${o.id}"], .safety-zone-item[data-zone-id="${o.id}"]`).forEach(e => els.push(e));
    });
    els.forEach(e => e && e.classList.add('wall-outside-flash'));
    setTimeout(() => els.forEach(e => e && e.classList.remove('wall-outside-flash')), 8000);
}

function fitShapesInsideWall() {
    hideWallBar();
    const outs = shapesOutsideWall();
    if (!outs.length) return;
    pushUndoState('외벽 안쪽으로 맞추기');
    const code = wallFloorCode(), zones = getFloorZones(code), toPts = r => r.map(q => ({ x: Math.round(q[0] * 100) / 100, y: Math.round(q[1] * 100) / 100 }));
    let n = 0, skip = 0;
    outs.forEach(o => {
        if (o.store) {
            const rs = clipRingsToWall([(wallDensePts(o.store.polygonElement) || parseSvgPathPoints(o.store.polygonElement.getAttribute('d'))).map(p => [p.x, p.y])], WALL_FIT_GAP);
            if (!rs.length) { skip++; return; }
            const big = rs.reduce((a, r) => ringArea(r) > ringArea(a) ? r : a);
            o.store.polygonElement.setAttribute('d', pointsToPathD(toPts(big)));
            persistCustomShape(o.store.polygonElement);
            shapeRelabel(o.store, true);
            n++;
            return;
        }
        const i = zones.findIndex(z => z.id === o.id);
        if (i < 0) return;
        const z = zones[i];
        if (z.geometry === 'polygon') {
            const rs = clipRingsToWall([z.points.map(p => [p.x, p.y])], z.category === 'floor' ? FLOOR_WALL_GAP : WALL_FIT_GAP);
            if (!rs.length) { skip++; return; }
            zones.splice(i, 1, ...rs.map((r, k) => Object.assign({}, z, { id: z.id + (k ? '_w' + k : ''), points: toPts(r) })));
        } else {
            const c = clipPolylineToWall(z.points, WALL_FIT_GAP);
            if (c.length < 2) { skip++; return; }
            z.points = c;
        }
        n++;
    });
    saveFloorZones(code, zones);
    renderFloorZones(code);
    syncSvgCache();
    showToast(`${n}개를 외벽 안쪽으로 맞췄습니다.` + (skip ? ` (모두 밖인 ${skip}개는 그대로)` : ''), 2200);
}

// ================= 외벽 구간 삭제 (결정 318) =================
// 구간 = 직접 찍은 점(t 없는 점) 사이. 따라간 곡선은 한 구간
var wallSel = null;   // { id, k }

function wallAnchors(z) {
    const P = z.points, a = [];
    P.forEach((p, i) => { if (!p.t) a.push(i); });
    if (a[0] !== 0) a.unshift(0);
    if (z.geometry !== 'polygon' && a[a.length - 1] !== P.length - 1) a.push(P.length - 1);
    return a;
}
// k 번째 구간의 점들
function wallSegPts(z, k) {
    const P = z.points, A = wallAnchors(z), n = P.length;
    const s = A[k], e = k + 1 < A.length ? A[k + 1] : n;   // 면(닫힌 외벽)의 마지막 구간은 첫 점으로
    const out = [];
    for (let i = s; i <= e; i++) out.push(P[i % n]);
    return out;
}
function wallSegCount(z) { const A = wallAnchors(z); return z.geometry === 'polygon' ? A.length : A.length - 1; }

function wallSegAt(z, x, y) {
    let best = 0, bd = Infinity;
    for (let k = 0; k < wallSegCount(z); k++) {
        const S = wallSegPts(z, k);
        for (let i = 0; i < S.length - 1; i++) {
            const q = projectPointToSegment({ x, y }, S[i], S[i + 1]), d = Math.hypot(q.x - x, q.y - y);
            if (d < bd) { bd = d; best = k; }
        }
    }
    return best;
}

function hideWallSegSel() {
    wallSel = null;
    document.getElementById('wall-seg-pop')?.remove();
    mapContainer?.querySelector('#wall-seg-mark')?.remove();
}

// 외벽 그리기 중 외벽을 누르면: 그 구간을 빨갛게 + 작은 편집창
function selectWallSegment(z, x, y, clientX, clientY) {
    hideWallSegSel();
    const k = wallSegAt(z, x, y);
    wallSel = { id: z.id, k };
    const svgEl = mapContainer?.querySelector('svg');
    if (svgEl) {
        const m = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        m.setAttribute('id', 'wall-seg-mark');
        m.setAttribute('points', wallSegPts(z, k).map(p => p.x + ',' + p.y).join(' '));
        m.setAttribute('fill', 'none');
        m.setAttribute('stroke', '#dc2626');
        m.setAttribute('stroke-width', 7 / (scale || 1));
        m.setAttribute('stroke-linecap', 'round');
        m.style.pointerEvents = 'none';
        svgEl.appendChild(m);
    }
    const pop = document.createElement('div');
    pop.id = 'wall-seg-pop';
    pop.innerHTML = '<div class="wall-seg-title">외벽 구간</div>'
        + '<button type="button" class="wall-seg-del" onclick="deleteWallSegment()">이 구간 삭제 (Del)</button>'
        + '<button type="button" onclick="deleteWallWhole()">선 전체 삭제</button>'
        + '<button type="button" class="wall-bar-x" onclick="hideWallSegSel()" aria-label="닫기">✕</button>';
    pop.style.left = Math.min(clientX + 12, window.innerWidth - 190) + 'px';
    pop.style.top = Math.min(clientY + 12, window.innerHeight - 120) + 'px';
    document.body.appendChild(pop);
}

function wallDeleteDone(code, zones, msg) {
    saveFloorZones(code, zones);
    hideWallSegSel();
    if (typeof deselectWallZone === 'function') deselectWallZone();
    renderFloorZones(code);
    syncSvgCache();
    showToast(msg, 1500);
    afterWallChange();
}

function deleteWallSegment() {
    if (!wallSel) return;
    if (isLayerLocked('wall')) { warnLayerLocked(); return; }
    const code = wallFloorCode(), zones = getFloorZones(code), i = zones.findIndex(z => z.id === wallSel.id);
    if (i < 0) { hideWallSegSel(); return; }
    const z = zones[i], P = z.points, A = wallAnchors(z), k = wallSel.k, n = P.length;
    pushUndoState('외벽 구간 삭제');
    let parts;
    if (z.geometry === 'polygon') {   // 닫힌 외벽: 그 구간만 빼고 한 줄로 (끝 → 처음 이어서)
        const s = k + 1 < A.length ? A[k + 1] : 0, line = [];
        for (let j = s; ; j = (j + 1) % n) { line.push(P[j]); if (j === A[k]) break; }
        parts = [line];
    } else parts = [P.slice(0, A[k] + 1), P.slice(A[k + 1])];
    parts = parts.filter(p => p.length >= 2);
    zones.splice(i, 1, ...parts.map((p, j) => Object.assign({}, z, { id: z.id + (j ? '_s' + Date.now() : ''), geometry: 'line', points: p })));
    wallDeleteDone(code, zones, '외벽 구간을 지웠습니다. (되돌리기 가능)');
}

function deleteWallWhole() {
    if (!wallSel) return;
    if (isLayerLocked('wall')) { warnLayerLocked(); return; }
    const code = wallFloorCode(), id = wallSel.id;
    pushUndoState('외벽 삭제');
    wallDeleteDone(code, getFloorZones(code).filter(z => z.id !== id), '외벽 선을 지웠습니다. (되돌리기 가능)');
}

// ================= 외벽 다른 층에 복사 =================
function openWallCopy() {
    const code = wallFloorCode();
    if (!wallZonesOf(code).length) { showToast('이 층에 그린 외벽이 없습니다.', 1500); return; }
    const opts = FLOORS.filter(f => f.code !== code).map(f => `<label class="wall-copy-opt"><input type="checkbox" value="${f.code}">${f.name || f.code}</label>`).join('');
    showWallBar(`<span>외벽을 복사할 층:</span>${opts}<button type="button" class="wall-bar-btn" onclick="copyWallToFloors()">복사</button>`);
    clearTimeout(showWallBar.t);
}

function copyWallToFloors() {
    const targets = Array.from(document.querySelectorAll('#wall-check-bar .wall-copy-opt input:checked')).map(i => i.value);
    if (!targets.length) { showToast('복사할 층을 골라 주세요.', 1500); return; }
    // 되돌리기는 지금 층만 기억하고 외벽은 지울 수 없음 → 한 번 묻기
    if (!confirm(`외벽을 ${targets.length}개 층에 복사합니다. 외벽은 지울 수 없어 되돌릴 수 없습니다. 복사할까요?`)) return;
    hideWallBar();
    const src = wallZonesOf(wallFloorCode()), key = z => JSON.stringify(z.points.map(p => [Math.round(p.x), Math.round(p.y)]));
    let n = 0;
    targets.forEach(code => {
        const zones = getFloorZones(code), have = new Set(zones.filter(z => z.category === 'wall').map(key));
        src.forEach((z, i) => {
            if (have.has(key(z))) return;
            zones.push(Object.assign({}, z, { id: 'zone_' + Date.now() + '_c' + code + i, points: z.points.map(p => ({ x: p.x, y: p.y })), createdAt: Date.now() }));
            n++;
        });
        saveFloorZones(code, zones);
    });
    showToast(n ? `외벽 ${n}개를 ${targets.length}개 층에 복사했습니다.` : '고른 층에 같은 외벽이 이미 있습니다.', 2000);
}
