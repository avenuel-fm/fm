/* ============================================================
   floorCenterline.js - 복도 중심선으로 바닥 그리기 (결정 260)
   - 중심선을 클릭으로 이어 그리면 폭만큼 양옆으로 펼친 바닥 띠가 생김 (대각선 가능)
   - 꺾이는 곳은 바깥쪽을 뾰족하게(마이터) 채워 중심점 가까운 꼭지점·홈이 없음. 너무 급하게 꺾여 뾰족 끝이 반폭의 2배를 넘으면 깎음
   - 기존 바닥과 겹치거나 닿으면 하나의 도형으로 합침 (polygon-clipping, js/lib). 겹친 중심선도 하나로
   - 도형은 보통 바닥(category 'floor')으로 저장되고 중심선은 zone.cl 에 [x1,y1,x2,y2] 목록으로 함께 저장 (자석 붙기용)
   ============================================================ */
var floorCenterlineOn = false;      // 중심선 모드 (바닥 종류일 때만)
var floorRibbonW = 80;              // 띠 전체 폭 (도면 px)
const FCL_SNAP_PX = 18;             // 자석 반경 (화면 px)
const FCL_MITER_MAX = 2;            // 꺾임 뾰족함 한계 (폭의 절반 h 의 배수)

function fclActive() { return floorCenterlineOn && typeof currentZoneCategory !== 'undefined' && currentZoneCategory === 'floor'; }

// 같은 점이 연달아 찍힌 것(더블클릭)을 한 점으로
function fclDedupe(pts) { return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) > 1); }

// 중심선 → 띠 조각들(사각형 + 꺾임 보강) 의 고리 목록 [[x,y],...]
function fclRibbonParts(pts, h) {
    pts = fclDedupe(pts);
    const parts = [];
    const dir = i => { const dx = pts[i + 1].x - pts[i].x, dy = pts[i + 1].y - pts[i].y, l = Math.hypot(dx, dy); return { x: dx / l, y: dy / l }; };
    for (let i = 0; i < pts.length - 1; i++) {
        const d = dir(i), nx = -d.y * h, ny = d.x * h, a = pts[i], b = pts[i + 1];
        parts.push([[a.x + nx, a.y + ny], [b.x + nx, b.y + ny], [b.x - nx, b.y - ny], [a.x - nx, a.y - ny]]);
    }
    for (let i = 1; i < pts.length - 1; i++) {                       // 꺾임: 바깥쪽만 채움
        const d1 = dir(i - 1), d2 = dir(i), P = pts[i];
        const cross = d1.x * d2.y - d1.y * d2.x;
        if (Math.abs(cross) < 1e-3 && d1.x * d2.x + d1.y * d2.y > 0) continue;   // 거의 직진
        const s = cross > 0 ? -1 : 1;
        const n1 = { x: -d1.y * s, y: d1.x * s }, n2 = { x: -d2.y * s, y: d2.x * s };
        const A = [P.x + n1.x * h, P.y + n1.y * h], B = [P.x + n2.x * h, P.y + n2.y * h];
        const k = 1 + n1.x * n2.x + n1.y * n2.y;                       // 1+cosθ: 작을수록 급한 꺾임
        if (k > 1 / (FCL_MITER_MAX * FCL_MITER_MAX) * 2) {              // 뾰족 길이 ≤ 2h
            const M = [P.x + (n1.x + n2.x) / k * h, P.y + (n1.y + n2.y) / k * h];
            parts.push([[P.x, P.y], A, M, B]);
        } else parts.push([[P.x, P.y], A, B]);                          // 너무 급하면 깎음
    }
    return parts;
}

// 고리 정리: 닫는 점 빼기, 1.5 이내 겹친 점·일직선 점 지우기, 소수 1자리
function fclCleanRing(r) {
    let p = r.map(q => ({ x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10 }));
    if (p.length > 1 && p[0].x === p[p.length - 1].x && p[0].y === p[p.length - 1].y) p.pop();
    let again = true;
    while (again && p.length > 3) {
        again = false;
        for (let i = 0; i < p.length; i++) {
            const a = p[(i + p.length - 1) % p.length], b = p[i], c = p[(i + 1) % p.length];
            const near = Math.hypot(b.x - a.x, b.y - a.y) < 1.5;
            const col = Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 0.25 * Math.hypot(c.x - a.x, c.y - a.y);
            if (near || col) { p.splice(i, 1); again = true; break; }
        }
    }
    return p;
}

