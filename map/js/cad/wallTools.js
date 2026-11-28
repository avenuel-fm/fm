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

// ================= 새로 그린 외벽을 닿은 기존 외벽과 한 선으로 합침 (결정 368) =================
var WALL_TAIL_MAX = 0.25;   // 선 안쪽에 닿아 자를 때 짧은 쪽이 전체의 이 비율 이하면 꼬리로 보고 지움 (더 길면 갈래라 따로 남김)
function wallLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return s; }
function wallDedupe(pts) { return pts.filter((p, i) => !i || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 0.05); }
// 점 p 가 선 pts 위(끝 포함)면 그 자리에서 잘라 [p 까지, p 부터], 아니면 null
function wallCutAt(pts, p) {
    let best = null;
    for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
        const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
        const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
        if (d <= WALL_JOIN_TOL && (!best || d < best.d)) best = { i, d };
    }
    if (!best) return null;
    const q = { x: p.x, y: p.y };
    return [wallDedupe(pts.slice(0, best.i + 1).concat([q])), wallDedupe([q].concat(pts.slice(best.i + 1)))];
}
// zones(그 층 구역 목록)를 고쳐 가며 새 선 pts 의 양 끝을 기존 열린 외벽에 붙임 → { points, id(합친 기존 외벽 id), tails(지운 꼬리 수) }
function wallMergeNew(zones, pts) {
    let line = pts.map(p => Object.assign({}, p)), id = null, tails = 0;   // 따라간 점 표시(t) 등은 그대로
    const attach = atStart => {
        const p = atStart ? line[0] : line[line.length - 1];
        for (let k = 0; k < zones.length; k++) {
            const z = zones[k];
            if (z.category !== 'wall' || z.geometry === 'polygon' || !z.points || z.points.length < 2) continue;
            const cut = wallCutAt(z.points, p);
            if (!cut) continue;
            const la = wallLen(cut[0]), lb = wallLen(cut[1]), short = Math.min(la, lb);
            let keep = la >= lb ? cut[0] : cut[1];
            const drop = la >= lb ? cut[1] : cut[0];
            zones.splice(k, 1);
            if (short > WALL_JOIN_TOL) {
                if (short <= (la + lb) * WALL_TAIL_MAX) tails++;
                else zones.push(Object.assign({}, z, { id: z.id + '_b' + Date.now(), points: drop }));   // 갈래: 짧은 쪽도 길면 따로 남김
            }
            const dp = q => Math.hypot(q.x - p.x, q.y - p.y);
            if (atStart) { if (dp(keep[0]) < dp(keep[keep.length - 1])) keep = keep.slice().reverse(); line = keep.slice(0, -1).concat(line); }   // keep 이 p 로 끝나게
            else { if (dp(keep[keep.length - 1]) < dp(keep[0])) keep = keep.slice().reverse(); line = line.concat(keep.slice(1)); }
            id = id || z.id;
            return;
        }
    };
    attach(true);
    attach(false);
    return { points: wallDedupe(line), id, tails };
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

// 업체 도면 선 (건물 외곽선 · 이름 없는 업체 면) — 자석·따라가기만, 경계로는 안 씀 (결정 320)
var wallVendorCache = new WeakMap();
function wallVendorOutlines() {
    const svgEl = mapContainer && mapContainer.querySelector('svg');
    if (!svgEl) return [];
    const els = svgEl.querySelectorAll('path.building-exterior-wall:not(.user-drawn-wall), [id^="shapeLayer"] path:not(.store-polygon)');
    const out = [];
    els.forEach(el => {
        if (el.closest('#safety-zones-layer, .safety-zone-item')) return;
        const d = el.getAttribute('d') || '';
        let c = wallVendorCache.get(el);
        if (!c || c.d !== d) {
            let pts = [];
            try { pts = wallDensePts(el) || (typeof rtPathPoints === 'function' ? rtPathPoints(el) : parseSvgPathPoints(d)); } catch (e) { pts = parseSvgPathPoints(d); }
            c = { d, pts, closed: /[Zz]\s*$/.test(d.trim()) };
            wallVendorCache.set(el, c);
        }
        if (c.pts.length >= 2) out.push({ key: el, pts: c.pts, closed: c.closed && c.pts.length >= 3, vendor: true });
    });
    return out;
}

function wallOutlines() {
    const out = shapeSnapPolys().filter(c => c.pts.length >= 3).map(c => ({ key: c.el, pts: wallDensePts(c.el) || c.pts, closed: true }));
    getFloorZones(wallFloorCode()).forEach(z => {
        if (!z.points || z.points.length < 2) return;
        if (z.category === 'floor' && z.points.length >= 3) out.push({ key: 'z:' + z.id, pts: z.points, closed: true });
        if (z.category === 'wall') out.push({ key: 'w:' + z.id, pts: z.points, closed: z.geometry === 'polygon' });
    });
    out.push(...wallVendorOutlines());
    if (typeof drawingZonePoints !== 'undefined' && drawingZonePoints.length >= 2) out.push({ key: 'cur', pts: drawingZonePoints.slice(), closed: false });
    return out;
}

// 붙은 테두리 이름 (미리 보기 글)
function wallOutlineName(key) {
    if (key === 'cur') return '그리는 선';
    if (typeof key === 'string') return key.startsWith('z:') ? '바닥' : '외벽';
    if (key.classList && key.classList.contains('building-exterior-wall')) return '건물 외곽선';
    const s = currentStores.find(s => s.polygonElement === key);
    return s ? (s.name || (s.type === 'utility' ? '기능실' : '매장')) : '업체 도면 선';
}

// 점 p 가 테두리 o 위(tol 안)에 있으면 그 자리(꼭짓점 번호 + 변 위 비율), 아니면 null
function wallPosOn(o, p, tol) {
    const n = o.closed ? o.pts.length : o.pts.length - 1;
    let best = null, bd = tol;
    for (let i = 0; i < n; i++) {
        const a = o.pts[i], b = o.pts[(i + 1) % o.pts.length], q = projectPointToSegment(p, a, b), d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d <= bd) { bd = d; const L = Math.hypot(b.x - a.x, b.y - a.y) || 1; best = i + Math.hypot(q.x - a.x, q.y - a.y) / L; }
    }
    return best;
}

