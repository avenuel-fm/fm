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

        function getClosestEdgeOfPolygon(pt, poly) {
            let minDist = Infinity;
            let bestEdge = null;
            for (let i = 0; i < poly.length; i++) {
                const p1 = poly[i];
                const p2 = poly[(i + 1) % poly.length];
                const proj = projectPointToSegment(pt, p1, p2);
                const dist = Math.hypot(pt.x - proj.x, pt.y - proj.y);
                if (dist < minDist) {
                    minDist = dist;
                    bestEdge = { p1, p2 };
                }
            }
            return bestEdge;
        }

        function getOutwardNormal(edge, poly) {
            const dx = edge.p2.x - edge.p1.x;
            const dy = edge.p2.y - edge.p1.y;
            const len = Math.hypot(dx, dy) || 1;
            const n1 = { x: -dy / len, y: dx / len };
            const n2 = { x: dy / len, y: -dx / len };
            const mid = { x: (edge.p1.x + edge.p2.x) / 2, y: (edge.p1.y + edge.p2.y) / 2 };
            const test1 = { x: mid.x + n1.x * 2, y: mid.y + n1.y * 2 };
            return isPointInsidePolygon(test1, poly) ? n2 : n1;
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

        function adjustStorePolygonClearance(points) {
            if (!points || points.length < 3) return points;
            const GAP = 1; // 평행 간격 1px (결정 160, 전: 8px)
            const existingPolys = [];

            currentStores.forEach(s => {
                if (!s.polygonElement) return;
                const d = s.polygonElement.getAttribute('d') || s.pathData;
                if (!d) return;
                const polyPts = parseSvgPathPoints(d);
                if (polyPts.length >= 3) {
                    existingPolys.push(polyPts);
                }
            });

            if (existingPolys.length === 0) return points;

            let adjusted = points.map(p => ({ x: p.x, y: p.y }));
            let hadCollision = false;

            adjusted.forEach((pt) => {
                for (const poly of existingPolys) {
                    if (isPointInsidePolygon(pt, poly) || distancePointToPolygon(pt, poly) < GAP) {
                        hadCollision = true;
                        const closestEdge = getClosestEdgeOfPolygon(pt, poly);
                        if (closestEdge) {
                            const norm = getOutwardNormal(closestEdge, poly);
                            const proj = projectPointToSegment(pt, closestEdge.p1, closestEdge.p2);
                            pt.x = proj.x + norm.x * GAP;
                            pt.y = proj.y + norm.y * GAP;
                        }
                    }
                }
            });

            if (hadCollision) {
                showToast('기존 도형과 겹치지 않도록 외곽선을 따라 8px 간격으로 평행 조정되었습니다.', 1500);
            }
            return adjusted;
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
            const dx = Math.abs(current.x - origin.x);
            const dy = Math.abs(current.y - origin.y);
            if (dx >= dy) {
                return { x: current.x, y: origin.y }; // 수평선
            } else {
                return { x: origin.x, y: current.y }; // 수직선
            }
        }