function fclInRing(x, y, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
        if ((ring[i].y > y) !== (ring[j].y > y) && x < (ring[j].x - ring[i].x) * (y - ring[i].y) / (ring[j].y - ring[i].y) + ring[i].x) c = !c;
    return c;
}

// 새 띠 조각들을 기존 바닥과 합침 → { zones: 새 목록 자리에 넣을 도형들, removeIds: 합쳐져 사라질 기존 도형 id }
function fclMerge(newParts, existing, newSegs) {
    const pc = polygonClipping;
    const toGeom = z => [z.points.map(p => [p.x, p.y])];
    let acc = pc.union(...newParts.map(r => [r]));
    const hasHole = g => g.some(poly => poly.length > 1);
    if (hasHole(acc)) {                                                // 고리(구멍) 모양: 합치지 않고 조각 그대로 (구멍을 메우면 안 되므로)
        return { rings: newParts.map(r => fclCleanRing(r)), removeIds: [], segs: newSegs };
    }
    const removeIds = [];
    let segs = newSegs.slice();
    let changed = true;
    const rest = existing.slice();
    while (changed) {
        changed = false;
        for (let i = rest.length - 1; i >= 0; i--) {
            const u = pc.union(acc, toGeom(rest[i]));
            if (u.length < acc.length + 1 && !hasHole(u)) {            // 닿거나 겹침 → 한 덩어리
                acc = u; removeIds.push(rest[i].id);
                (rest[i].cl || []).forEach(s => segs.push(s));
                rest.splice(i, 1); changed = true;
            }
        }
    }
    // 겹친 중심선 하나로: 양 끝이 2px 이내로 같은 선분은 한 번만
    const same = (a, b) => (Math.hypot(a[0] - b[0], a[1] - b[1]) < 2 && Math.hypot(a[2] - b[2], a[3] - b[3]) < 2) || (Math.hypot(a[0] - b[2], a[1] - b[3]) < 2 && Math.hypot(a[2] - b[0], a[3] - b[1]) < 2);
    const uniq = []; segs.forEach(s => { if (!uniq.some(u => same(u, s))) uniq.push(s); });
    return { rings: acc.map(poly => fclCleanRing(poly[0])), removeIds, segs: uniq };
}

// 기존 바닥의 중심선 끝·선 위로 자석처럼 붙기 (반경 18 화면 px)
function fclSnap(x, y) {
    if (typeof FLOORS === 'undefined' || typeof getFloorZones !== 'function') return null;
    const r = FCL_SNAP_PX / (typeof scale !== 'undefined' && scale ? scale : 1);
    let best = null, bd = r;
    getFloorZones(FLOORS[currentFloorIdx].code).forEach(z => (z.cl || []).forEach(s => {
        [[s[0], s[1]], [s[2], s[3]]].forEach(e => { const d = Math.hypot(x - e[0], y - e[1]); if (d < bd) { bd = d; best = { x: e[0], y: e[1] }; } });
    }));
    if (best) return best;
    getFloorZones(FLOORS[currentFloorIdx].code).forEach(z => (z.cl || []).forEach(s => {
        const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy; if (!l2) return;
        const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / l2));
        const px = s[0] + dx * t, py = s[1] + dy * t, d = Math.hypot(x - px, y - py);
        if (d < bd) { bd = d; best = { x: Math.round(px * 10) / 10, y: Math.round(py * 10) / 10 }; }
    }));
    return best;
}

// 클릭·미리보기 공통: 자석 → (직각/Shift 이면 45도 단위) 순서로 점을 고름
function fclPickPoint(x, y) {
    let p = { x, y }, snapped = false;
    const sn = fclSnap(x, y);
    if (sn) { p = sn; snapped = true; }
    else if (typeof snapToOrtho === 'function' && drawingZonePoints.length > 0) p = snapToOrtho(p, drawingZonePoints[drawingZonePoints.length - 1]);
    return { x: p.x, y: p.y, snapped };
}