var wallBoxCache = new WeakMap();
// 가까운 테두리에 붙기 (꼭짓점 먼저, 그다음 변) → { x, y, isSnapped, key, pts, closed, pos(꼭짓점 번호 + 변 위 비율) } 또는 null
function wallSnap(x, y) {
    if (window.isShiftKeyPressed) return null;   // Shift = 자석 끄고 곧게
    const R = WALL_SNAP_PX / (typeof scale !== 'undefined' && scale ? scale : 1);
    const outs = wallOutlines().filter(o => {   // 멀리 있는 테두리는 건너뜀 (업체 선이 많아 빠르게)
        let b = wallBoxCache.get(o.pts);
        if (!b) { b = [Infinity, Infinity, -Infinity, -Infinity]; o.pts.forEach(p => { b[0] = Math.min(b[0], p.x); b[1] = Math.min(b[1], p.y); b[2] = Math.max(b[2], p.x); b[3] = Math.max(b[3], p.y); }); if (typeof o.key !== 'string') wallBoxCache.set(o.pts, b); }   // 구역 점은 끌어 고치면 바뀌므로 매번
        return x >= b[0] - R && x <= b[2] + R && y >= b[1] - R && y <= b[3] + R;
    });
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

var WALL_SMOOTH_DEG = 20;   // 이 각도 안으로 꺾이는 꼭짓점은 곡선 위의 점으로 보고 매끄럽게 (결정 320)

// 같은 테두리 위 두 점 사이 → 따라 그릴 점들 (짧은 쪽). 두 점이 서로 다른 도형에 붙었어도 둘 다 지나는 테두리가 있으면 그것을 따라감
function wallTraceBetween(a, b) {
    if (!a || !b || a.key === 'cur' || b.key === 'cur') return [];
    let raw = a.key === b.key ? wallWalk(a, b) : null;
    if (raw) raw.ctx = { pts: a.pts, closed: a.closed, pa: a.pos, pb: b.pos };
    if (a.key !== b.key) {
        wallOutlines().forEach(o => {
            if (o.key === 'cur' || (typeof o.key === 'string' && o.key.startsWith('w:'))) return;   // 이미 그린 외벽을 다시 따라가지는 않음
            const pa = wallPosOn(o, a, 0.5), pb = pa === null ? null : wallPosOn(o, b, 0.5);
            if (pb === null) return;
            const w = wallWalk(Object.assign({}, a, { pts: o.pts, closed: o.closed, pos: pa }), Object.assign({}, b, { pos: pb }));
            if (w && w.pts.length && (!raw || w.len < raw.len)) { raw = w; raw.ctx = { pts: o.pts, closed: o.closed, pa, pb }; }
        });
    }
    if (!raw) return [];
    // t: 따라간 점 (직접 찍은 점이 아님) — 구간 삭제·꼭짓점 손잡이는 직접 찍은 점 기준. 0.01 단위로 남겨 0.25 간격 유지
    // 양 끝 바깥 이웃 꼭짓점 (끝에서도 곡선이 이어지게)
    const c = raw.ctx, P = c.pts, n = P.length, at = i => c.closed ? P[((i % n) + n) % n] : P[i] || null;
    const before = raw.dir > 0 ? at(Math.ceil(c.pa) - 1) : at(Math.floor(c.pa) + 1);
    const after = raw.dir > 0 ? at(Math.floor(c.pb) + 1) : at(Math.ceil(c.pb) - 1);
    return wallSmooth([a].concat(raw.pts, [b]), before, after).map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, t: 1 }));
}

