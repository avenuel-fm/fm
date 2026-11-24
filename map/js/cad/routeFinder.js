/* ==========================================================================
   routeFinder.js - 길찾기 (결정 246): 배관/간선 연결이 쓰는 직각 동선 계산
   복도 = 구역 그리기의 「바닥」 면. 입구(복도 쪽 가장 긴 변의 한가운데) → 수직으로 복도 중앙선 → 중앙선만 따라 → 수직으로 입구.
   계산 부분(routeCompute)은 화면과 따로라 시험에서 바로 부름.
   ========================================================================== */

var RT = { TOL: 1.5, ZONE_COLOR: '#dc2626' };

// ---- 기하 도우미 ----
function rtInPoly(p, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
}
function rtSegCross(p1, p2, q1, q2) {   // 두 선분이 (끝점 닿기 제외) 교차하는가
    const d = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = d(q1, q2, p1), d2 = d(q1, q2, p2), d3 = d(p1, p2, q1), d4 = d(p1, p2, q2);
    return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
}
function rtSegHitsPoly(a, b, poly) {
    for (let i = 0; i < poly.length; i++) if (rtSegCross(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return rtInPoly(m, poly);
}

// ---- 복도: 바닥 면 → 직사각형 조각 → 중앙선 ----
function rtCorridorRects(poly) {
    const xs = [...new Set(poly.map(p => Math.round(p.x * 2) / 2))].sort((a, b) => a - b);
    const ys = [...new Set(poly.map(p => Math.round(p.y * 2) / 2))].sort((a, b) => a - b);
    const rects = [];
    for (let j = 0; j < ys.length - 1; j++) {
        let run = null;
        for (let i = 0; i < xs.length - 1; i++) {
            const inside = rtInPoly({ x: (xs[i] + xs[i + 1]) / 2, y: (ys[j] + ys[j + 1]) / 2 }, poly);
            if (inside) { if (!run) run = { x1: xs[i], x2: xs[i + 1], y1: ys[j], y2: ys[j + 1] }; else run.x2 = xs[i + 1]; }
            else if (run) { rects.push(run); run = null; }
        }
        if (run) rects.push(run);
    }
    // 위아래로 폭이 같은 조각은 하나로
    let merged = true;
    while (merged) {
        merged = false;
        for (let a = 0; a < rects.length && !merged; a++) for (let b = 0; b < rects.length; b++) {
            if (a !== b && rects[a].x1 === rects[b].x1 && rects[a].x2 === rects[b].x2 && rects[a].y2 === rects[b].y1) {
                rects[a].y2 = rects[b].y2; rects.splice(b, 1); merged = true; break;
            }
        }
    }
    return rects;
}
function rtCenterlines(polys) {
    const rects = [];
    polys.forEach(p => rtCorridorRects(p).forEach(r => rects.push(r)));
    const T = RT.TOL;
    const inAny = (pt, skip) => rects.some(r => r !== skip && pt.x >= r.x1 - T && pt.x <= r.x2 + T && pt.y >= r.y1 - T && pt.y <= r.y2 + T);
    const segs = [];
    rects.forEach(r => {
        const w = r.x2 - r.x1, h = r.y2 - r.y1;
        const mk = (horiz) => {
            if (horiz) {
                const y = (r.y1 + r.y2) / 2; let a = r.x1, b = r.x2;
                if (inAny({ x: a - h / 2, y }, r)) a -= h / 2;   // 옆 복도와 이어지는 끝만 반 폭 늘림
                if (inAny({ x: b + h / 2, y }, r)) b += h / 2;
                segs.push({ h: true, c: y, a, b, pts: [] });
            } else {
                const x = (r.x1 + r.x2) / 2; let a = r.y1, b = r.y2;
                if (inAny({ x, y: a - w / 2 }, r)) a -= w / 2;
                if (inAny({ x, y: b + w / 2 }, r)) b += w / 2;
                segs.push({ h: false, c: x, a, b, pts: [] });
            }
        };
        if (w >= h * 0.9) mk(true);
        if (h >= w * 0.9) mk(false);
    });
    return segs;
}

// ---- 입구: 복도 쪽으로 곧게 뻗어 중앙선에 닿는 변 중 가장 긴 변의 한가운데 ----
function rtRayHit(E, d, segs, obstacles) {
    let best = null;
    segs.forEach((s, idx) => {
        let dist = null, J = null;
        if (d.x !== 0 && !s.h) {                          // 가로로 나가 세로 중앙선에 닿기
            dist = (s.c - E.x) * d.x; J = { x: s.c, y: E.y };
            if (E.y < s.a - RT.TOL || E.y > s.b + RT.TOL) dist = null;
        } else if (d.y !== 0 && s.h) {                    // 세로로 나가 가로 중앙선에 닿기
            dist = (s.c - E.y) * d.y; J = { x: E.x, y: s.c };
            if (E.x < s.a - RT.TOL || E.x > s.b + RT.TOL) dist = null;
        } else if ((d.x !== 0 && s.h && Math.abs(s.c - E.y) <= RT.TOL && E.x >= s.a - RT.TOL && E.x <= s.b + RT.TOL) ||
                   (d.y !== 0 && !s.h && Math.abs(s.c - E.x) <= RT.TOL && E.y >= s.a - RT.TOL && E.y <= s.b + RT.TOL)) {
            dist = 0; J = { x: E.x, y: E.y };             // 입구가 이미 중앙선 위
        }
        if (dist === null || dist < -RT.TOL) return;
        if (best && best.dist <= dist) return;
        if (dist > RT.TOL && obstacles.some(o => rtSegHitsPoly(E, J, o))) return;
        best = { dist: Math.max(dist, 0), J, idx };
    });
    return best;
}
function rtEntrance(poly, segs, obstacles) {
    const n = poly.length;
    const cx = poly.reduce((s, p) => s + p.x, 0) / n, cy = poly.reduce((s, p) => s + p.y, 0) / n;
    const edges = [];
    for (let i = 0; i < n; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % n];
        const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (len < 1) continue;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        let nx = (p2.y - p1.y) / len, ny = -(p2.x - p1.x) / len;
        if (nx * (cx - mid.x) + ny * (cy - mid.y) > 0) { nx = -nx; ny = -ny; }
        const d = Math.abs(nx) >= Math.abs(ny) ? { x: Math.sign(nx), y: 0 } : { x: 0, y: Math.sign(ny) };   // 가로·세로로만 (기울어진 변은 가까운 쪽으로)
        edges.push({ mid, len, d });
    }
    edges.sort((a, b) => b.len - a.len);
    for (const e of edges) {
        const hit = rtRayHit(e.mid, e.d, segs, obstacles);
        if (hit) return { E: e.mid, J: hit.J, seg: hit.idx };
    }
    return null;
}

// ---- 중앙선 그물 만들고 최단 경로 ----
function rtShortest(segs, J1, s1, J2, s2) {
    const key = p => (Math.round(p.x * 10) / 10) + ',' + (Math.round(p.y * 10) / 10);
    segs[s1].pts.push(J1); segs[s2].pts.push(J2);
    const T = RT.TOL;
    segs.forEach((a, i) => segs.forEach((b, j) => {
        if (j <= i) return;
        if (a.h !== b.h) {
            const hs = a.h ? a : b, vs = a.h ? b : a;
            if (vs.c >= hs.a - T && vs.c <= hs.b + T && hs.c >= vs.a - T && hs.c <= vs.b + T) {
                const p = { x: vs.c, y: hs.c }; a.pts.push(p); b.pts.push(p);
            }
        } else if (Math.abs(a.c - b.c) <= T) {          // 같은 줄에서 이어지는 두 조각
            [[a, b], [b, a]].forEach(([u, v]) => [u.a, u.b].forEach(t => {
                if (t >= v.a - T && t <= v.b + T) v.pts.push(a.h ? { x: t, y: v.c } : { x: v.c, y: t });
            }));
        }
    }));
    const adj = new Map(), pos = new Map();
    const link = (p, q) => {
        const kp = key(p), kq = key(q); if (kp === kq) return;
        pos.set(kp, p); pos.set(kq, q);
        const w = Math.abs(p.x - q.x) + Math.abs(p.y - q.y);
        if (!adj.has(kp)) adj.set(kp, []); if (!adj.has(kq)) adj.set(kq, []);
        adj.get(kp).push([kq, w]); adj.get(kq).push([kp, w]);
    };
    segs.forEach(s => {
        const pts = s.pts.concat([s.h ? { x: s.a, y: s.c } : { x: s.c, y: s.a }, s.h ? { x: s.b, y: s.c } : { x: s.c, y: s.b }])
            .sort((p, q) => (s.h ? p.x - q.x : p.y - q.y));
        for (let k = 0; k < pts.length - 1; k++) link(pts[k], pts[k + 1]);
    });
    const from = key(J1), to = key(J2);
    if (from === to) return [J1];
    if (!adj.has(from) || !adj.has(to)) return null;
    const dist = new Map([[from, 0]]), prev = new Map(), todo = new Set([from]);
    while (todo.size) {
        let u = null; todo.forEach(k => { if (u === null || dist.get(k) < dist.get(u)) u = k; });
        todo.delete(u);
        if (u === to) break;
        (adj.get(u) || []).forEach(([v, w]) => {
            const nd = dist.get(u) + w;
            if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); todo.add(v); }
        });
    }
    if (!prev.has(to)) return null;
    const out = []; for (let k = to; k !== undefined; k = prev.get(k)) out.unshift(pos.get(k));
    return out;
}

