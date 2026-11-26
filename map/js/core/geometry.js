/* ==========================================================================
   geometry.js - 다각형 기하학 연산, 점-폴리곤 충돌 검사, 평행 오프셋 보정 알고리즘
   ========================================================================== */

        // ================= 도형 겹침 방지 및 평행 오프셋 보정 알고리즘 =================
        function isPointInsidePolygon(pt, poly) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
                const xi = poly[i].x, yi = poly[i].y;
                const xj = poly[j].x, yj = poly[j].y;
                const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
                    (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        function projectPointToSegment(pt, p1, p2) {
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq === 0) return { x: p1.x, y: p1.y };
            let t = ((pt.x - p1.x) * dx + (pt.y - p1.y) * dy) / lenSq;
            t = Math.max(0, Math.min(1, t));
            return { x: p1.x + t * dx, y: p1.y + t * dy };
        }

        function distancePointToPolygon(pt, poly) {
            let minDist = Infinity;
            for (let i = 0; i < poly.length; i++) {
                const p1 = poly[i];
                const p2 = poly[(i + 1) % poly.length];
                const proj = projectPointToSegment(pt, p1, p2);
                const dist = Math.hypot(pt.x - proj.x, pt.y - proj.y);
                if (dist < minDist) minDist = dist;
            }
            return minDist;
        }

        function parseSvgPathPoints(d) {
            if (!d) return [];
            const nums = d.match(/[-+]?[0-9]*\.?[0-9]+/g);
            if (!nums) return [];
            const pts = [];
            for (let i = 0; i < nums.length - 1; i += 2) {
                const x = parseFloat(nums[i]);
                const y = parseFloat(nums[i+1]);
                if (!isNaN(x) && !isNaN(y)) {
                    pts.push({ x, y });
                }
            }
            return pts;
        }

        // ================= 매장 도형 도우미 (결정 308) =================
        // 점들을 감싸는 가장 작은 (기울어질 수 있는) 네모 → { cx, cy, ang(라디안, 변 u 방향), w(u 쪽 길이), h }
        function minAreaRect(pts) {
            if (!pts || pts.length < 3) return null;
            let best = null;
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length], L = Math.hypot(b.x - a.x, b.y - a.y);
                if (L < 0.5) continue;
                const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
                let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
                pts.forEach(p => { const u = p.x * ux + p.y * uy, v = -p.x * uy + p.y * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); });
                const area = (u1 - u0) * (v1 - v0);
                if (!best || area < best.area - 1e-6) {
                    const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
                    best = { area, cx: um * ux - vm * uy, cy: um * uy + vm * ux, ang: Math.atan2(uy, ux), w: u1 - u0, h: v1 - v0 };
                }
            }
            return best;
        }
        // 기운 도형이면 { cx, cy, deg(글자 기울기, 긴 변 방향 -90~90), L(긴 변), S(짧은 변), ux, uy } 아니면 null (3도 이하는 반듯한 것으로)
        function storeTilt(pts) {
            const r = minAreaRect(pts);
            if (!r) return null;
            const q = ((r.ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
            if (Math.min(q, Math.PI / 2 - q) < 3 * Math.PI / 180) return null;
            const xs = pts.map(p => p.x), ys = pts.map(p => p.y);   // 반듯한 네모로 감싸도 거의 같으면(삼각형 등) 반듯한 것으로
            if ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) <= r.area * 1.05) return null;
            let a = r.w >= r.h ? r.ang : r.ang + Math.PI / 2;
            while (a > Math.PI / 2) a -= Math.PI;
            while (a <= -Math.PI / 2) a += Math.PI;
            return { cx: r.cx, cy: r.cy, deg: a * 180 / Math.PI, L: Math.max(r.w, r.h), S: Math.min(r.w, r.h), ux: Math.cos(a), uy: Math.sin(a) };
        }
        // 기운 네모 축 따라 키우기: 가운데·기울기 그대로, 긴 쪽 fu배 · 짧은 쪽 fv배
        function growAlongTilt(pts, t, fu, fv) {
            return pts.map(p => {
                const dx = p.x - t.cx, dy = p.y - t.cy, u = dx * t.ux + dy * t.uy, v = -dx * t.uy + dy * t.ux;
                return { x: t.cx + fu * u * t.ux - fv * v * t.uy, y: t.cy + fu * u * t.uy + fv * v * t.ux };
            });
        }
        function pointsToPathD(pts) {
            return 'M ' + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ') + ' Z';
        }

        // 그릴 때 매장·기능실 모서리(먼저)·변에 자석처럼 붙기 (화면 12px 안, 결정 308)
        var SHAPE_SNAP_PX = 12;
        var shapeSnapCache = new WeakMap();
        function shapeSnapPolys() {
            const svgEl = mapContainer && mapContainer.querySelector('svg');
            if (!svgEl) return [];
            return Array.from(svgEl.querySelectorAll('.store-polygon')).map(el => {
                const d = el.getAttribute('d') || '';
                let c = shapeSnapCache.get(el);
                if (!c || c.d !== d) {
                    const pts = typeof rtPathPoints === 'function' ? rtPathPoints(el) : parseSvgPathPoints(d);
                    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                    pts.forEach(p => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
                    c = { d, pts, x0, y0, x1, y1, el };
                    shapeSnapCache.set(el, c);
                }
                return c;
            });
        }
        function snapToShapes(x, y) {
            const r = SHAPE_SNAP_PX / (typeof scale !== 'undefined' && scale ? scale : 1);
            const near = shapeSnapPolys().filter(c => c.pts.length >= 2 && x >= c.x0 - r && x <= c.x1 + r && y >= c.y0 - r && y <= c.y1 + r);
            let best = null, bd = r;
            near.forEach(c => c.pts.forEach(p => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { x: p.x, y: p.y, isSnapped: true, type: 'corner' }; } }));
            if (best) return best;
            bd = r;
            near.forEach(c => c.pts.forEach((p, i) => {
                const q = projectPointToSegment({ x, y }, p, c.pts[(i + 1) % c.pts.length]), d = Math.hypot(q.x - x, q.y - y);
                if (d < bd) { bd = d; best = { x: q.x, y: q.y, isSnapped: true, type: 'edge' }; }
            }));
            return best || { x, y, isSnapped: false };
        }

        // 그린 면에서 매장·기능실 자리를 빼고 둘레 2px 띄움 (결정 308·314). rings: [[x,y],...] 목록 → 남은 바깥 고리 목록
        // passStores: 바닥이면 true → 매장을 꿰뚫어 지나가면 그 매장은 자르지 않음(기능실은 늘 자름). 매장 그리기는 false
        var FLOOR_STORE_GAP = 2;
        function floorAvoidStores(rings) { return avoidStoreShapes(rings, true); }
        function avoidStoreShapes(rings, passStores) {
            if (typeof polygonClipping === 'undefined' || !rings.length) return rings;
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            rings.forEach(r => r.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
            const g = FLOOR_STORE_GAP, cut = [], drawn = rings.map(r => [r]);
            shapeSnapPolys().forEach(c => {
                if (c.pts.length < 3 || c.x1 < x0 - g || c.x0 > x1 + g || c.y1 < y0 - g || c.y0 > y1 + g) return;
                // 바닥이 매장을 꿰뚫어(매장이 둘 이상으로 나뉨) 지나가면 자르지 않고 그린 대로. 기능실은 꿰뚫을 수 없음 (결정 314)
                const isUtil = (currentStores.find(s => s.polygonElement === c.el) || {}).type === 'utility';
                if (passStores && !isUtil && polygonClipping.difference([[c.pts.map(p => [p.x, p.y])]], drawn).length >= 2) return;
                cut.push([c.pts.map(p => [p.x, p.y])]);
                c.pts.forEach((p, i) => {           // 변 양쪽 2px 띠 + 꼭짓점 네모 = 2px 키운 모양
                    const q = c.pts[(i + 1) % c.pts.length], L = Math.hypot(q.x - p.x, q.y - p.y);
                    cut.push([[[p.x - g, p.y - g], [p.x + g, p.y - g], [p.x + g, p.y + g], [p.x - g, p.y + g]]]);
                    if (L < 1e-6) return;
                    const nx = -(q.y - p.y) / L * g, ny = (q.x - p.x) / L * g;
                    cut.push([[[p.x + nx, p.y + ny], [q.x + nx, q.y + ny], [q.x - nx, q.y - ny], [p.x - nx, p.y - ny]]]);
                });
            });
            if (!cut.length) return rings;
            const res = polygonClipping.difference(rings.map(r => [r]), ...cut);
            // 구멍(바닥 한가운데 매장)은 바깥 고리만 남김: 길찾기는 매장 칸을 따로 빼므로 상관없음
            return res.map(poly => poly[0].slice(0, -1)).filter(r => r.length >= 3 && Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0)) > 4);
        }

        // ================= 직각(Orthogonal / 수평·수직) CAD 스냅 엔진 =================
        var isGlobalOrthoMode = false; // 전역 직각 모드 (아이패드/터치 토글 지원)

        function toggleGlobalOrthoMode() {
            isGlobalOrthoMode = !isGlobalOrthoMode;
            document.querySelectorAll('.btn-toggle-ortho').forEach(b => {
                b.classList.toggle('active', isGlobalOrthoMode);
            });
            document.querySelectorAll('.chk-ortho').forEach(c => { c.checked = isGlobalOrthoMode; });
            showToast(isGlobalOrthoMode ? '📐 직각(수평/수직) 스냅 활성화' : '📐 직각 스냅 해제', 1000);
        }

        window.isShiftKeyPressed = false;
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Shift') window.isShiftKeyPressed = true;
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Shift') window.isShiftKeyPressed = false;
        });

        // 직각 스냅 계산: 기준점(origin) 대비 현재점(current)을 수평 또는 수직으로 강제 고정
        function snapToOrtho(current, origin, forceOrtho = false) {
            if (!origin) return current;
            const isShift = (typeof window.isShiftKeyPressed !== 'undefined' && window.isShiftKeyPressed);
            if (!forceOrtho && !isShift && !isGlobalOrthoMode) {
                return current;
            }
            if (typeof fclActive === 'function' && fclActive()) {   // 복도 중심선 모드: 0·45·90도 단위로 고정 (결정 260)
                const ang = Math.round(Math.atan2(current.y - origin.y, current.x - origin.x) / (Math.PI / 4)) * (Math.PI / 4);
                const dist = Math.hypot(current.x - origin.x, current.y - origin.y);
                return { x: origin.x + Math.cos(ang) * dist, y: origin.y + Math.sin(ang) * dist };
            }
            const dx = Math.abs(current.x - origin.x);
            const dy = Math.abs(current.y - origin.y);
            if (dx >= dy) {
                return { x: current.x, y: origin.y }; // 수평선
            } else {
                return { x: origin.x, y: current.y }; // 수직선
            }
        }