// a(pts·closed·pos) → b(pos) 사이 꼭짓점 (짧은 쪽) → { pts, len } 또는 null
function wallWalk(a, b) {
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
        return { pts, len, dir };
    };
    const f = walk(1), r = walk(-1);
    return !f ? r : !r ? f : (f.len <= r.len ? f : r);
}

// 꺾인 선(업체 곡선은 50~80px 직선 마디) → 완만한 꼭짓점은 지나는 매끄러운 곡선(센트리피털 캣멀롬)으로, WALL_CURVE_STEP 간격 점.
// 각진 모서리(WALL_SMOOTH_DEG 넘게 꺾임)와 양 끝은 그대로. S = [시작, ...가운데, 끝] → 가운데 점들만 돌려줌
function wallSmooth(S0, before, after) {
    const away = (q, e) => q && Math.hypot(q.x - e.x, q.y - e.y) > 1e-6;
    const hasB = away(before, S0[0]), hasA = away(after, S0[S0.length - 1]);
    const S = (hasB ? [before] : []).concat(S0, hasA ? [after] : []);
    const lo = hasB ? 1 : 0, hi = lo + S0.length - 1;   // S0 이 S 안에서 차지하는 범위 (밖 이웃은 기울기만 봄)
    const n = S.length;
    if (S0.length < 2) return [];
    const corner = S.map((p, i) => {
        if (i === 0 || i === n - 1) return true;
        const ax = p.x - S[i - 1].x, ay = p.y - S[i - 1].y, bx = S[i + 1].x - p.x, by = S[i + 1].y - p.y;
        const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
        if (la < 1e-9 || lb < 1e-9) return false;
        return Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180 / Math.PI > WALL_SMOOTH_DEG;
    });
    const ghost = (p, q) => ({ x: 2 * p.x - q.x, y: 2 * p.y - q.y });   // 모서리에서는 곧게 이어지는 가짜 점
    const out = [];
    for (let i = lo; i < hi; i++) {
        const p1 = S[i], p2 = S[i + 1], L = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (L > WALL_CURVE_STEP * 2 && !(corner[i] && corner[i + 1])) {
            // 끝(모서리) 쪽은 반대편 이웃이 곡선이면 세 점으로 뒤로 늘인 점 (원호도 끝까지 맞게), 아니면 곧게
            const p0 = !corner[i] ? S[i - 1] : (!corner[i + 1] && S[i + 2] ? { x: 3 * p1.x - 3 * p2.x + S[i + 2].x, y: 3 * p1.y - 3 * p2.y + S[i + 2].y } : ghost(p1, p2));
            const p3 = !corner[i + 1] ? S[i + 2] : (!corner[i] && S[i - 1] ? { x: 3 * p2.x - 3 * p1.x + S[i - 1].x, y: 3 * p2.y - 3 * p1.y + S[i - 1].y } : ghost(p2, p1));
            // 곡선 위를 잘게 찍은 뒤 길이 기준으로 고르게 다시 나눔 (간격 ≤ WALL_CURVE_STEP)
            const fine = [p1];
            for (let j = 1, M = Math.ceil(L / WALL_CURVE_STEP) * 4; j <= M; j++) fine.push(j === M ? p2 : wallCR(p0, p1, p2, p3, j / M));
            const cum = [0];
            for (let j = 1; j < fine.length; j++) cum.push(cum[j - 1] + Math.hypot(fine[j].x - fine[j - 1].x, fine[j].y - fine[j - 1].y));
            const T = cum[cum.length - 1], m = Math.ceil(T / WALL_CURVE_STEP);
            const dev = Math.max(...fine.map(q => { const r = projectPointToSegment(q, p1, p2); return Math.hypot(r.x - q.x, r.y - q.y); }));
            for (let j = 1, h = 1; dev > 0.01 && j < m; j++) {   // 곧으면 점을 넣지 않음
                const want = T * j / m;
                while (cum[h] < want) h++;
                const u = (want - cum[h - 1]) / ((cum[h] - cum[h - 1]) || 1);
                out.push({ x: fine[h - 1].x + (fine[h].x - fine[h - 1].x) * u, y: fine[h - 1].y + (fine[h].y - fine[h - 1].y) * u });
            }
        }
        if (i + 1 < hi) out.push(p2);
    }
    return out;
}
function wallCR(p0, p1, p2, p3, u) {
    const k = (a, b) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-6);
    const t0 = 0, t1 = t0 + k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3), t = t1 + (t2 - t1) * u;
    const L = (a, b, ta, tb) => ({ x: (tb - t) / (tb - ta) * a.x + (t - ta) / (tb - ta) * b.x, y: (tb - t) / (tb - ta) * a.y + (t - ta) / (tb - ta) * b.y });
    const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
    return L(L(A1, A2, t0, t2), L(A2, A3, t1, t3), t1, t2);
}