// 계산 본체: 시작·도착 매장 모양(점 목록), 다른 매장들, 복도(바닥) 면들 → { ok, points } 또는 { ok:false, error }
function routeCompute(fromPoly, toPoly, otherPolys, corridorPolys) {
    if (!corridorPolys.length) return { ok: false, error: '이 층에 복도(바닥)가 없습니다. 구역 추가/편집에서 「바닥」으로 복도를 먼저 그려 주세요.' };
    const segs = rtCenterlines(corridorPolys);
    const e1 = rtEntrance(fromPoly, segs, otherPolys.concat([toPoly]));
    const e2 = rtEntrance(toPoly, segs, otherPolys.concat([fromPoly]));
    if (!e1 || !e2) return { ok: false, error: (!e1 ? '출발' : '도착') + ' 매장에서 복도로 이어지는 곳을 찾지 못했습니다.' };
    const mid = rtShortest(segs, e1.J, e1.seg, e2.J, e2.seg);
    if (!mid) return { ok: false, error: '두 매장 사이를 잇는 복도가 끊겨 있습니다.' };
    const raw = [e1.E, ...mid, e2.E], pts = [];
    raw.forEach(p => {                                  // 겹친 점·일직선 가운데 점 정리
        const last = pts[pts.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.05 && Math.abs(last.y - p.y) < 0.05) return;
        if (pts.length >= 2) {
            const a = pts[pts.length - 2], b = last;
            if ((Math.abs(a.x - b.x) < 0.05 && Math.abs(b.x - p.x) < 0.05) || (Math.abs(a.y - b.y) < 0.05 && Math.abs(b.y - p.y) < 0.05)) pts.pop();
        }
        pts.push({ x: p.x, y: p.y });
    });
    return { ok: true, points: pts };
}