function fclPreview(group, mx, my) {
    const NS = 'http://www.w3.org/2000/svg';
    const mk = (tag, at) => { const e = document.createElementNS(NS, tag); Object.entries(at).forEach(([k, v]) => e.setAttribute(k, v)); group.appendChild(e); return e; };
    let pts = drawingZonePoints.slice();
    let cur = null;
    if (mx !== null && my !== null) { cur = fclPickPoint(mx, my); pts = pts.concat([{ x: cur.x, y: cur.y }]); }
    if (pts.length >= 2) {
        fclRibbonParts(pts, floorRibbonW / 2).forEach(r => mk('polygon', { points: r.map(q => q.join(',')).join(' '), fill: 'rgba(2,132,199,0.25)', stroke: 'none' }));
        mk('polyline', { points: pts.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#ea580c', 'stroke-width': 2, 'stroke-dasharray': '5 3' });
    }
    drawingZonePoints.forEach(p => mk('circle', { cx: p.x, cy: p.y, r: 4, fill: '#fff', stroke: '#ea580c', 'stroke-width': 2 }));
    if (cur && cur.snapped) mk('circle', { cx: cur.x, cy: cur.y, r: 7, fill: 'none', stroke: '#10b981', 'stroke-width': 2.5 });
}

// 완료: 띠 만들기 → 기존 바닥과 합쳐 저장
function finishCenterlineFloor() {
    if (typeof isLayerLocked === 'function' && isLayerLocked('floor')) { warnLayerLocked(); return; }
    const pts = fclDedupe(drawingZonePoints);
    if (pts.length < 2) { showToast('중심선은 2개 이상의 점이 필요합니다.', 1500); return; }
    pushUndoState('바닥 중심선 추가');
    const floor = FLOORS[currentFloorIdx];
    const zones = getFloorZones(floor.code);
    const existing = zones.filter(z => z.category === 'floor' && z.geometry === 'polygon' && z.points && z.points.length >= 3);
    const newSegs = []; for (let i = 0; i < pts.length - 1; i++) newSegs.push([pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y]);
    const parts = fclRibbonParts(pts, floorRibbonW / 2);
    let res;
    try { res = fclMerge(parts, existing, newSegs); }
    catch (err) { console.warn('바닥 합치기 실패, 조각 그대로 저장', err); res = { rings: parts.map(fclCleanRing), removeIds: [], segs: newSegs }; }
    const keep = zones.filter(z => !res.removeIds.includes(z.id));
    const n0 = keep.filter(z => z.category === 'floor').length;
    res.rings.forEach((ring, i) => {
        if (ring.length < 3) return;
        keep.push({
            id: 'zone_' + Date.now() + '_' + i, name: `바닥 ${n0 + i + 1}`, category: 'floor', geometry: 'polygon', points: ring, createdAt: Date.now(),
            cl: res.segs.filter(s => fclInRing((s[0] + s[2]) / 2, (s[1] + s[3]) / 2, ring) || res.rings.length === 1)
        });
    });
    saveFloorZones(floor.code, keep);
    cleanupTempZoneDrawingGroup();
    renderFloorZones(floor.code);
    syncSvgCache();
    exitAddZoneMode();
    showToast(`바닥이 추가되었습니다.${res.removeIds.length ? ` (기존 바닥 ${res.removeIds.length}개와 합쳐짐)` : ''}`, 1800);
}

function toggleCenterlineFloor() {
    if (!fclActive() && typeof currentZoneCategory !== 'undefined' && currentZoneCategory !== 'floor') return;
    if (isLayerLocked && isLayerLocked('floor')) { warnLayerLocked(); return; }
    floorCenterlineOn = !floorCenterlineOn;
    drawingZonePoints = [];
    syncCenterlineUI();
    updateZoneGuideUI();
    updateZoneDrawingPreview();
    if (floorCenterlineOn) showToast('복도 중심선 모드: 클릭으로 점 추가 · Shift 45도 고정 · Enter 완료 · Backspace 직전 점 취소', 3000);
}
function setFloorRibbonWidth(v) {
    const w = Math.max(10, Math.min(600, parseInt(v, 10) || 80));
    floorRibbonW = w;
    const i = document.getElementById('input-floor-width-px'); if (i) i.value = w;
    if (typeof updateZoneDrawingPreview === 'function') updateZoneDrawingPreview();
}
function syncCenterlineUI() {
    const isFloor = typeof currentZoneCategory !== 'undefined' && currentZoneCategory === 'floor';
    if (!isFloor) floorCenterlineOn = false;
    const box = document.getElementById('floor-cl-controls'); if (box) box.style.display = isFloor ? 'inline-flex' : 'none';
    document.getElementById('btn-centerline-floor')?.classList.toggle('active', floorCenterlineOn);
}