// 외벽 그릴 때 붙은 테두리를 빨강(디자인 --red)으로 + 이름 꼬리표 (마우스 올림 연출, 결정 368)
var WALL_HL_RED = '#C0261A';
function wallSnapHighlight(g, snap, x, y) {
    if (!g || !snap || !snap.key || snap.key === 'cur') return;
    const ns = 'http://www.w3.org/2000/svg', k = 1 / (typeof scale !== 'undefined' && scale ? scale : 1);
    const pts = snap.pts.map(p => p.x + ',' + p.y).join(' ');
    [['wall-snap-hl', 16 * k], ['wall-snap-hl-line', 2.5 * k]].forEach(([cls, w], i) => {   // 은은히 깜빡이는 띠(그리는 선 아래) + 가는 빨간 선(맨 위)
        const el = document.createElementNS(ns, snap.closed ? 'polygon' : 'polyline');
        el.setAttribute('class', cls);
        el.setAttribute('points', pts);
        el.setAttribute('fill', 'none');
        el.setAttribute('stroke', WALL_HL_RED);
        if (!i) el.setAttribute('stroke-opacity', '0.3');
        el.setAttribute('stroke-width', w);
        el.setAttribute('stroke-linejoin', 'round');
        el.setAttribute('stroke-linecap', 'round');
        el.style.pointerEvents = 'none';
        if (i) g.appendChild(el); else g.insertBefore(el, g.firstChild);
    });
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('class', 'wall-snap-name');
    t.setAttribute('x', x + 18 * k);
    t.setAttribute('y', y - 14 * k);
    t.setAttribute('font-size', 13 * k);
    t.setAttribute('fill', '#fff');
    t.style.pointerEvents = 'none';
    t.textContent = wallOutlineName(snap.key) + (lastWallSnap && lastWallSnap.key ? (wallTraceBetween(lastWallSnap, snap).length ? ' · 따라가기' : '') : '');
    g.appendChild(t);
    let w = t.textContent.length * 13 * k;
    try { w = t.getBBox().width; } catch (e) {}
    const tag = document.createElementNS(ns, 'rect');
    tag.setAttribute('class', 'wall-snap-tag');
    tag.setAttribute('x', x + 12 * k);
    tag.setAttribute('y', y - 29 * k);
    tag.setAttribute('width', w + 12 * k);
    tag.setAttribute('height', 21 * k);
    tag.setAttribute('rx', 4 * k);
    tag.setAttribute('fill', WALL_HL_RED);
    tag.style.pointerEvents = 'none';
    g.insertBefore(tag, t);
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
    document.body.classList.add('wall-flashing');   // 알림 순간에만 깜빡임 (저장본에 남은 표시는 안 움직임, 결정 322)
    setTimeout(() => { els.forEach(e => e && e.classList.remove('wall-outside-flash')); document.body.classList.remove('wall-flashing'); }, 8000);
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
// 다른 층에서 복사한 외벽: 고르면 선 전체 · 전체 삭제만 (결정 322). 예전 복사본은 id 끝 「_c층번호」로 알아봄
function isWallCopy(z) { return !!(z && (z.copyOf || /_c[A-Za-z0-9]+$/.test(z.id || ''))); }

function selectWallSegment(z, x, y, clientX, clientY) {
    hideWallSegSel();
    const copy = isWallCopy(z), k = copy ? null : wallSegAt(z, x, y);
    wallSel = { id: z.id, k, copy };
    const svgEl = mapContainer?.querySelector('svg');
    if (svgEl) {
        const m = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        m.setAttribute('id', 'wall-seg-mark');
        m.setAttribute('points', (copy ? z.points.concat(z.geometry === 'polygon' ? [z.points[0]] : []) : wallSegPts(z, k)).map(p => p.x + ',' + p.y).join(' '));
        m.setAttribute('fill', 'none');
        m.setAttribute('stroke', '#dc2626');
        m.setAttribute('stroke-width', 7 / (scale || 1));
        m.setAttribute('stroke-linecap', 'round');
        m.style.pointerEvents = 'none';
        svgEl.appendChild(m);
    }
    const pop = document.createElement('div');
    pop.id = 'wall-seg-pop';
    pop.innerHTML = copy
        ? `<div class="wall-seg-title">외벽 (복사본${z.copyOf ? ' · ' + z.copyOf + '에서' : ''})</div>`
          + '<button type="button" class="wall-seg-del" onclick="deleteWallWhole()">선 전체 삭제 (Del)</button>'
        : '<div class="wall-seg-title">외벽 구간</div>'
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
    if (wallSel.copy) { deleteWallWhole(); return; }   // 복사본은 통째로만
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
    if (!confirm(`외벽을 ${targets.length}개 층에 복사합니다. 복사한 외벽은 그 층에서 골라 「선 전체 삭제」로 지울 수 있습니다. 복사할까요?`)) return;
    hideWallBar();
    const from = wallFloorCode(), src = wallZonesOf(from), key = z => JSON.stringify(z.points.map(p => [Math.round(p.x), Math.round(p.y)]));
    let n = 0;
    const made = {};   // 층 → 방금 만든 복사본 id (「복사 취소」용)
    targets.forEach(code => {
        const zones = getFloorZones(code), have = new Set(zones.filter(z => z.category === 'wall').map(key));
        src.forEach((z, i) => {
            if (have.has(key(z))) return;
            const id = 'zone_' + Date.now() + '_c' + code + i;
            zones.push(Object.assign({}, z, { id, copyOf: from, points: z.points.map(p => ({ x: p.x, y: p.y })), createdAt: Date.now() }));
            (made[code] = made[code] || []).push(id);
            n++;
        });
        saveFloorZones(code, zones);
    });
    if (!n) { showToast('고른 층에 같은 외벽이 이미 있습니다.', 2000); return; }
    showToastAction(`외벽 ${n}개를 ${targets.length}개 층에 복사했습니다.`, '복사 취소', () => undoWallCopy(made), 8000);
}

// 방금 복사한 외벽을 그 층들에서 한 번에 지움 (결정 322)
function undoWallCopy(made) {
    Object.keys(made).forEach(code => saveFloorZones(code, getFloorZones(code).filter(z => !made[code].includes(z.id))));
    showToast('복사를 취소했습니다.', 1500);
}
