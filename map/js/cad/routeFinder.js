/* ==========================================================================
   routeFinder.js - 길찾기 (결정 246 · 바닥 안 최단 결정 308): 배관/간선 연결이 쓰는 동선 계산
   복도 = 구역 그리기의 「바닥」 면. 매장 변 한가운데(입구) → 바닥 안에서 가로·세로로 가장 짧은 길(꺾임 적게) → 입구. 중심선은 안 씀.
   계산 부분(routeCompute)은 화면과 따로라 시험에서 바로 부름.
   ========================================================================== */

var RT = { TOL: 1.5, GAP: 8, ZONE_COLOR: '#dc2626' };

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

// ---- 바닥 안 가장 짧은 길 (결정 308): 바닥을 잘게 나눈 칸 위에서 가로·세로로 찾음. 중심선은 안 씀 ----
// 칸: free(바닥 안 · 매장 밖), store(1 출발 · 2 도착 · 3 다른 매장). 바닥끼리 한 칸 이하 틈은 이어 봄(그린 사람 실수, 전 RT.GAP).
var RT_EXIT_GAP = 150;  // 매장 변과 바닥 사이 빈 곳은 이만큼까지만 건넘
var RT_MID = 40;        // 벽에서 이만큼 안쪽까지는 벽에 가까울수록 비싸게 (선이 복도 가운데로, 넓은 곳에선 벽에서 이만큼)
function rtGrid(polysFloor, fromPoly, toPoly, otherPolys) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    polysFloor.concat([fromPoly, toPoly]).forEach(poly => poly.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }));
    const s = Math.max(2, Math.sqrt((x1 - x0) * (y1 - y0) / 150000));   // 칸 크기: 칸 수가 15만 개쯤 되게 (층 전체도 빠르게)
    x0 -= 3 * s; y0 -= 3 * s;
    const W = Math.ceil((x1 - x0) / s) + 6, H = Math.ceil((y1 - y0) / s) + 6;
    const fill = (poly, arr, v) => {                    // 칸 가운데가 도형 안이면 v (줄마다 경계와 만나는 곳 사이를 칠함)
        let lo = Infinity, hi = -Infinity; poly.forEach(p => { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); });
        const r0 = Math.max(0, Math.floor((lo - y0) / s - 0.5)), r1 = Math.min(H - 1, Math.ceil((hi - y0) / s));
        for (let r = r0; r <= r1; r++) {
            const y = y0 + (r + 0.5) * s, xs = [];
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const a = poly[i], b = poly[j];
                if ((a.y > y) !== (b.y > y)) xs.push((b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x);
            }
            xs.sort((u, w) => u - w);
            for (let k = 0; k + 1 < xs.length; k += 2) {
                const c0 = Math.max(0, Math.ceil((xs[k] - x0) / s - 0.5)), c1 = Math.min(W - 1, Math.floor((xs[k + 1] - x0) / s - 0.5));
                for (let c = c0; c <= c1; c++) arr[r * W + c] = v;
            }
        }
    };
    const floor = new Uint8Array(W * H), store = new Uint8Array(W * H);
    polysFloor.forEach(poly => fill(poly, floor, 1));
    otherPolys.forEach(poly => { if (poly.some(p => p.x >= x0 && p.x <= x1 + s && p.y >= y0 && p.y <= y1 + s)) fill(poly, store, 3); });
    fill(fromPoly, store, 1); fill(toPoly, store, 2);
    const free = new Uint8Array(W * H);
    for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {   // 한 칸 넓힌 바닥 → 작은 틈 이어짐
        const i = r * W + c;
        // 다른 매장(3)이라도 바닥이 덮은 칸(관통·걸침)은 지나감 (결정 364)
        free[i] = (floor[i] | floor[i - 1] | floor[i + 1] | floor[i - W] | floor[i + W]) && (!store[i] || (store[i] === 3 && floor[i])) ? 1 : 0;
    }
    // 벽(바닥 밖·매장)까지 몇 칸인가: 같은 길이면 복도 가운데 쪽을 고르는 데 씀
    const clear = new Uint8Array(W * H), q = new Int32Array(W * H);
    let qh = 0, qt = 0;
    for (let i = 0; i < W * H; i++) if (!free[i]) q[qt++] = i;
    while (qh < qt) {
        const i = q[qh++], c = i % W, d = clear[i] + 1;
        [c > 0 ? i - 1 : -1, c < W - 1 ? i + 1 : -1, i - W, i + W].forEach(j => {
            if (j >= 0 && j < W * H && free[j] && !clear[j]) { clear[j] = Math.min(250, d); q[qt++] = j; }
        });
    }
    return { s, x0, y0, W, H, store, floor, free, clear, cx: c => x0 + (c + 0.5) * s, cy: r => y0 + (r + 0.5) * s };
}
// 매장 변마다 한가운데(입구) → 바깥쪽으로 가로·세로로 나가 처음 닿는 바닥 칸
function rtExits(poly, g, ok, me, other) {
    const n = poly.length, cx = poly.reduce((a, p) => a + p.x, 0) / n, cy = poly.reduce((a, p) => a + p.y, 0) / n, out = [];
    for (let i = 0; i < n; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % n], len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (len < 1) continue;
        const E = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        let nx = (p2.y - p1.y) / len, ny = -(p2.x - p1.x) / len;
        if (nx * (cx - E.x) + ny * (cy - E.y) > 0) { nx = -nx; ny = -ny; }
        const dir = Math.abs(nx) >= Math.abs(ny) ? (nx > 0 ? 0 : 2) : (ny > 0 ? 1 : 3);   // 0 오른 · 1 아래 · 2 왼 · 3 위 (기울어진 변은 가까운 쪽)
        const dc = [1, 0, -1, 0][dir], dr = [0, 1, 0, -1][dir];
        let c = Math.floor((E.x - g.x0) / g.s), r = Math.floor((E.y - g.y0) / g.s), gap = 0;
        for (let k = 0; k < 4000; k++, c += dc, r += dr) {
            if (c < 0 || r < 0 || c >= g.W || r >= g.H) break;
            const j = r * g.W + c, st = g.store[j];
            if ((st === 3 && !g.floor[j]) || st === other) break;   // 다른 매장을 지나야 하면 이 변은 안 씀 (바닥이 덮은 곳은 건넘, 결정 364)
            if (ok[j]) { out.push({ E, dir, cell: j, cost: Math.abs(dc ? g.cx(c) - E.x : g.cy(r) - E.y) }); break; }
            if (st !== me && (gap += g.s) > RT_EXIT_GAP + g.s) break;   // 바닥과 떨어진 변 (빈 곳을 건너지 않음)
        }
    }
    return out;
}
function rtSearch(g, ok, starts, ends) {               // 칸 위 가장 짧은 길 (같은 길이면 꺾임 적게). 상태 = 칸 × 방향
    const N = g.W * g.H, dist = new Float64Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
    const heap = [];
    const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
        return top;
    };
    const endAt = new Map(); ends.forEach(e => { const o = endAt.get(e.cell); if (!o || e.cost < o.cost) endAt.set(e.cell, e); });
    starts.forEach((e, k) => { const v = e.cell * 4 + e.dir; if (e.cost < dist[v]) { dist[v] = e.cost; prev[v] = -2 - k; push(e.cost, v); } });
    const BEND = g.s * 0.5 + 5, DC = [1, 0, -1, 0], DR = [0, 1, 0, -1];
    let best = Infinity, bestV = -1, bestEnd = null;
    while (heap.length) {
        const [d, v] = pop();
        if (d >= best) break;
        if (d > dist[v]) continue;
        const cell = v >> 2, dir = v & 3, e = endAt.get(cell);
        if (e) { const t = d + e.cost + (dir === (e.dir + 2) % 4 ? 0 : BEND); if (t < best) { best = t; bestV = v; bestEnd = e; } }
        const c = cell % g.W, r = (cell - c) / g.W;
        for (let nd = 0; nd < 4; nd++) {
            if (nd === (dir + 2) % 4) continue;
            const c2 = c + DC[nd], r2 = r + DR[nd];
            if (c2 < 0 || r2 < 0 || c2 >= g.W || r2 >= g.H) continue;
            const n2 = r2 * g.W + c2; if (!ok[n2]) continue;
            const w = d + g.s * (1 + 1.5 * Math.max(0, 1 - g.clear[n2] * g.s / RT_MID)) + (nd === dir ? 0 : BEND), v2 = n2 * 4 + nd;   // 벽 가까운 칸은 비쌈 → 복도 가운데로
            if (w < dist[v2]) { dist[v2] = w; prev[v2] = v; push(w, v2); }
        }
    }
    if (bestV < 0) return null;
    const cells = []; let v = bestV, start = null;
    for (;;) { cells.unshift(v >> 2); const p = prev[v]; if (p <= -2) { start = starts[-2 - p]; break; } v = p; }
    return { cells, start, end: bestEnd };
}
function rtLineFree(g, a, b) {                         // 곧은 선이 바닥 안·매장 밖인가
    const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(2, Math.ceil(L / (g.s * 0.5)));
    for (let k = 0; k <= n; k++) {
        const c = Math.floor((a.x + (b.x - a.x) * k / n - g.x0) / g.s), r = Math.floor((a.y + (b.y - a.y) * k / n - g.y0) / g.s);
        if (c < 0 || r < 0 || c >= g.W || r >= g.H || !g.free[r * g.W + c]) return false;
    }
    return true;
}

