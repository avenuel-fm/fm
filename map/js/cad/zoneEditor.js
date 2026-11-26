/* ==========================================================================
   zoneEditor.js - 방화구역/제연구획/외벽 선 및 면 CAD 드로잉, 속성 모달, 라벨 드래그 & 자석 스냅
   ========================================================================== */

var isZoneDrawingMode = false;
var currentZoneCategory = 'fire'; // 'fire' | 'smoke' | 'wall'
var currentZoneGeometry = 'polygon'; // 'line' | 'polygon'
var drawingZonePoints = [];
var tempZoneDrawingGroup = null;
var activeSelectedZone = null;

var zoneFilterState = {
    fire: true,
    smoke: true,
    wall: true,
    floor: false   // 바닥은 평소 흰색이라 안 보임. 켜면 검은 점선 (결정 216)
};

function onZoneCheckboxChange(category, isChecked) {
    zoneFilterState[category] = isChecked;
    if (category === 'floor') {   // 바닥: 도형은 늘 그려져 있고, 켜면 검은 점선 테두리만 보임
        if (typeof mapContainer !== 'undefined' && mapContainer) mapContainer.classList.toggle('show-floor-outline', isChecked);
        return;
    }
    const svgEl = (typeof mapContainer !== 'undefined' && mapContainer) ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    const items = svgEl.querySelectorAll(`.safety-zone-item[data-zone-category="${category}"]`);
    items.forEach(el => {
        el.style.display = isChecked ? 'inline' : 'none';
    });
}

/* 레이어 열쇠(잠금): 켜면 그 레이어 도형은 수정·삭제 안 됨. 이 기기 브라우저에만 기억 */
var layerLockState = {};
try { layerLockState = JSON.parse(localStorage.getItem('lotte_map_layer_locks') || '{}') || {}; } catch (e) { layerLockState = {}; }
function isLayerLocked(key) { return !!layerLockState[key]; }
function warnLayerLocked() { if (typeof showToast === 'function') showToast('🔑 잠긴 레이어입니다. 열쇠를 풀어야 수정할 수 있습니다.', 2200); }
function onLayerLockChange(key, on) {
    layerLockState[key] = !!on;
    try { localStorage.setItem('lotte_map_layer_locks', JSON.stringify(layerLockState)); } catch (e) {}
}
function syncLayerLockCheckboxes() { document.querySelectorAll('input.chk-lock[data-lock]').forEach(i => { i.checked = isLayerLocked(i.dataset.lock); }); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncLayerLockCheckboxes); else syncLayerLockCheckboxes();

var NS_SVG = 'http://www.w3.org/2000/svg';
function ensureSvgLayer(svgEl, id) {
    let g = svgEl.querySelector('#' + id);
    if (!g) { g = document.createElementNS(NS_SVG, 'g'); g.setAttribute('id', id); svgEl.appendChild(g); }
    return g;
}
/** 바닥 층: 삭제한 매장 자리의 흰 바닥(#floor-vacant) + 직접 그린 바닥(#floor-user). 매장·기능실보다 늘 아래 (결정 216) */
function ensureFloorLayer(svgEl) {
    const layer = ensureSvgLayer(svgEl, 'floor-layer');
    ['floor-vacant', 'floor-user'].forEach(id => {
        if (!layer.querySelector('#' + id)) { const g = document.createElementNS(NS_SVG, 'g'); g.setAttribute('id', id); layer.appendChild(g); }
    });
    return layer;
}
/** 업체 도면의 매장(g.store-group)을 바닥 위 층으로 옮김 — 바닥을 겹쳐 그려도 매장이 위 */
function liftVendorStores(svgEl) {
    const layer = ensureSvgLayer(svgEl, 'vendor-stores-layer');
    Array.from(svgEl.querySelectorAll('g.store-group'))
        .filter(g => !g.closest('#custom-stores-top-layer') && !g.closest('#vendor-stores-layer'))
        .forEach(g => layer.appendChild(g));
}

