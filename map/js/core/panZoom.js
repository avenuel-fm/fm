/* ==========================================================================
   panZoom.js - 뷰포트 줌/팬, 마우스 드래그/휠, 태블릿 핀치 줌 & 터치 제어
   ========================================================================== */

var scale = 0.5;
var panX = 0, panY = 0;
var isDragging = false;
var startX = 0, startY = 0;

var isTouching = false;
var touchStartX = 0, touchStartY = 0;
var touchInitialPanX = 0, touchInitialPanY = 0;
var initialTouchDist = 0;
var initialTouchScale = scale;
var touchMidX = 0, touchMidY = 0;
var isSpacePressed = false;
var hasDraggedDuringInteraction = false;


        function updateTransform() {
            mapContainer.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
            if (typeof isFreehandMode !== 'undefined' && isFreehandMode && typeof redrawFreehandStrokes === 'function') {
                redrawFreehandStrokes();
            }
        }


        // 마우스 우클릭 시 브라우저 기본 컨텍스트 메뉴 차단 (우클릭 맵 이동 지원)
        viewport.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // ================= 마우스 드래그 & 휠 줌 & 드로잉 실시간 트래킹 =================
        viewport.addEventListener('mousedown', (e) => {
            if (e.target.closest('.modal-overlay') || e.target.closest('.floating-controls') || e.target.closest('.map-overlay-btn') || e.target.closest('#freehand-layer')) return;

            hasDraggedDuringInteraction = false;

            // 마우스 우클릭(button === 2): 그리기 모드 진행 중이라도 그려진 선/면을 유지한 채 마우스로 맵 이동
            if (e.button === 2) {
                isDragging = true;
                viewport.classList.add('grabbing');
                startX = e.clientX - panX;
                startY = e.clientY - panY;
                e.preventDefault();
                return;
            }

            // 스페이스바를 누르고 있는 경우 드로잉 모드 중이라도 자유롭게 패닝(지도 이동)
            if (isSpacePressed) {
                isDragging = true;
                viewport.classList.add('grabbing');
                viewport.style.cursor = 'grabbing';
                startX = e.clientX - panX;
                startY = e.clientY - panY;
                return;
            }

            if (isDrawingMode || isZoneDrawingMode || isFreehandMode || (typeof isSymbolMode !== 'undefined' && isSymbolMode)) return;
            isDragging = true;
            viewport.classList.add('grabbing');
            startX = e.clientX - panX;
            startY = e.clientY - panY;
        });

        window.addEventListener('mousemove', (e) => {
            if (isDragging) {
                hasDraggedDuringInteraction = true;
                panX = e.clientX - startX;
                panY = e.clientY - startY;
                updateTransform();
            }

            if (isDrawingMode && drawingPoints.length > 0) {
                const rect = mapContainer.getBoundingClientRect();
                const curX = (e.clientX - rect.left) / scale;
                const curY = (e.clientY - rect.top) / scale;
                const floor = FLOORS[currentFloorIdx];
                let pt = { x: floor.crop.minX + curX, y: floor.crop.minY + curY };
                if (typeof snapToOrtho === 'function') pt = snapToOrtho(pt, drawingPoints[drawingPoints.length - 1]);
                updateDrawingPreview(pt.x, pt.y);
            } else if (isZoneDrawingMode) {
                const rect = mapContainer.getBoundingClientRect();
                const curX = (e.clientX - rect.left) / scale;
                const curY = (e.clientY - rect.top) / scale;
                const floor = FLOORS[currentFloorIdx];
                let pt = { x: floor.crop.minX + curX, y: floor.crop.minY + curY };
                if (typeof drawingZonePoints !== 'undefined' && drawingZonePoints.length > 0 && typeof snapToOrtho === 'function') {
                    pt = snapToOrtho(pt, drawingZonePoints[drawingZonePoints.length - 1]);
                }
                updateZoneDrawingPreview(pt.x, pt.y);
            } else if (typeof isScaleMeasuring !== 'undefined' && isScaleMeasuring && typeof scaleMeasurePts !== 'undefined' && scaleMeasurePts.length === 1) {
                const rect = mapContainer.getBoundingClientRect();
                const curX = (e.clientX - rect.left) / scale;
                const curY = (e.clientY - rect.top) / scale;
                const floor = FLOORS[currentFloorIdx];
                let pt = { x: floor.crop.minX + curX, y: floor.crop.minY + curY };
                if (typeof snapToOrtho === 'function') pt = snapToOrtho(pt, scaleMeasurePts[0]);
                updateScaleMeasurePreview(pt.x, pt.y);
            } else if (typeof isSymbolMode !== 'undefined' && isSymbolMode) {
                const rect = mapContainer.getBoundingClientRect();
                const curX = (e.clientX - rect.left) / scale;
                const curY = (e.clientY - rect.top) / scale;
                const floor = FLOORS[currentFloorIdx];
                updateSymbolPreview(floor.crop.minX + curX, floor.crop.minY + curY);
            } else if (typeof isUtilLineDrawingMode !== 'undefined' && isUtilLineDrawingMode && typeof utilLineDrawingPoints !== 'undefined' && utilLineDrawingPoints.length > 0) {
                const rect = mapContainer.getBoundingClientRect();
                const curX = (e.clientX - rect.left) / scale;
                const curY = (e.clientY - rect.top) / scale;
                const floor = FLOORS[currentFloorIdx];
                if (typeof updateTempDrawingLine === 'function') {
                    updateTempDrawingLine({ x: floor.crop.minX + curX, y: floor.crop.minY + curY });
                }
            }
        });

        window.addEventListener('mouseup', (e) => {
            isDragging = false;
            viewport.classList.remove('grabbing');
            setTimeout(() => {
                hasDraggedDuringInteraction = false;
            }, 80);
        });

        viewport.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
            const mouseX = e.clientX;
            const mouseY = e.clientY;

            const newScale = Math.min(Math.max(scale * zoomFactor, 0.05), 4.5);
            panX = mouseX - (mouseX - panX) * (newScale / scale);
            panY = mouseY - (mouseY - panY) * (newScale / scale);
            scale = newScale;
            updateTransform();

            // 줌 변경 후 새 배율 기준으로 실시간 러버밴드 가이드 즉시 동기화 (구역/매장 선/면 왜곡 방지)
            const rect = mapContainer.getBoundingClientRect();
            const curX = (mouseX - rect.left) / scale;
            const curY = (mouseY - rect.top) / scale;
            const floor = (typeof FLOORS !== 'undefined' && typeof currentFloorIdx !== 'undefined') ? FLOORS[currentFloorIdx] : null;
            if (floor && floor.crop) {
                const svgX = floor.crop.minX + curX;
                const svgY = floor.crop.minY + curY;
                if (typeof isDrawingMode !== 'undefined' && isDrawingMode && typeof updateDrawingPreview === 'function') {
                    updateDrawingPreview(svgX, svgY);
                } else if (typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode && typeof updateZoneDrawingPreview === 'function') {
                    updateZoneDrawingPreview(svgX, svgY);
                } else if (typeof isScaleMeasuring !== 'undefined' && isScaleMeasuring && typeof updateScaleMeasurePreview === 'function') {
                    updateScaleMeasurePreview(svgX, svgY);
                } else if (typeof isSymbolMode !== 'undefined' && isSymbolMode && typeof updateSymbolPreview === 'function') {
                    updateSymbolPreview(svgX, svgY);
                }
            }
        }, { passive: false });

        // ================= 태블릿 터치 & 두 손가락 핀치 줌 (iPadOS / WebKit 최적화) =================
        viewport.addEventListener('touchstart', (e) => {
            if (e.target.closest('.modal-overlay') || e.target.closest('.floating-controls') || e.target.closest('.map-overlay-btn') || e.target.closest('#freehand-layer')) return;

            // 드로잉/심벌 배치 모드일 때:
            // 한 손가락 터치는 점 찍기/드로잉용이므로 터치패닝을 넘기고, 두 손가락 터치는 자유로운 핀치줌/지도이동을 허용
            const isAnyDrawing = (typeof isDrawingMode !== 'undefined' && isDrawingMode) ||
                                 (typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode) ||
                                 (typeof isSymbolMode !== 'undefined' && isSymbolMode) ||
                                 (typeof isScaleMeasuring !== 'undefined' && isScaleMeasuring);

            if (isAnyDrawing && e.touches.length !== 2) {
                hasDraggedDuringInteraction = false;
                return;
            }

            if (e.touches.length === 1) {
                isTouching = true;
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchInitialPanX = panX;
                touchInitialPanY = panY;
            } else if (e.touches.length === 2) {
                isTouching = true;
                hasDraggedDuringInteraction = true;
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                initialTouchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
                initialTouchScale = scale;
                touchMidX = (t1.clientX + t2.clientX) / 2;
                touchMidY = (t1.clientY + t2.clientY) / 2;
                touchInitialPanX = panX;
                touchInitialPanY = panY;
            }
        }, { passive: false });

        viewport.addEventListener('touchmove', (e) => {
            if (!isTouching) return;
            e.preventDefault();

            if (e.touches.length === 1) {
                const dx = e.touches[0].clientX - touchStartX;
                const dy = e.touches[0].clientY - touchStartY;
                if (Math.hypot(dx, dy) > 8) {
                    hasDraggedDuringInteraction = true;
                }
                panX = touchInitialPanX + dx;
                panY = touchInitialPanY + dy;
                updateTransform();
            } else if (e.touches.length === 2) {
                hasDraggedDuringInteraction = true;
                const t1 = e.touches[0];
                const t2 = e.touches[1];
                const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

                if (initialTouchDist > 0) {
                    const zoomFactor = currentDist / initialTouchDist;
                    const newScale = Math.min(Math.max(initialTouchScale * zoomFactor, 0.05), 4.5);

                    const curMidX = (t1.clientX + t2.clientX) / 2;
                    const curMidY = (t1.clientY + t2.clientY) / 2;

                    panX = curMidX - (touchMidX - touchInitialPanX) * (newScale / initialTouchScale);
                    panY = curMidY - (touchMidY - touchInitialPanY) * (newScale / initialTouchScale);
                    scale = newScale;
                    updateTransform();

                    // 핀치 줌 도중 실시간 드로잉 러버밴드 가이드 동기화
                    const rect = mapContainer.getBoundingClientRect();
                    const curX = (curMidX - rect.left) / scale;
                    const curY = (curMidY - rect.top) / scale;
                    const floor = (typeof FLOORS !== 'undefined' && typeof currentFloorIdx !== 'undefined') ? FLOORS[currentFloorIdx] : null;
                    if (floor && floor.crop) {
                        const svgX = floor.crop.minX + curX;
                        const svgY = floor.crop.minY + curY;
                        if (typeof isDrawingMode !== 'undefined' && isDrawingMode && typeof updateDrawingPreview === 'function') {
                            updateDrawingPreview(svgX, svgY);
                        } else if (typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode && typeof updateZoneDrawingPreview === 'function') {
                            updateZoneDrawingPreview(svgX, svgY);
                        }
                    }
                }
            }
        }, { passive: false });

        viewport.addEventListener('touchend', (e) => {
            if (e.touches.length === 0) {
                isTouching = false;
                initialTouchDist = 0;
                setTimeout(() => {
                    hasDraggedDuringInteraction = false;
                }, 120);
            } else if (e.touches.length === 1) {
                touchStartX = e.touches[0].clientX;
                touchStartY = e.touches[0].clientY;
                touchInitialPanX = panX;
                touchInitialPanY = panY;
            }
        });

        viewport.addEventListener('touchcancel', () => {
            isTouching = false;
            initialTouchDist = 0;
            setTimeout(() => {
                hasDraggedDuringInteraction = false;
            }, 120);
        });

        function zoomIn() { scale = Math.min(scale * 1.3, 4.5); updateTransform(); }
        function zoomOut() { scale = Math.max(scale * 0.7, 0.05); updateTransform(); }

        function isPhoneView() { return window.matchMedia('(max-width: 768px)').matches; }
        // 「화면 맞춤」: 층 전체가 화면에 꽉 차게 (결정 376)
        function fitView() {
            const c = FLOORS[currentFloorIdx].crop, vw = viewport.clientWidth, vh = viewport.clientHeight;
            scale = Math.min(vw / c.width, vh / c.height) * 0.98;
            panX = (vw - c.width * scale) / 2;
            panY = (vh - c.height * scale) / 2;
            updateTransform();
            lastFit = { scale, panX, panY };
        }
        // 맞춘 그대로인데 화면 크기가 바뀌면(처음 여는 중 · 사이드바 접힘) 다시 맞춤
        var lastFit = null;
        if (window.ResizeObserver) new ResizeObserver(() => {
            if (lastFit && lastFit.scale === scale && lastFit.panX === panX && lastFit.panY === panY && viewport.clientWidth && viewport.clientHeight) fitView();
        }).observe(viewport);
        function resetView() {
            const floor = FLOORS[currentFloorIdx];
            const vWidth = viewport.clientWidth;
            const vHeight = viewport.clientHeight;

            if (isPhoneView()) { fitView(); return; }   // 휴대폰은 처음부터 꽉 차게
            if (floor.crop && typeof floor.crop.centerX === 'number' && typeof floor.crop.centerY === 'number') {
                scale = (typeof currentBuildingId !== 'undefined' && currentBuildingId === 'castle') ? 0.32 : 0.22;
                panX = vWidth / 2 - floor.crop.centerX * scale;
                panY = vHeight / 2 - floor.crop.centerY * scale;
            } else {
                scale = Math.min(vWidth / floor.crop.width, vHeight / floor.crop.height) * 0.92;
                panX = (vWidth - floor.crop.width * scale) / 2;
                panY = (vHeight - floor.crop.height * scale) / 2;
            }
            updateTransform();
        }