// 복도가 끊겼을 때 끊긴 자리: 출발 쪽에서 닿는 바닥과 도착 쪽에서 닿는 바닥 사이 가장 가까운 두 점 [a, b] (결정 308)
function rtGap(g, st, en) {
    const N = g.W * g.H, side = new Uint8Array(N), q = new Int32Array(N);
    const flood = (seeds, v) => {
        let h = 0, t = 0;
        seeds.forEach(e => { if (!side[e.cell]) { side[e.cell] = v; q[t++] = e.cell; } });
        while (h < t) {
            const i = q[h++], c = i % g.W;
            [c > 0 ? i - 1 : -1, c < g.W - 1 ? i + 1 : -1, i - g.W, i + g.W].forEach(j => { if (j >= 0 && j < N && g.free[j] && !side[j]) { side[j] = v; q[t++] = j; } });
        }
    };
    flood(st, 1); flood(en, 2);
    const from = new Int32Array(N).fill(-1);       // 출발 쪽 바닥에서 아무 칸이나 건너 도착 쪽 바닥까지 가장 가까운 곳
    let h = 0, t = 0;
    for (let i = 0; i < N; i++) if (side[i] === 1) { from[i] = i; q[t++] = i; }
    while (h < t) {
        const i = q[h++], c = i % g.W;
        for (const j of [c > 0 ? i - 1 : -1, c < g.W - 1 ? i + 1 : -1, i - g.W, i + g.W]) {
            if (j < 0 || j >= N || from[j] >= 0) continue;
            from[j] = from[i];
            if (side[j] === 2) {
                const at = k => { const cc = k % g.W; return { x: Math.round(g.cx(cc) * 10) / 10, y: Math.round(g.cy((k - cc) / g.W) * 10) / 10 }; };
                return [at(from[j]), at(j)];
            }
            q[t++] = j;
        }
    }
    return null;
}