/** 지우개: 매장·바닥·배관만 구멍을 뚫은 마스크로 맨 위에서 흰색으로 칠함 (인포·심벌·구역·도면 원본이 지워짐) */
function rebuildEraserMask(svgEl) {
    svgEl = svgEl || ((typeof mapContainer !== 'undefined' && mapContainer) ? mapContainer.querySelector('svg') : null);
    if (!svgEl) return;
    const layer = svgEl.querySelector('#eraser-layer');
    if (!layer) return;
    let defs = svgEl.querySelector('#eraser-defs');
    if (!layer.querySelector('polygon')) { layer.removeAttribute('mask'); if (defs) defs.remove(); return; }
    if (!defs) { defs = document.createElementNS(NS_SVG, 'defs'); defs.setAttribute('id', 'eraser-defs'); svgEl.insertBefore(defs, svgEl.firstChild); }
    defs.textContent = '';
    const mask = document.createElementNS(NS_SVG, 'mask');
    mask.setAttribute('id', 'eraser-mask');
    mask.setAttribute('maskUnits', 'userSpaceOnUse');
    mask.setAttribute('x', '-100000'); mask.setAttribute('y', '-100000'); mask.setAttribute('width', '300000'); mask.setAttribute('height', '300000');
    const add = (tag, attrs) => { const e = document.createElementNS(NS_SVG, tag); Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k])); mask.appendChild(e); };
    add('rect', { x: -100000, y: -100000, width: 300000, height: 300000, fill: '#fff' });
    const holes = svgEl.querySelectorAll('#vendor-stores-layer path.store-polygon, #custom-stores-top-layer path.store-polygon, #floor-layer path, #floor-layer polygon');
    holes.forEach(src => {
        const a = { fill: '#000', stroke: '#000', 'stroke-width': '2' };
        ['d', 'points', 'transform'].forEach(k => { if (src.hasAttribute(k)) a[k] = src.getAttribute(k); });
        add(src.tagName.toLowerCase(), a);
    });
    svgEl.querySelectorAll('#utility-lines-layer polyline.util-feeder-line').forEach(src => {
        add('polyline', { points: src.getAttribute('points') || '', fill: 'none', stroke: '#000', 'stroke-width': '12', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    });
    defs.appendChild(mask);
    layer.setAttribute('mask', 'url(#eraser-mask)');
}

function bringZoneLayersToFront() {
    const svgEl = (typeof mapContainer !== 'undefined' && mapContainer) ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    ensureFloorLayer(svgEl);
    liftVendorStores(svgEl);
    ensureSvgLayer(svgEl, 'eraser-layer');
    ensureSvgLayer(svgEl, 'floor-outline-layer');
    // 인포 레이어 (엘리베이터·화장실 등 업체 도면 그림): 직접 그린 매장보다 위 (결정 160)
    const infoLayer = typeof collectInfoLayer === 'function' ? collectInfoLayer(svgEl) : null;
    // 아래 → 위. 바닥 < 매장·기능실 < 격자 < 배관 < 구역 < 인포 < 심벌 < 지우개 < 그리는 중 (결정 216)
    [svgEl.querySelector('#floor-layer'), svgEl.querySelector('#vendor-stores-layer'), svgEl.querySelector('#custom-stores-top-layer'),
        svgEl.querySelector('#cad-floor-grid-rect'), svgEl.querySelector('#utility-lines-layer'), svgEl.querySelector('#safety-zones-layer'),
        infoLayer, svgEl.querySelector('#map-symbols-layer'), svgEl.querySelector('#eraser-layer'), svgEl.querySelector('#floor-outline-layer'),
        svgEl.querySelector('#temp-zone-drawing-layer'), svgEl.querySelector('#temp-drawing-layer')
    ].forEach(el => { if (el && (el.parentElement === svgEl || el === infoLayer)) svgEl.appendChild(el); });   // 인포는 처음 만들 때 아직 도면에 안 붙어 있음
    rebuildEraserMask(svgEl);
}

        // ================= 구역(방화구역/제연구획/외벽) CAD 엔진 =================
        var zoneCatBeforeEraser = 'fire';
        function setZoneCategory(cat) {
            currentZoneCategory = cat;   // 'fire' | 'smoke' | 'wall' | 'floor' | 'erase'
            const isErase = cat === 'erase';
            ['fire', 'smoke', 'wall', 'floor'].forEach(c => {
                const b = document.getElementById('btn-zone-cat-' + c);
                if (!b) return;
                b.classList.toggle('active', cat === c);
                b.disabled = isErase;   // 지우개를 켜면 구역 종류는 잠김
            });
            document.getElementById('btn-zone-eraser')?.classList.toggle('on', isErase);

            // 방화구역·바닥·지우개는 면(영역)만, 제연구획·외벽은 선(경계)만
            const polyOnly = cat === 'fire' || cat === 'floor' || cat === 'erase';
            const btnLine = document.getElementById('btn-zone-geom-line');
            const btnPoly = document.getElementById('btn-zone-geom-polygon');
            if (btnLine) { btnLine.disabled = polyOnly; btnLine.classList.toggle('active', !polyOnly); }
            if (btnPoly) { btnPoly.disabled = !polyOnly; btnPoly.classList.toggle('active', polyOnly); }
            currentZoneGeometry = polyOnly ? 'polygon' : 'line';

            if (typeof syncCenterlineUI === 'function') syncCenterlineUI();   // 바닥일 때만 중심선 줄 보임 (결정 260)
            updateZoneGuideUI();
            updateZoneDrawingPreview();
        }

        // 지우개 켜기/끄기 (결정 216): 켜면 구역 종류는 잠기고 면으로 그려 바닥색으로 칠함
        function toggleEraserMode() {
            if (!isZoneDrawingMode) return;
            if (currentZoneCategory === 'erase') {
                setZoneCategory(zoneCatBeforeEraser || 'fire');
            } else {
                if (typeof deselectWallZone === 'function') deselectWallZone();
                zoneCatBeforeEraser = currentZoneCategory || 'fire';
                drawingZonePoints = [];
                setZoneCategory('erase');
            }
        }

        function setZoneGeometry(geom) {
            // 방화구역은 면만 허용, 제연구획 및 외벽은 선만 허용
            if (currentZoneCategory === 'fire' && geom === 'line') return;
            if ((currentZoneCategory === 'smoke' || currentZoneCategory === 'wall') && geom === 'polygon') return;

            currentZoneGeometry = geom;
            document.getElementById('btn-zone-geom-line')?.classList.toggle('active', geom === 'line');
            document.getElementById('btn-zone-geom-polygon')?.classList.toggle('active', geom === 'polygon');
            updateZoneGuideUI();
            updateZoneDrawingPreview();
        }

        function updateZoneGuideUI() {
            const ptsBadge = document.getElementById('zone-points-indicator');
            if (ptsBadge) {
                ptsBadge.textContent = `${drawingZonePoints.length}점`;
            }
            const btnFinish = document.querySelector('.btn-guide-finish');
            if (btnFinish) {
                const minPts = currentZoneGeometry === 'polygon' ? 3 : 2;
                btnFinish.disabled = drawingZonePoints.length < minPts;
                btnFinish.style.opacity = drawingZonePoints.length < minPts ? '0.6' : '1';
            }
        }

        function toggleAddZoneMode() {
            if (isDrawingMode) exitAddStoreMode();
            isZoneDrawingMode = !isZoneDrawingMode;

            if (isZoneDrawingMode) {
                document.body.classList.add('drawing-locked');
                document.body.classList.add('zone-drawing-mode');
                btnAddZone?.classList.add('active-mode');
                btnAddZone?.querySelector('span') && (btnAddZone.querySelector('span').textContent = '구역 종료 (ESC)');
                viewport.classList.add('crosshair');
                if (zoneGuideBanner) zoneGuideBanner.style.display = 'flex';
                drawingZonePoints = [];
                createTempZoneDrawingGroup();
                setZoneCategory(currentZoneCategory || 'fire');
                const orthoChk = document.getElementById('chk-zone-ortho');
                if (orthoChk) orthoChk.checked = !!isGlobalOrthoMode;
                showFloorGrid();
                updateZoneGuideUI();
                showToast('도면을 클릭하여 선/면 구역의 꼭짓점들을 연결하세요.', 1500);
            } else {
                exitAddZoneMode();
            }
        }

        function exitAddZoneMode() {
            isZoneDrawingMode = false;
            if (currentZoneCategory === 'erase') currentZoneCategory = zoneCatBeforeEraser || 'fire';   // 지우개는 한 번 쓰면 꺼짐
            deselectWallZone();
            document.body.classList.remove('drawing-locked');
            document.body.classList.remove('zone-drawing-mode');
            btnAddZone?.classList.remove('active-mode');
            btnAddZone?.querySelector('span') && (btnAddZone.querySelector('span').textContent = '구역 추가/편집');
            viewport.classList.remove('crosshair');
            if (zoneGuideBanner) zoneGuideBanner.style.display = 'none';
            cleanupTempZoneDrawingGroup();
            drawingZonePoints = [];
            hideFloorGrid();
        }

        function createTempZoneDrawingGroup() {
            cleanupTempZoneDrawingGroup();
            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return;
            tempZoneDrawingGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tempZoneDrawingGroup.setAttribute('id', 'temp-zone-drawing-layer');
            tempZoneDrawingGroup.style.pointerEvents = 'none';
            svgEl.appendChild(tempZoneDrawingGroup);
            bringZoneLayersToFront();
        }

        function cleanupTempZoneDrawingGroup() {
            if (tempZoneDrawingGroup) {
                tempZoneDrawingGroup.remove();
                tempZoneDrawingGroup = null;
            }
            if (typeof mapContainer !== 'undefined' && mapContainer) {
                mapContainer.querySelectorAll('#temp-zone-drawing-layer, circle[stroke="#0ea5e9"], circle[fill="rgba(14, 165, 233, 0.25)"]').forEach(el => el.remove());
            }
        }

        // ================= 외벽 자석(스냅) 및 선분 투영 헬퍼 =================
        function getExteriorWallSegments() {
            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return [];
            const segments = [];

            // 1. SVG 도면 내의 기본 외벽 패스/선분들
            svgEl.querySelectorAll('.building-exterior-wall, [data-building-wall="true"]').forEach(el => {
                const tag = el.tagName.toLowerCase();
                if (tag === 'polyline' || tag === 'polygon') {
                    const ptsAttr = el.getAttribute('points') || '';
                    const pts = ptsAttr.trim().split(/\s+/).map(pair => {
                        const parts = pair.split(',');
                        if (parts.length >= 2) {
                            const x = parseFloat(parts[0]), y = parseFloat(parts[1]);
                            return (!isNaN(x) && !isNaN(y)) ? { x, y } : null;
                        }
                        return null;
                    }).filter(Boolean);
                    for (let i = 0; i < pts.length - 1; i++) {
                        segments.push({ p1: pts[i], p2: pts[i + 1] });
                    }
                    if (tag === 'polygon' && pts.length >= 3) {
                        segments.push({ p1: pts[pts.length - 1], p2: pts[0] });
                    }
                } else if (tag === 'path') {
                    const d = el.getAttribute('d') || '';
                    const pts = [];
                    const matches = d.match(/[ML]\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/gi);
                    if (matches) {
                        matches.forEach(m => {
                            const coords = m.replace(/[ML]/i, '').trim().split(/[,\s]+/);
                            if (coords.length >= 2) {
                                const x = parseFloat(coords[0]), y = parseFloat(coords[1]);
                                if (!isNaN(x) && !isNaN(y)) pts.push({ x, y });
                            }
                        });
                        for (let i = 0; i < pts.length - 1; i++) {
                            segments.push({ p1: pts[i], p2: pts[i + 1] });
                        }
                    }
                }
            });

            // 2. 저장소의 사용자가 작성한 외벽 선분 데이터 직접 추가 (누락 방지)
            if (typeof FLOORS !== 'undefined' && typeof currentFloorIdx !== 'undefined' && typeof getFloorZones === 'function') {
                const floor = FLOORS[currentFloorIdx];
                if (floor) {
                    const wallZones = getFloorZones(floor.code).filter(z => z.category === 'wall');
                    wallZones.forEach(wz => {
                        if (wz.points && wz.points.length >= 2) {
                            for (let i = 0; i < wz.points.length - 1; i++) {
                                segments.push({ p1: wz.points[i], p2: wz.points[i + 1] });
                            }
                        }
                    });
                }
            }

            // 3. 현재 그리는 중인 외벽 선분의 이전 세그먼트들도 스냅 대상으로 포함
            if (isZoneDrawingMode && currentZoneCategory === 'wall' && drawingZonePoints.length >= 2) {
                for (let i = 0; i < drawingZonePoints.length - 1; i++) {
                    segments.push({ p1: drawingZonePoints[i], p2: drawingZonePoints[i + 1] });
                }
            }

            return segments;
        }

        function snapToExteriorWall(curX, curY, threshold = 22) {
            const segments = getExteriorWallSegments();
            // 화면 배율(scale)에 관계없이 화면상 일정한 픽셀(약 20px) 거리에서 안정적으로 자석 스냅
            const screenThreshold = 20;
            const effectiveThreshold = (typeof scale === 'number' && scale > 0) ? Math.max(threshold, screenThreshold / scale) : threshold;
            let bestDistSq = effectiveThreshold * effectiveThreshold;
            let snappedPt = null;

            for (const seg of segments) {
                // 1. 꼭짓점 스냅 (우선순위 높음)
                for (const pt of [seg.p1, seg.p2]) {
                    const dSq = (curX - pt.x) * (curX - pt.x) + (curY - pt.y) * (curY - pt.y);
                    if (dSq < bestDistSq) {
                        bestDistSq = dSq;
                        snappedPt = { x: pt.x, y: pt.y, isSnapped: true, isVertex: true };
                    }
                }
                // 2. 선분 상 투영 스냅 (선과 만나면 착 달라붙는 자석 기능)
                const dx = seg.p2.x - seg.p1.x;
                const dy = seg.p2.y - seg.p1.y;
                const lenSq = dx * dx + dy * dy;
                if (lenSq > 0) {
                    const t = Math.max(0, Math.min(1, ((curX - seg.p1.x) * dx + (curY - seg.p1.y) * dy) / lenSq));
                    const projX = seg.p1.x + t * dx;
                    const projY = seg.p1.y + t * dy;
                    const dSq = (curX - projX) * (curX - projX) + (curY - projY) * (curY - projY);
                    if (dSq < bestDistSq) {
                        bestDistSq = dSq;
                        snappedPt = { x: projX, y: projY, isSnapped: true, isVertex: false };
                    }
                }
            }

            if (snappedPt) return snappedPt;
            return { x: curX, y: curY, isSnapped: false };
        }

        // 라인을 따라 글자박스(라벨)를 이동시키기 위한 최근접 선분 투영
        function getClosestPointOnZoneLine(points, isClosed, px, py) {
            let closestPt = { x: px, y: py };
            let minDistSq = Infinity;
            const len = points.length;
            if (len === 0) return closestPt;
            if (len === 1) return { x: points[0].x, y: points[0].y };

            const numSegments = isClosed ? len : len - 1;
            for (let i = 0; i < numSegments; i++) {
                const A = points[i];
                const B = points[(i + 1) % len];
                const dx = B.x - A.x;
                const dy = B.y - A.y;
                const segLenSq = dx * dx + dy * dy;
                let t = 0;
                if (segLenSq > 0) {
                    t = Math.max(0, Math.min(1, ((px - A.x) * dx + (py - A.y) * dy) / segLenSq));
                }
                const projX = A.x + t * dx;
                const projY = A.y + t * dy;
                const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    closestPt = { x: projX, y: projY };
                }
            }
            return closestPt;
        }

        function updateZoneDrawingPreview(currentMouseSvgX = null, currentMouseSvgY = null) {
            if (!tempZoneDrawingGroup) return;
            const svgEl = mapContainer.querySelector('svg');
            if (svgEl && svgEl.lastElementChild !== tempZoneDrawingGroup) {
                svgEl.appendChild(tempZoneDrawingGroup);
            }
            tempZoneDrawingGroup.innerHTML = '';
            if (drawingZonePoints.length === 0 && currentMouseSvgX === null) return;
            if (typeof fclActive === 'function' && fclActive()) { fclPreview(tempZoneDrawingGroup, currentMouseSvgX, currentMouseSvgY); return; }   // 복도 중심선 띠 미리보기

            const isPoly = currentZoneGeometry === 'polygon';
            const isWall = currentZoneCategory === 'wall';
            const isSmoke = currentZoneCategory === 'smoke';

            const isFloorCat = currentZoneCategory === 'floor';
            const isEraseCat = currentZoneCategory === 'erase';
            const strokeColor = isEraseCat ? '#2563eb' : (isFloorCat ? '#000000' : (isWall ? '#334155' : (isSmoke ? '#0284c7' : '#dc2626')));
            const strokeDash = isWall ? '' : '8 5';
            const strokeWidth = isWall ? '4' : (isPoly ? '3' : '3.5');
            const fillColor = isEraseCat ? 'rgba(37, 99, 235, 0.12)' : (isFloorCat ? 'rgba(0, 0, 0, 0.06)' : (isWall ? (isPoly ? 'rgba(51, 65, 85, 0.12)' : 'none') : (isPoly ? 'rgba(220, 38, 38, 0.18)' : 'none')));

            // 1. 고정된 점들을 연결하는 선/면
            if (drawingZonePoints.length > 0) {
                if (isPoly && drawingZonePoints.length >= 3) {
                    const polyPoints = drawingZonePoints.map(p => `${p.x},${p.y}`).join(' ');
                    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    poly.setAttribute('points', polyPoints);
                    poly.setAttribute('stroke', strokeColor);
                    poly.setAttribute('stroke-width', strokeWidth);
                    if (strokeDash) poly.setAttribute('stroke-dasharray', strokeDash);
                    poly.setAttribute('fill', fillColor);
                    poly.setAttribute('stroke-linejoin', 'round');
                    tempZoneDrawingGroup.appendChild(poly);
                } else {
                    const polylinePoints = drawingZonePoints.map(p => `${p.x},${p.y}`).join(' ');
                    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                    polyline.setAttribute('points', polylinePoints);
                    polyline.setAttribute('stroke', strokeColor);
                    polyline.setAttribute('stroke-width', strokeWidth);
                    if (strokeDash) polyline.setAttribute('stroke-dasharray', strokeDash);
                    polyline.setAttribute('stroke-linecap', 'round');
                    polyline.setAttribute('stroke-linejoin', 'round');
                    polyline.setAttribute('fill', 'none');
                    tempZoneDrawingGroup.appendChild(polyline);
                }
            }

            // 외벽 드로잉 시 자석(스냅) 처리
            let targetX = currentMouseSvgX;
            let targetY = currentMouseSvgY;
            let snapInfo = null;

            if (currentMouseSvgX !== null && currentMouseSvgY !== null) {
                if (isWall) {
                    snapInfo = snapToExteriorWall(currentMouseSvgX, currentMouseSvgY);
                    if (snapInfo.isSnapped) {
                        targetX = snapInfo.x;
                        targetY = snapInfo.y;
                    }
                }
                if ((!snapInfo || !snapInfo.isSnapped) && typeof snapToGrid === 'function') {
                    const gSnap = snapToGrid(currentMouseSvgX, currentMouseSvgY);
                    if (gSnap.isSnapped) {
                        snapInfo = { x: gSnap.x, y: gSnap.y, isSnapped: true, isGrid: true };
                        targetX = gSnap.x;
                        targetY = gSnap.y;
                    }
                }

                // 직각 체크(또는 Shift): 미리보기도 수평·수직으로
                if (drawingZonePoints.length > 0 && typeof snapToOrtho === 'function') {
                    const o = snapToOrtho({ x: targetX, y: targetY }, drawingZonePoints[drawingZonePoints.length - 1]);
                    targetX = o.x;
                    targetY = o.y;
                }

                // 2. 마우스 커서로 이어지는 실시간 러버밴드 가이드 선
                if (drawingZonePoints.length > 0) {
                    const lastPt = drawingZonePoints[drawingZonePoints.length - 1];
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('x1', lastPt.x);
                    line.setAttribute('y1', lastPt.y);
                    line.setAttribute('x2', targetX);
                    line.setAttribute('y2', targetY);
                    line.setAttribute('stroke', strokeColor);
                    line.setAttribute('stroke-width', isWall ? '3.5' : '2.5');
                    if (strokeDash) line.setAttribute('stroke-dasharray', '6 4');
                    tempZoneDrawingGroup.appendChild(line);

                    if (isPoly && drawingZonePoints.length >= 2) {
                        const firstPt = drawingZonePoints[0];
                        // 3점 이상이고 시작점에 근접한 경우 시작점으로 자동 스냅
                        if (drawingZonePoints.length >= 3 && Math.hypot((targetX - firstPt.x) * scale, (targetY - firstPt.y) * scale) < 22) {
                            targetX = firstPt.x;
                            targetY = firstPt.y;
                        }

                        const closeLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                        closeLine.setAttribute('x1', targetX);
                        closeLine.setAttribute('y1', targetY);
                        closeLine.setAttribute('x2', firstPt.x);
                        closeLine.setAttribute('y2', firstPt.y);
                        closeLine.setAttribute('stroke', strokeColor);
                        closeLine.setAttribute('stroke-width', '1.5');
                        if (strokeDash) closeLine.setAttribute('stroke-dasharray', '4 4');
                        closeLine.setAttribute('opacity', '0.6');
                        tempZoneDrawingGroup.appendChild(closeLine);
                    }
                }

                // 자석 스냅 인디케이터 표시
                if (snapInfo && snapInfo.isSnapped) {
                    const snapRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    snapRing.setAttribute('cx', targetX.toFixed(1));
                    snapRing.setAttribute('cy', targetY.toFixed(1));
                    snapRing.setAttribute('r', '7');
                    snapRing.setAttribute('fill', 'rgba(14, 165, 233, 0.25)');
                    snapRing.setAttribute('stroke', '#0ea5e9');
                    snapRing.setAttribute('stroke-width', '2.5');
                    tempZoneDrawingGroup.appendChild(snapRing);

                    const snapDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    snapDot.setAttribute('cx', targetX.toFixed(1));
                    snapDot.setAttribute('cy', targetY.toFixed(1));
                    snapDot.setAttribute('r', '2.5');
                    snapDot.setAttribute('fill', '#0ea5e9');
                    tempZoneDrawingGroup.appendChild(snapDot);
                }
            }

            // 3. 꼭짓점 원형 마커 (시작점 강조)
            drawingZonePoints.forEach((p, i) => {
                const isStart = i === 0 && (isPoly || drawingZonePoints.length >= 3);
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', p.x);
                circle.setAttribute('cy', p.y);
                circle.setAttribute('r', isStart ? '8' : '5');
                circle.setAttribute('fill', isStart ? strokeColor : '#ffffff');
                circle.setAttribute('stroke', strokeColor);
                circle.setAttribute('stroke-width', '2.5');
                tempZoneDrawingGroup.appendChild(circle);

                // 시작점 외곽 펄스 링 (B1 등 대형 도면에서도 한눈에 시작점이 파악 가능)
                if (isStart) {
                    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    halo.setAttribute('cx', p.x);
                    halo.setAttribute('cy', p.y);
                    halo.setAttribute('r', '15');
                    halo.setAttribute('fill', 'none');
                    halo.setAttribute('stroke', strokeColor);
                    halo.setAttribute('stroke-width', '2');
                    halo.setAttribute('stroke-dasharray', '3 3');
                    halo.setAttribute('opacity', '0.8');
                    tempZoneDrawingGroup.appendChild(halo);
                }
            });
        }

        // ================= 외벽 선택 및 정점 편집(수정) 기능 =================
        var activeEditingWallZone = null;
        var wallVertexHandlesGroup = null;

        function cleanupWallVertexHandles() {
            if (wallVertexHandlesGroup) {
                wallVertexHandlesGroup.remove();
                wallVertexHandlesGroup = null;
            }
            const existing = mapContainer ? mapContainer.querySelector('#wall-vertex-handles-layer') : document.getElementById('wall-vertex-handles-layer');
            if (existing) existing.remove();
        }

        function deselectWallZone() {
            if (!activeEditingWallZone) return;
            activeEditingWallZone = null;
            cleanupWallVertexHandles();
            const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
            if (svgEl) {
                svgEl.querySelectorAll('.safety-zone-item.selected-zone').forEach(el => el.classList.remove('selected-zone'));
            }
            if (zoneGuideBanner) {
                const titleEl = zoneGuideBanner.querySelector('.guide-banner-title') || zoneGuideBanner.querySelector('span');
                if (titleEl) titleEl.textContent = '도면을 클릭하여 선/면 구역의 꼭짓점들을 연결하세요.';
            }
        }

        function selectAndEditWallZone(zone) {
            closeAllPopovers();
            // 기존 작성 중이던 임시 드로잉 점 초기화
            if (drawingZonePoints.length > 0) {
                drawingZonePoints = [];
                updateZoneDrawingPreview();
                updateZoneGuideUI();
            }

            activeEditingWallZone = zone;
            activeSelectedZone = zone;

            // 외벽 카테고리로 활성화
            if (currentZoneCategory !== 'wall') {
                setZoneCategory('wall');
            }

            const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
            if (svgEl) {
                svgEl.querySelectorAll('.safety-zone-item').forEach(el => el.classList.remove('selected-zone'));
                const targetGroup = svgEl.querySelector(`.safety-zone-item[data-zone-id="${zone.id}"]`);
                if (targetGroup) targetGroup.classList.add('selected-zone');
            }

            renderWallVertexHandles(zone);

            if (zoneGuideBanner) {
                const titleEl = zoneGuideBanner.querySelector('.guide-banner-title') || zoneGuideBanner.querySelector('span');
                if (titleEl) {
                    titleEl.textContent = '🧱 외벽 수정 모드: 꼭짓점을 드래그하여 모양을 변경하거나 도면을 클릭하여 선을 이어갈 수 있습니다. (ESC: 완료)';
                }
            }
            showToast('외벽 선분이 선택되었습니다. 꼭짓점을 드래그하여 수정하세요.', 1500);
        }

        function renderWallVertexHandles(zone) {
            cleanupWallVertexHandles();
            const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
            if (!svgEl || !zone.points || zone.points.length === 0) return;

            wallVertexHandlesGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            wallVertexHandlesGroup.setAttribute('id', 'wall-vertex-handles-layer');
            svgEl.appendChild(wallVertexHandlesGroup);

            zone.points.forEach((pt, idx) => {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('class', 'wall-vertex-handle');
                circle.setAttribute('cx', pt.x.toFixed(1));
                circle.setAttribute('cy', pt.y.toFixed(1));
                circle.setAttribute('r', '6');
                circle.setAttribute('fill', '#ffffff');
                circle.setAttribute('stroke', '#0284c7');
                circle.setAttribute('stroke-width', '2.5');
                circle.style.cursor = 'move';
                circle.setAttribute('data-point-idx', idx);

                circle.onpointerdown = (e) => {
                    e.stopPropagation();
                    let hasMoved = false;
                    const startX = e.clientX;
                    const startY = e.clientY;

                    circle.setPointerCapture(e.pointerId);

                    const onPointerMove = (ev) => {
                        const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
                        if (dist > 2) hasMoved = true;
                        if (!hasMoved) return;

                        const rect = mapContainer.getBoundingClientRect();
                        const curCrop = FLOORS[currentFloorIdx].crop;
                        let rawSvgX = curCrop.minX + (ev.clientX - rect.left) / scale;
                        let rawSvgY = curCrop.minY + (ev.clientY - rect.top) / scale;

                        // 스냅 (그리드 및 외벽 스냅)
                        let newX = rawSvgX;
                        let newY = rawSvgY;
                        const wSnap = snapToExteriorWall(rawSvgX, rawSvgY);
                        if (wSnap.isSnapped) {
                            newX = wSnap.x;
                            newY = wSnap.y;
                        } else if (typeof snapToGrid === 'function') {
                            const gSnap = snapToGrid(rawSvgX, rawSvgY);
                            if (gSnap.isSnapped) {
                                newX = gSnap.x;
                                newY = gSnap.y;
                            }
                        }

                        // 좌표 갱신
                        zone.points[idx] = { x: newX, y: newY };
                        circle.setAttribute('cx', newX.toFixed(1));
                        circle.setAttribute('cy', newY.toFixed(1));

                        // 해당 외벽 shapeEl의 points 실시간 업데이트
                        const polylineEl = svgEl.querySelector(`.safety-zone-item[data-zone-id="${zone.id}"] polyline, .safety-zone-item[data-zone-id="${zone.id}"] polygon`);
                        if (polylineEl) {
                            const newPtsStr = zone.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
                            polylineEl.setAttribute('points', newPtsStr);
                        }
                    };

                    const onPointerUp = (ev) => {
                        circle.releasePointerCapture(ev.pointerId);
                        circle.removeEventListener('pointermove', onPointerMove);
                        circle.removeEventListener('pointerup', onPointerUp);

                        if (hasMoved) {
                            pushUndoState('외벽 꼭짓점 수정');
                            const floor = FLOORS[currentFloorIdx];
                            const curZones = getFloorZones(floor.code);
                            const tZone = curZones.find(z => z.id === zone.id);
                            if (tZone) {
                                tZone.points = [...zone.points];
                                saveFloorZones(floor.code, curZones);
                                syncSvgCache();
                            }
                            showToast('외벽 선분이 수정되었습니다.', 1200);
                        }
                    };

                    circle.addEventListener('pointermove', onPointerMove);
                    circle.addEventListener('pointerup', onPointerUp);
                };

                wallVertexHandlesGroup.appendChild(circle);
            });

            // 핸들 레이어를 최상단으로
            svgEl.appendChild(wallVertexHandlesGroup);
        }

        function handleZoneCancelOrEsc() {
            // 외벽 수정 모드 중이면 외벽 선택 해제
            if (activeEditingWallZone) {
                deselectWallZone();
                showToast('외벽 수정이 완료되었습니다.', 1200);
                return;
            }
            // 제연구획(smoke) 및 외벽(wall) 선분 그리기 진행 시 2점 이상 작성된 상태에서 ESC/취소 시: 그려진 부분 유지 및 완성
            if (isZoneDrawingMode && (currentZoneCategory === 'smoke' || currentZoneCategory === 'wall') && drawingZonePoints.length >= 2) {
                finishDrawingZone();
                return;
            }
            // 찍던 점이 있으면 점만 지우고 그리기 상태 그대로. 점이 없을 때만 보기 상태로 (결정 314)
            if (isZoneDrawingMode && drawingZonePoints.length) { continueZoneDrawing(); return; }
            exitAddZoneMode();
        }

        // 완료·취소 뒤 같은 종류로 다음 도형을 바로 그림 (결정 314)
        function continueZoneDrawing() {
            drawingZonePoints = [];
            createTempZoneDrawingGroup();
            updateZoneGuideUI();
            updateZoneDrawingPreview();
        }

        function finishDrawingZone() {
            if (typeof fclActive === 'function' && fclActive()) { finishCenterlineFloor(); return; }   // 복도 중심선 → 띠 만들고 합치기 (결정 260)
            const minPts = currentZoneGeometry === 'polygon' ? 3 : 2;
            if (drawingZonePoints.length < minPts) {
                showToast(currentZoneGeometry === 'polygon' ? '구역 면을 완성하려면 3개 이상의 점이 필요합니다.' : '구역 선을 완성하려면 2개 이상의 점이 필요합니다.', 1500);
                return;
            }

            // 바닥이 매장·기능실을 침범하면 그 자리를 빼고 둘레 2px 밖으로 (결정 308). 여러 조각이 되면 조각마다 바닥 하나
            let floorRings = null;
            if (currentZoneCategory === 'floor' && currentZoneGeometry === 'polygon') {
                try { floorRings = floorAvoidStores([drawingZonePoints.map(p => [p.x, p.y])]).map(r => r.map(q => ({ x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10 }))); }
                catch (err) { console.warn('매장 피하기 실패, 그린 그대로', err); }
                if (floorRings && !floorRings.length) { showToast('그린 바닥이 모두 매장 안이라 남는 곳이 없습니다.', 2000); return; }
            }

            pushUndoState('구역 추가');

            const floor = FLOORS[currentFloorIdx];
            const isWall = currentZoneCategory === 'wall';
            const zones = getFloorZones(floor.code);
            let zoneName = '';
            if (isWall) {
                // 외벽은 외벽1 외벽2 같은 번호 이름을 붙이지 않고 '외벽'으로 통일
                zoneName = '외벽';
            } else {
                const categoryName = { fire: '방화구역', smoke: '제연구획', floor: '바닥', erase: '지우개' }[currentZoneCategory] || '구역';
                const countOfCat = zones.filter(z => z.category === currentZoneCategory).length + 1;
                zoneName = `${categoryName} ${countOfCat}`;
            }

            const newZone = {
                id: 'zone_' + Date.now(),
                name: zoneName,
                category: currentZoneCategory, // 'fire' | 'smoke' | 'wall'
                geometry: currentZoneGeometry, // 'line' | 'polygon'
                points: [...drawingZonePoints],
                createdAt: Date.now()
            };

            if (floorRings) floorRings.forEach((ring, i) => zones.push(Object.assign({}, newZone, { id: newZone.id + (i ? '_' + i : ''), name: i ? `바닥 ${zones.filter(z => z.category === 'floor').length + 1}` : zoneName, points: ring })));
            else zones.push(newZone);
            saveFloorZones(floor.code, zones);

            cleanupTempZoneDrawingGroup();
            renderFloorZones(floor.code);
            syncSvgCache();
            continueZoneDrawing();   // 그리기 상태 그대로 (결정 314)

            showToast(isWall ? '외벽이 추가되었습니다.' : `'${zoneName}'이 추가되었습니다.`, 1500);
        }

        // 도면 상의 구역(방화구역/제연구획/외벽) SVG 레이어 렌더링
        function renderFloorZones(floorCode) {
            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return;

            let zonesLayer = svgEl.querySelector('#safety-zones-layer');
            if (!zonesLayer) {
                zonesLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                zonesLayer.setAttribute('id', 'safety-zones-layer');
                svgEl.appendChild(zonesLayer);
            } else {
                zonesLayer.innerHTML = '';
            }

            const zones = getFloorZones(floorCode);
            ensureFloorLayer(svgEl).querySelector('#floor-user').textContent = '';
            // 직접 그린 바닥은 색 없는 투명 점선만, 맨 위 층(#floor-outline-layer). 겹친 바닥의 안쪽 선은 마스크로 가림 (결정 250)
            const outLayer = ensureSvgLayer(svgEl, 'floor-outline-layer');
            outLayer.textContent = '';
            const lineG = document.createElementNS(NS_SVG, 'g');
            lineG.setAttribute('class', 'floor-lines');
            const floorZones = zones.filter(z => z.category === 'floor' && z.points && z.points.length >= 3);
            if (floorZones.length) {
                const defs = document.createElementNS(NS_SVG, 'defs'), mask = document.createElementNS(NS_SVG, 'mask');
                mask.setAttribute('id', 'floor-union-mask'); mask.setAttribute('maskUnits', 'userSpaceOnUse');
                mask.setAttribute('x', '-100000'); mask.setAttribute('y', '-100000'); mask.setAttribute('width', '300000'); mask.setAttribute('height', '300000');
                const bg = document.createElementNS(NS_SVG, 'rect');
                ['x', 'y'].forEach(k => bg.setAttribute(k, '-100000')); ['width', 'height'].forEach(k => bg.setAttribute(k, '300000')); bg.setAttribute('fill', '#fff');
                mask.appendChild(bg);
                floorZones.forEach(z => {
                    const h = document.createElementNS(NS_SVG, 'polygon');
                    h.setAttribute('points', z.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
                    h.setAttribute('fill', '#000');
                    mask.appendChild(h);
                });
                defs.appendChild(mask); outLayer.appendChild(defs);
                lineG.setAttribute('mask', 'url(#floor-union-mask)');
            }
            outLayer.appendChild(lineG);
            const eraserLayer = ensureSvgLayer(svgEl, 'eraser-layer');
            Array.from(eraserLayer.querySelectorAll('polygon')).forEach(e => e.remove());
            zones.forEach(zone => {
                if (zone.category === 'floor' || zone.category === 'erase') {   // 바닥·지우개는 자기 층에 (결정 216)
                    renderPaintZone(zone, lineG, eraserLayer);
                    return;
                }
                const zoneGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                zoneGroup.setAttribute('class', 'safety-zone-item');
                zoneGroup.setAttribute('data-zone-id', zone.id);
                zoneGroup.setAttribute('data-zone-category', zone.category);
                if (typeof zoneFilterState !== 'undefined' && zoneFilterState[zone.category] !== undefined) {
                    zoneGroup.style.display = zoneFilterState[zone.category] ? 'inline' : 'none';
                }

                const isWall = zone.category === 'wall';
                const isSmoke = zone.category === 'smoke';
                const isPoly = zone.geometry === 'polygon';
                const strokeColor = isWall ? '#334155' : (isSmoke ? '#0284c7' : '#dc2626');
                const strokeDash = isWall ? '' : '8 5';
                const strokeWidth = isWall ? '4' : (isPoly ? '3' : '3.5');
                const fillColor = isWall ? (isPoly ? 'rgba(51, 65, 85, 0.12)' : 'none') : (isPoly ? 'rgba(220, 38, 38, 0.18)' : 'none');

                const pointsStr = zone.points.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

                let shapeEl;
                if (isPoly) {
                    shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                    shapeEl.setAttribute('points', pointsStr);
                    shapeEl.setAttribute('fill', fillColor);
                    shapeEl.setAttribute('stroke', strokeColor);
                    shapeEl.setAttribute('stroke-width', strokeWidth);
                    if (strokeDash) shapeEl.setAttribute('stroke-dasharray', strokeDash);
                    shapeEl.setAttribute('stroke-linejoin', 'round');
                } else {
                    shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                    shapeEl.setAttribute('points', pointsStr);
                    shapeEl.setAttribute('fill', 'none');
                    shapeEl.setAttribute('stroke', strokeColor);
                    shapeEl.setAttribute('stroke-width', strokeWidth);
                    if (strokeDash) shapeEl.setAttribute('stroke-dasharray', strokeDash);
                    shapeEl.setAttribute('stroke-linecap', 'round');
                    shapeEl.setAttribute('stroke-linejoin', 'round');
                }

                if (isWall) {
                    shapeEl.classList.add('building-exterior-wall', 'user-drawn-wall');
                    shapeEl.setAttribute('data-building-wall', 'true');
                    shapeEl.setAttribute('data-name', '외벽');
                }
                zoneGroup.appendChild(shapeEl);

                // 라벨 태그 (외벽은 번호/이름 배지를 도면에 표시하지 않고, 방화구역/제연구획만 표시)
                if (!isWall) {
                    let curLabelX = 0, curLabelY = 0;
                    if (zone.labelPos && typeof zone.labelPos.x === 'number') {
                        curLabelX = zone.labelPos.x;
                        curLabelY = zone.labelPos.y;
                    } else if (isPoly) {
                        curLabelX = zone.points.reduce((s, p) => s + p.x, 0) / zone.points.length;
                        curLabelY = zone.points.reduce((s, p) => s + p.y, 0) / zone.points.length;
                    } else {
                        const midIdx = Math.floor(zone.points.length / 2);
                        curLabelX = zone.points[midIdx].x;
                        curLabelY = zone.points[midIdx].y;
                    }

                    const labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    labelGroup.setAttribute('class', 'zone-label-badge');
                    labelGroup.setAttribute('transform', `translate(${curLabelX.toFixed(1)}, ${curLabelY.toFixed(1)})`);
                    labelGroup.style.cursor = 'grab';

                    const catText = zone.name || (isSmoke ? '제연구획' : '방화구역');
                    const textWidth = Math.max(catText.length * 11 + 18, 64);

                    const pillRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    pillRect.setAttribute('x', (-textWidth / 2).toFixed(1));
                    pillRect.setAttribute('y', '-10');
                    pillRect.setAttribute('width', textWidth);
                    pillRect.setAttribute('height', '20');
                    pillRect.setAttribute('rx', '4');
                    pillRect.setAttribute('fill', '#ffffff');
                    pillRect.setAttribute('stroke', strokeColor);
                    pillRect.setAttribute('stroke-width', '1.3');
                    labelGroup.appendChild(pillRect);

                    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    textEl.setAttribute('font-family', 'Pretendard, sans-serif');
                    textEl.setAttribute('font-size', '11');
                    textEl.setAttribute('font-weight', '700');
                    textEl.setAttribute('fill', strokeColor);
                    textEl.setAttribute('text-anchor', 'middle');
                    textEl.setAttribute('y', '4');
                    textEl.textContent = catText;
                    labelGroup.appendChild(textEl);

                    // 라벨 드래그 이벤트 (생성된 라인을 따라 자유롭게 슬라이드 이동)
                    labelGroup.onpointerdown = (e) => {
                        e.stopPropagation();
                        if (isDrawingMode || isZoneDrawingMode) return;
                        if (isLayerLocked(zone.category)) { warnLayerLocked(); return; }

                        let hasDragged = false;
                        const startClientX = e.clientX;
                        const startClientY = e.clientY;
                        let lastPt = { x: curLabelX, y: curLabelY };

                        labelGroup.setPointerCapture(e.pointerId);
                        labelGroup.style.cursor = 'grabbing';

                        const onPointerMove = (ev) => {
                            const dist = Math.hypot(ev.clientX - startClientX, ev.clientY - startClientY);
                            if (dist > 3) hasDragged = true;
                            if (!hasDragged) return;

                            const rect = mapContainer.getBoundingClientRect();
                            const curCrop = FLOORS[currentFloorIdx].crop;
                            const svgX = curCrop.minX + (ev.clientX - rect.left) / scale;
                            const svgY = curCrop.minY + (ev.clientY - rect.top) / scale;

                            lastPt = getClosestPointOnZoneLine(zone.points, isPoly, svgX, svgY);
                            labelGroup.setAttribute('transform', `translate(${lastPt.x.toFixed(1)}, ${lastPt.y.toFixed(1)})`);
                        };

                        const onPointerUp = (ev) => {
                            labelGroup.releasePointerCapture(ev.pointerId);
                            labelGroup.style.cursor = 'grab';
                            labelGroup.removeEventListener('pointermove', onPointerMove);
                            labelGroup.removeEventListener('pointerup', onPointerUp);

                            if (hasDragged) {
                                zone.labelPos = lastPt;
                                const floor = FLOORS[currentFloorIdx];
                                const curZones = getFloorZones(floor.code);
                                const tZone = curZones.find(z => z.id === zone.id);
                                if (tZone) {
                                    tZone.labelPos = lastPt;
                                    saveFloorZones(floor.code, curZones);
                                    syncSvgCache();
                                }
                            } else {
                                if (isDrawingMode) return;
                                if (isZoneDrawingMode && drawingZonePoints.length > 0) return;

                                if (isZoneDrawingMode) {
                                    openZoneModal(zone);
                                    return;
                                }

                                if (zone.category !== 'fire' && zone.category !== 'smoke') {
                                    openZoneModal(zone);
                                }
                            }
                        };

                        labelGroup.addEventListener('pointermove', onPointerMove);
                        labelGroup.addEventListener('pointerup', onPointerUp);
                    };

                    zoneGroup.appendChild(labelGroup);
                }

                // 선분/도형 자체 클릭 시
                shapeEl.style.cursor = 'pointer';
                shapeEl.onclick = (e) => {
                    if (isDrawingMode) return;

                    // 1) 구역 드로잉 모드:
                    if (isZoneDrawingMode) {
                        e.stopPropagation();
                        // 외벽인 경우: 기존 그려진 외벽 선분 선택 및 꼭짓점 수정 모드 진입
                        if (zone.category === 'wall') {
                            selectAndEditWallZone(zone);
                            return;
                        }
                        if (drawingZonePoints.length > 0) return;
                        openZoneModal(zone);
                        return;
                    }

                    // 2) 일반 뷰어 모드: 방화구역, 제연구획, 외벽 클릭 시 팝업 노출 차단
                    if (zone.category === 'fire' || zone.category === 'smoke' || zone.category === 'wall') {
                        return;
                    }
                    e.stopPropagation();
                    openZoneModal(zone);
                };

                zonesLayer.appendChild(zoneGroup);
            });

            // 방화구역/제연구획 등 안전 구역 레이어를 최상단으로 배치
            bringZoneLayersToFront();
        }

        // 바닥(흰 면, 매장 아래) · 지우개(흰 칠, 맨 위지만 매장·바닥·배관은 비켜 감). 보통은 눌리지 않고, 구역 그리기 중이거나 바닥 레이어를 켰을 때 점선을 눌러 열기
        function renderPaintZone(zone, floorUser, eraserLayer) {
            const isFloor = zone.category === 'floor';
            const poly = document.createElementNS(NS_SVG, 'polygon');
            poly.setAttribute('points', (zone.points || []).map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
            poly.setAttribute('fill', '#ffffff');
            poly.setAttribute('class', isFloor ? 'user-floor' : 'user-eraser');
            poly.setAttribute('data-zone-id', zone.id);
            if (isFloor) {   // 점선만 따로(아래 층)에 그려 겹친 바닥의 안쪽 선을 면이 덮음
                const line = poly.cloneNode(false);
                line.setAttribute('fill', 'none');
                line.setAttribute('class', 'user-floor-line');
                line.onclick = (e) => {
                    if (!isZoneDrawingMode || drawingZonePoints.length > 0 || isDrawingMode) return;
                    e.stopPropagation();
                    openZoneModal(zone);
                };
                floorUser.appendChild(line);   // floorUser = 마스크 걸린 점선 그룹 (면은 그리지 않음 — 바닥은 투명)
                return;
            }
            poly.onclick = (e) => {
                if (!isZoneDrawingMode || drawingZonePoints.length > 0 || isDrawingMode) return;
                e.stopPropagation();
                openZoneModal(zone);
            };
            eraserLayer.appendChild(poly);
        }

        function openZoneModal(zone) {
            if (isLayerLocked(zone.category)) { warnLayerLocked(); return; }
            closeAllPopovers();
            activeSelectedZone = zone;

            // 선택된 구역 시각적 테두리/그림자 강조
            const svgEl = (typeof mapContainer !== 'undefined' && mapContainer) ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
            if (svgEl) {
                svgEl.querySelectorAll('.safety-zone-item').forEach(el => el.classList.remove('selected-zone'));
                const targetGroup = svgEl.querySelector(`.safety-zone-item[data-zone-id="${zone.id}"]`);
                if (targetGroup) targetGroup.classList.add('selected-zone');
            }

            const isWall = zone.category === 'wall';
            const isSmoke = zone.category === 'smoke';
            const badge = document.getElementById('zone-modal-badge');
            if (badge) {
                if (zone.category === 'floor') {
                    badge.textContent = '⬜ 바닥';
                    badge.style.color = '#000000';
                    badge.style.background = '#f1f5f9';
                    badge.style.borderColor = '#cbd5e1';
                } else if (zone.category === 'erase') {
                    badge.textContent = '🧽 지우개';
                    badge.style.color = '#2563eb';
                    badge.style.background = '#eff6ff';
                    badge.style.borderColor = '#bfdbfe';
                } else if (isWall) {
                    badge.textContent = '🧱 건물 외벽';
                    badge.style.color = '#334155';
                    badge.style.background = '#f1f5f9';
                    badge.style.borderColor = '#cbd5e1';
                } else if (isSmoke) {
                    badge.textContent = '💨 제연구획';
                    badge.style.color = '#0284c7';
                    badge.style.background = '#f0f9ff';
                    badge.style.borderColor = '#bae6fd';
                } else {
                    badge.textContent = '🔥 방화구역';
                    badge.style.color = '#dc2626';
                    badge.style.background = '#fef2f2';
                    badge.style.borderColor = '#fecaca';
                }
            }

            const titleEl = document.getElementById('zone-modal-title');
            if (titleEl) titleEl.textContent = `${zone.name || '구역'} 상세`;

            const nameInput = document.getElementById('zone-name-input');
            if (nameInput) nameInput.value = zone.name || '';

            const catEl = document.getElementById('zone-info-category');
            if (catEl) {
                catEl.textContent = zone.category === 'floor' ? '바닥 (매장·기능실 아래 흰색 면)' : zone.category === 'erase' ? '지우개 (바닥색으로 칠해 지움)' : isWall ? '건물 외벽 (영구 보존 외벽)' : (isSmoke ? '제연구획 (연기 제어 구획)' : '방화구역 (방화 구획)');
            }

            const geomEl = document.getElementById('zone-info-geometry');
            if (geomEl) geomEl.textContent = zone.geometry === 'polygon' ? '면 (영역)' : '선 (경계선)';

            const ptsEl = document.getElementById('zone-info-points');
            if (ptsEl) ptsEl.textContent = `${zone.points?.length || 0}개 점`;

            // 외벽 선분은 삭제 버튼 숨김 처리 (외벽 영구 보존)
            const btnDelete = document.querySelector('#zone-modal .btn-sm-danger');
            if (btnDelete) {
                btnDelete.style.display = (isWall || (zone.name && zone.name.includes('외벽'))) ? 'none' : 'inline-block';
            }

            modalOverlay.style.display = 'flex';
            if (zoneModal) zoneModal.style.display = 'flex';
        }

        function saveZoneEdit() {
            if (!activeSelectedZone) return;
            pushUndoState('구역 정보 수정');

            const floor = FLOORS[currentFloorIdx];
            const newName = document.getElementById('zone-name-input')?.value.trim() || activeSelectedZone.name;

            const zones = getFloorZones(floor.code);
            const target = zones.find(z => z.id === activeSelectedZone.id);
            if (target) {
                target.name = newName;
                saveFloorZones(floor.code, zones);
            }

            renderFloorZones(floor.code);
            syncSvgCache();
            closeAllPopovers();
            showToast(`'${newName}' 정보가 저장되었습니다.`, 1500);
        }

        function deleteCurrentZone() {
            if (!activeSelectedZone) return;

            // '외벽' 선분은 지워지지 않아야 함 (영구 보존)
            if (activeSelectedZone.category === 'wall' || (activeSelectedZone.name && (activeSelectedZone.name.includes('외벽') || activeSelectedZone.name.includes('건물 외벽')))) {
                showToast('외벽은 영구 보존 요소로 삭제할 수 없습니다.', 1500);
                return;
            }

            pushUndoState('구역 삭제');

            const floor = FLOORS[currentFloorIdx];
            const targetName = activeSelectedZone.name;
            const zones = getFloorZones(floor.code).filter(z => z.id !== activeSelectedZone.id);
            saveFloorZones(floor.code, zones);

            renderFloorZones(floor.code);
            syncSvgCache();
            closeAllPopovers();
            showToast(`'${targetName}'이 삭제되었습니다.`, 1500);
        }

        function syncSvgCache() {
            const floor = FLOORS[currentFloorIdx];
            const svgEl = mapContainer.querySelector('svg');
            if (svgEl) {
                if (typeof rebuildEraserMask === 'function') rebuildEraserMask(svgEl);   // 매장이 바뀌면 지우개 구멍도 새로
                // 임시 요소(드로잉 레이어, 스냅 링, 핸들 등)를 배제한 순수 도면만 복제하여 저장
                const clone = svgEl.cloneNode(true);
                clone.querySelectorAll('#temp-zone-drawing-layer, #temp-drawing-layer, #wall-vertex-handles-layer, #cad-floor-grid-rect').forEach(el => el.remove());
                clone.querySelectorAll('circle[stroke="#0ea5e9"], circle[fill="rgba(14, 165, 233, 0.25)"]').forEach(el => el.remove());
                clone.querySelectorAll('#safety-zones-layer, #map-symbols-layer, #floor-layer, #floor-outline-layer, #eraser-layer, #eraser-defs').forEach(el => el.remove());
                clone.querySelectorAll('.selected, .selected-zone').forEach(el => {
                    el.classList.remove('selected');
                    el.classList.remove('selected-zone');
                });
                const svgHtml = clone.outerHTML;
                svgCache.set(floor.code, svgHtml);
                try {
                    const storageKey = typeof getSavedSvgStorageKey === 'function' ? getSavedSvgStorageKey(floor.code) : `lotte_saved_svg_${floor.code}`;
                    mapStore.setItem(storageKey, svgHtml);
                } catch (e) {}
            }
        }