// ==================== 도면(화면)과 이어 쓰기 ====================
function rtPathPoints(path) {                          // 매장 path 의 d → 점 목록 (M L H V Z, 대소문자 모두. 곡선이 있으면 둘레를 걸어 가며 찍음)
    const d = path.getAttribute('d') || '';
    if (!/[CcSsQqTtAa]/.test(d)) {
        const t = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [], pts = []; let cmd = 'M', x = 0, y = 0, sx = 0, sy = 0;
        for (let i = 0; i < t.length;) {
            if (/[A-Za-z]/.test(t[i])) { cmd = t[i]; i++; if (/z/i.test(cmd)) { x = sx; y = sy; continue; } }
            const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
            if (C === 'H') x = (rel ? x : 0) + +t[i++];
            else if (C === 'V') y = (rel ? y : 0) + +t[i++];
            else { x = (rel ? x : 0) + +t[i++]; y = (rel ? y : 0) + +t[i++]; }
            if (C === 'M') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
            pts.push({ x, y });
        }
        if (pts.length > 1 && Math.abs(pts[0].x - pts[pts.length - 1].x) < 0.01 && Math.abs(pts[0].y - pts[pts.length - 1].y) < 0.01) pts.pop();
        if (pts.length >= 3) return pts;
    }
    const L = path.getTotalLength(), pts = [], N = 40;
    for (let k = 0; k < N; k++) { const p = path.getPointAtLength(L * k / N); pts.push({ x: p.x, y: p.y }); }
    return pts;
}
// 매장·기능실 두 곳(polygonElement 가 있는 항목) 사이 길 → { ok, points } 또는 { ok:false, error }. points 는 a → b 순서
function routeBetweenStores(a, b) {
    const svgEl = mapContainer.querySelector('svg');
    const floor = FLOORS[currentFloorIdx];
    const corridors = (getFloorZones(floor.code) || []).filter(z => z.category === 'floor' && z.points && z.points.length >= 3).map(z => z.points);
    if (!corridors.length) return { ok: false, error: '바닥면 작성 필요' };
    const others = [...svgEl.querySelectorAll('.store-polygon')].filter(p => p !== a.polygonElement && p !== b.polygonElement).map(rtPathPoints);
    return routeCompute(rtPathPoints(a.polygonElement), rtPathPoints(b.polygonElement), others, corridors);
}