// 계산 본체: 시작·도착 매장 모양(점 목록), 다른 매장들, 복도(바닥) 면들 → { ok, points } 또는 { ok:false, error }
function routeCompute(fromPoly, toPoly, otherPolys, corridorPolys) {
    if (!corridorPolys.length) return { ok: false, error: '이 층에 복도(바닥)가 없습니다. 구역 추가/편집에서 「바닥」으로 복도를 먼저 그려 주세요.' };
    const g = rtGrid(corridorPolys, fromPoly, toPoly, otherPolys);
    const st = rtExits(fromPoly, g, g.free, 1, 2), en = rtExits(toPoly, g, g.free, 2, 1);
    if (!st.length || !en.length) return { ok: false, error: (!st.length ? '출발' : '도착') + ' 매장에서 복도로 이어지는 곳을 찾지 못했습니다.' };
    const found = rtSearch(g, g.free, st, en);
    if (!found) return { ok: false, error: '두 매장 사이를 잇는 복도가 끊겨 있습니다. 빨간 점선 자리에 바닥을 이어 그려 주세요.', gap: rtGap(g, st, en) };
    const { cells, start, end } = found;
    const pts = cells.map(i => { const c = i % g.W, r = (i - c) / g.W; return { x: g.cx(c), y: g.cy(r), c, r }; });
    // 입구에서 곧게 나가도록 첫·끝 줄을 입구 좌표에 맞춤 (칸 가운데와 입구는 반 칸 이내로 어긋남)
    const align = (list, e) => {
        const vert = e.dir % 2 === 1, k0 = vert ? list[0].c : list[0].r;
        for (const p of list) { if ((vert ? p.c : p.r) !== k0) break; if (vert) p.x = e.E.x; else p.y = e.E.y; }
    };
    align(pts, start); align(pts.slice().reverse(), end);
    const out = [], cr = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    [start.E, ...pts, end.E].forEach(p => {             // 겹친 점·일직선 가운데 점 정리
        const last = out[out.length - 1];
        if (last && Math.abs(last.x - p.x) < 0.05 && Math.abs(last.y - p.y) < 0.05) return;
        if (out.length >= 2 && Math.abs(cr(out[out.length - 2], last, p)) < 0.05 * Math.hypot(p.x - last.x, p.y - last.y) + 1e-9) out.pop();
        out.push({ x: p.x, y: p.y });
    });
    // 대각선 복도의 계단 모양(같은 쪽으로 세 번 이상 꺾임)은 바닥 안으로 곧게 갈 수 있으면 한 줄로 폄. ㄱ·ㄷ·Z자 꺾임은 그대로
    const mono = (a, b) => {
        let sx = 0, sy = 0;
        for (let k = a; k < b; k++) {
            const dx = Math.sign(Math.round(out[k + 1].x - out[k].x)), dy = Math.sign(Math.round(out[k + 1].y - out[k].y));
            if ((dx && sx && dx !== sx) || (dy && sy && dy !== sy)) return false;
            sx = sx || dx; sy = sy || dy;
        }
        return true;
    };
    for (let i = 1; i < out.length - 2; i++) {
        let best = -1;
        for (let j = i + 4; j <= out.length - 2; j++) { if (!mono(i, j)) break; if (rtLineFree(g, out[i], out[j])) best = j; }
        if (best > 0) out.splice(i + 1, best - i - 1);
    }
    return { ok: true, points: out.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })) };
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
    if (!/\d/.test(path.getAttribute('d') || '')) return [];   // 다 깎여 빈 후방복도 등: 점 없음 (빈 path 는 getPointAtLength 가 오류)
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
