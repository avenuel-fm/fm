/* ==========================================================================
   app.js - 메인 엔트리: 상단 네비게이션/패널 제어, 뷰포트 입력 이벤트, 단축키 & 부트스트랩
   ========================================================================== */

        // 사이드바 토글 및 지도 상단 오버레이 버튼 연동
        function toggleFloorPanel() {
            floorPanel.classList.toggle('hidden');
            const isOpen = !floorPanel.classList.contains('hidden');
            if (btnMapFloor) btnMapFloor.classList.toggle('active-panel-btn', isOpen);
        }

        function toggleStorePanel() {
            storePanel.classList.toggle('hidden');
            const isOpen = !storePanel.classList.contains('hidden');
            if (btnMapStore) btnMapStore.classList.toggle('active-panel-btn', isOpen && storeFilterMode !== 'utility');
            if (btnMapUtility) btnMapUtility.classList.toggle('active-panel-btn', isOpen && storeFilterMode === 'utility');
        }

        function openStoreSidebar(type = 'store') {
            const isCurrentlyOpen = !storePanel.classList.contains('hidden');
            if (isCurrentlyOpen && storeFilterMode === type) {
                toggleStorePanel();
                return;
            }
            storePanel.classList.remove('hidden');
            setStoreFilter(type);
            if (btnMapStore) btnMapStore.classList.toggle('active-panel-btn', type === 'store');
            if (btnMapUtility) btnMapUtility.classList.toggle('active-panel-btn', type === 'utility');
        }

        // 편집 드롭다운 메뉴 제어
        function toggleEditDropdown() {
            if (!editDropdownMenu) return;
            const isOpen = editDropdownMenu.style.display !== 'none';
            editDropdownMenu.style.display = isOpen ? 'none' : 'flex';
        }

        function closeEditDropdown() {
            if (editDropdownMenu) editDropdownMenu.style.display = 'none';
        }

        window.addEventListener('click', (e) => {
            if (!e.target.closest('#edit-dropdown-wrapper')) {
                closeEditDropdown();
            }
        });

        function onSelectEditStore() {
            closeEditDropdown();
            toggleAddStoreMode();
        }

        function onSelectEditZone() {
            closeEditDropdown();
            toggleAddZoneMode();
        }

        function onSelectEditSymbol() {
            closeEditDropdown();
            startSymbolEditMode();
        }

        function onSelectEditUtilLine() {
            closeEditDropdown();
            if (typeof startUtilityLineDrawingMode === 'function') {
                startUtilityLineDrawingMode();
            }
        }

        function togglePrintDropdown() {
            const menu = document.getElementById('print-dropdown-menu');
            if (!menu) return;
            const isOpen = menu.style.display !== 'none';
            closeAllDropdowns();
            menu.style.display = isOpen ? 'none' : 'flex';
        }

        function closePrintDropdown() {
            const menu = document.getElementById('print-dropdown-menu');
            if (menu) menu.style.display = 'none';
        }

        function closeAllDropdowns() {
            closeEditDropdown();
            if (typeof closeSymbolFilterDropdown === 'function') closeSymbolFilterDropdown();
            closePrintDropdown();
        }

        window.addEventListener('click', (e) => {
            if (!e.target.closest('#edit-dropdown-wrapper')) {
                closeEditDropdown();
            }
            if (!e.target.closest('#symbol-dropdown-wrapper')) {
                if (typeof closeSymbolFilterDropdown === 'function') closeSymbolFilterDropdown();
            }
            if (!e.target.closest('#print-dropdown-wrapper')) {
                closePrintDropdown();
            }
        });

        // 도면 출력(인쇄) 실행
        function executePrint() {
            closePrintDropdown();

            const chkDetails = document.getElementById('chk-print-store-details');
            const chkSymbols = document.getElementById('chk-print-symbols');
            const isPrintDetails = chkDetails ? chkDetails.checked : true;
            const isPrintSymbols = chkSymbols ? chkSymbols.checked : true;

            const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
            if (!svgEl) {
                window.print();
                return;
            }

            // 1. 매장 상세 텍스트 임시 레이어 주입
            let printDetailsLayer = null;
            if (isPrintDetails) {
                printDetailsLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                printDetailsLayer.setAttribute('id', 'print-store-details-layer');

                const isValidValue = (v) => {
                    if (!v) return false;
                    const str = String(v).trim();
                    return str !== '' && str !== '-' && str !== '미사용' && str !== '없음' && str !== '선택안함';
                };

                currentStores.forEach(s => {
                    if (isImmutableStore(s.name)) return;
                    const fields = s.fields || [];
                    const summaryParts = [];
                    fields.forEach(f => {
                        if (f.label && f.label !== '-' && isValidValue(f.value)) {
                            summaryParts.push(`${f.label}: ${f.value}`);
                        }
                    });
                    if (summaryParts.length === 0) {
                        if (isValidValue(s.breaker)) summaryParts.push(`차단기: ${s.breaker}`);
                        if (isValidValue(s.plumbing)) summaryParts.push(`수도: ${s.plumbing}`);
                        if (isValidValue(s.gas)) summaryParts.push(`가스: ${s.gas}`);
                    }

                    // 입력되지 않은 값(빈값, '-', 미사용 등)은 표시하지 않고, 유효한 값이 있을 때만 매장명 아래 줄바꿈으로 좌측정렬 배치
                    if (summaryParts.length > 0) {
                        // 매장명 텍스트 위치 및 경계(BBox) 기준으로 겹치지 않게 하단 배치
                        let startX = s.x - 30;
                        let baseY = s.y + 20;
                        if (s.textElement) {
                            try {
                                const bbox = s.textElement.getBBox();
                                if (bbox && bbox.width > 0) {
                                    startX = bbox.x;
                                    baseY = bbox.y + bbox.height + 12;
                                }
                            } catch (err) {}
                        }

                        const textGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                        textGroup.setAttribute('class', 'print-store-details-group');

                        summaryParts.forEach((part, idx) => {
                            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                            text.setAttribute('font-family', 'Pretendard, sans-serif');
                            text.setAttribute('font-size', '8');
                            text.setAttribute('font-weight', '500');
                            text.setAttribute('fill', '#475569');
                            text.setAttribute('text-anchor', 'start');
                            text.setAttribute('x', startX.toFixed(2));
                            text.setAttribute('y', (baseY + idx * 11).toFixed(2));
                            text.textContent = part;
                            textGroup.appendChild(text);
                        });
                        printDetailsLayer.appendChild(textGroup);
                    }
                });
                svgEl.appendChild(printDetailsLayer);
            }

            // 2. 심벌 표시/숨김 제어
            const symbolsLayer = svgEl.querySelector('#map-symbols-layer');
            const prevSymbolsDisplay = symbolsLayer ? symbolsLayer.style.display : '';
            if (symbolsLayer) {
                symbolsLayer.style.display = isPrintSymbols ? 'inline' : 'none';
                if (isPrintSymbols && typeof symbolFilterState !== 'undefined') {
                    symbolsLayer.querySelectorAll('.cad-symbol-node').forEach(node => {
                        const type = node.getAttribute('data-type');
                        node.style.display = symbolFilterState[type] ? 'inline' : 'none';
                    });
                }
            }

            // 3. 인쇄 실행
            window.print();

            // 4. 인쇄 완료 후 원상 복구
            const cleanup = () => {
                if (printDetailsLayer) printDetailsLayer.remove();
                if (symbolsLayer) symbolsLayer.style.display = prevSymbolsDisplay;
            };
            window.addEventListener('afterprint', cleanup, { once: true });
            setTimeout(cleanup, 2000);
        }


        // 도면 클릭 시 다각형(매장) 또는 구역 점 추가 (마우스 좌클릭, 터치 및 Apple Pencil 탭 지원)
        viewport.addEventListener('click', (e) => {
            if (typeof e.button === 'number' && e.button !== 0) return; // 좌클릭(0) 및 터치(0/undefined)만 허용 (우클릭 이동 간섭 방지)
            if (e.target.closest('.modal-overlay') || e.target.closest('.floating-controls') || e.target.closest('.drawing-guide-banner')) return;

            const rect = mapContainer.getBoundingClientRect();
            const clickX = (e.clientX - rect.left) / scale;
            const clickY = (e.clientY - rect.top) / scale;

            const floor = FLOORS[currentFloorIdx];
            const svgX = floor.crop.minX + clickX;
            const svgY = floor.crop.minY + clickY;

            if (isScaleMeasuring) {
                handleScaleMeasureClick(svgX, svgY);
                return;
            }
            if (isSpacePressed || (typeof hasDraggedDuringInteraction !== 'undefined' && hasDraggedDuringInteraction)) return;

            // -1. 설비 라인(자-모 연결선) 드로잉 모드
            if (typeof isUtilLineDrawingMode !== 'undefined' && isUtilLineDrawingMode) {
                let ptX = svgX;
                let ptY = svgY;
                if (typeof snapToGrid === 'function') {
                    const gSnap = snapToGrid(svgX, svgY);
                    if (gSnap.isSnapped) { ptX = gSnap.x; ptY = gSnap.y; }
                }
                if (typeof handleUtilLineMapClick === 'function') {
                    handleUtilLineMapClick({ x: ptX, y: ptY });
                }
                return;
            }

            // 0. 심벌 배치 모드
            if (typeof isSymbolMode !== 'undefined' && isSymbolMode) {
                addSymbolAt(svgX, svgY);
                return;
            }

            // 1. 매장 다각형 드로잉 모드
            if (isDrawingMode) {
                let ptX = svgX;
                let ptY = svgY;
                if (typeof snapToGrid === 'function') {
                    const gSnap = snapToGrid(svgX, svgY);
                    if (gSnap.isSnapped) {
                        ptX = gSnap.x;
                        ptY = gSnap.y;
                    }
                }
                if (drawingPoints.length > 0 && typeof snapToOrtho === 'function') {
                    const ortho = snapToOrtho({ x: ptX, y: ptY }, drawingPoints[drawingPoints.length - 1]);
                    ptX = ortho.x;
                    ptY = ortho.y;
                }
                if (drawingPoints.length >= 3) {
                    const firstPt = drawingPoints[0];
                    const distScreen = Math.hypot((ptX - firstPt.x) * scale, (ptY - firstPt.y) * scale);
                    if (distScreen < 20) {
                        finishDrawingPolygon();
                        return;
                    }
                }
                drawingPoints.push({ x: ptX, y: ptY });
                updateDrawingPreview(ptX, ptY);
                return;
            }

            // 2. 구역(방화구역/제연구획/외벽) 드로잉 모드
            if (isZoneDrawingMode) {
                if (isLayerLocked(currentZoneCategory)) { warnLayerLocked(); return; }   // 잠긴 레이어는 점부터 안 찍음 (결정 346)
                let ptX = svgX;
                let ptY = svgY;
                // 외벽: 매장·기능실·바닥·외벽 테두리에 자석, 같은 테두리를 연달아 찍으면 따라감 (Shift = 끄고 곧게, 결정 316)
                const wSnap = currentZoneCategory === 'wall' && typeof wallSnap === 'function' ? wallSnap(svgX, svgY) : null;
                let wallVia = [];
                if (wSnap) {
                    ptX = wSnap.x;
                    ptY = wSnap.y;
                    if (drawingZonePoints.length && !activeEditingWallZone) wallVia = wallTraceBetween(lastWallSnap, wSnap);
                } else if (currentZoneCategory === 'wall' && !window.isShiftKeyPressed && typeof snapToExteriorWall === 'function') {
                    const snap = snapToExteriorWall(svgX, svgY);
                    if (snap.isSnapped) {
                        ptX = snap.x;
                        ptY = snap.y;
                    }
                }
                if (currentZoneCategory === 'wall') lastWallSnap = wSnap;
                const wallStraight = currentZoneCategory === 'wall' && window.isShiftKeyPressed;   // Shift 외벽 = 자석 모두 끔
                if (!wallStraight && ptX === svgX && ptY === svgY && typeof snapToGrid === 'function') {
                    const gSnap = snapToGrid(svgX, svgY);
                    if (gSnap.isSnapped) {
                        ptX = gSnap.x;
                        ptY = gSnap.y;
                    }
                }
                if (wallVia.length) drawingZonePoints.push(...wallVia);
                if (drawingZonePoints.length > 0 && typeof snapToOrtho === 'function' && !wSnap) {
                    const ortho = snapToOrtho({ x: ptX, y: ptY }, drawingZonePoints[drawingZonePoints.length - 1]);
                    ptX = ortho.x;
                    ptY = ortho.y;
                }

                // 외벽 수정 모드 활성화 시: 도면 클릭을 통한 선분 연장
                if (typeof fclActive === 'function' && fclActive()) {   // 복도 중심선 모드: 자석 → 45도, 시작점 닫기 없음 (결정 260)
                    const q = fclPickPoint(svgX, svgY);
                    drawingZonePoints.push({ x: q.x, y: q.y });
                    updateZoneDrawingPreview(q.x, q.y);
                    updateZoneGuideUI();
                    return;
                }
                if (typeof activeEditingWallZone !== 'undefined' && activeEditingWallZone && !isWallCopy(activeEditingWallZone)) {   // 복사본은 이어 그리지 않음 (결정 322)
                    if (typeof hideWallSegSel === 'function') hideWallSegSel();
                    pushUndoState('외벽 선분 연장');
                    activeEditingWallZone.points.push({ x: ptX, y: ptY });
                    const floor = FLOORS[currentFloorIdx];
                    const curZones = getFloorZones(floor.code);
                    const tZone = curZones.find(z => z.id === activeEditingWallZone.id);
                    if (tZone) {
                        tZone.points = [...activeEditingWallZone.points];
                        saveFloorZones(floor.code, curZones);
                    }
                    renderFloorZones(floor.code);
                    renderWallVertexHandles(activeEditingWallZone);
                    syncSvgCache();
                    showToast('외벽 선분이 연장되었습니다.', 1000);
                    if (typeof afterWallChange === 'function') afterWallChange();
                    return;
                }

                if (drawingZonePoints.length >= 3) {
                    const firstPt = drawingZonePoints[0];
                    const distScreen = Math.hypot((ptX - firstPt.x) * scale, (ptY - firstPt.y) * scale);
                    if (distScreen < 22) {
                        currentZoneGeometry = 'polygon';
                        finishDrawingZone();
                        return;
                    }
                }
                drawingZonePoints.push({ x: ptX, y: ptY });
                updateZoneDrawingPreview(ptX, ptY);
                updateZoneGuideUI();
                return;
            }
        });

        // 더블클릭 시 매장 또는 구역 드로잉 완료
        viewport.addEventListener('dblclick', (e) => {
            if (isDrawingMode && drawingPoints.length >= 3) {
                e.preventDefault();
                finishDrawingPolygon();
            } else if (isZoneDrawingMode) {
                const minPts = (typeof fclActive === 'function' && fclActive()) ? 2 : (currentZoneGeometry === 'polygon' ? 3 : 2);
                if (drawingZonePoints.length >= minPts) {
                    e.preventDefault();
                    finishDrawingZone();
                }
            }
        });

        
        isSpacePressed = false;
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.repeat && (isDrawingMode || isZoneDrawingMode || isFreehandMode || (typeof isSymbolMode !== 'undefined' && isSymbolMode))) {
                if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
                e.preventDefault();
                isSpacePressed = true;
                viewport.classList.add('space-panning');
                viewport.style.cursor = 'grab';
                const canvas = document.getElementById('freehand-canvas');
                if (canvas) canvas.style.cursor = 'grab';
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                isSpacePressed = false;
                viewport.classList.remove('space-panning', 'grabbing');
                const canvas = document.getElementById('freehand-canvas');
                if (canvas) canvas.style.cursor = 'crosshair';
                if (isDrawingMode || isZoneDrawingMode || (typeof isSymbolMode !== 'undefined' && isSymbolMode)) {
                    viewport.style.cursor = 'crosshair';
                }
            }
        });


        window.addEventListener('keydown', (e) => {
            // 단축키: Ctrl+Z 또는 Cmd+Z로 되돌리기 (입력 필드 내에서는 제외)
            if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
                if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                    e.preventDefault();
                    handleUndo();
                    return;
                }
            }

            // 외벽 구간을 고른 상태에서 Delete = 그 구간 삭제 (결정 318)
            if ((e.key === 'Delete' || e.code === 'Delete') && typeof wallSel !== 'undefined' && wallSel && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                e.preventDefault();
                deleteWallSegment();
                return;
            }

            // 단축키: 구역 모달 열린 상태에서 Delete 키로 해당 구역 즉시 삭제
            if ((e.key === 'Delete' || e.code === 'Delete') && zoneModal && zoneModal.style.display !== 'none') {
                if (!['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                    e.preventDefault();
                    if (typeof deleteCurrentZone === 'function') deleteCurrentZone();
                    return;
                }
            }

            if (e.key === 'Escape' || e.keyCode === 27) {
                // 1. 축척 실측값 입력 팝업
                const scaleInputModal = document.getElementById('scale-input-modal');
                if (scaleInputModal && scaleInputModal.style.display !== 'none') {
                    closeScaleInputModal();
                    return;
                }

                // 2. 축척 설정 모달
                const scaleModal = document.getElementById('scale-modal');
                if (scaleModal && scaleModal.style.display !== 'none') {
                    closeScaleModal();
                    return;
                }

                // 3. 매장/기능실 편집 모달
                if (editModal && editModal.style.display !== 'none') {
                    cancelStoreEdit();
                    return;
                }

                // 4. 구역 상세/편집 모달
                if (zoneModal && zoneModal.style.display !== 'none') {
                    closeAllPopovers();
                    return;
                }

                // 5. 매장 정보 상태 모달
                if (statusModal && statusModal.style.display !== 'none') {
                    closeAllPopovers();
                    return;
                }

                // 6. 일반 모달 오버레이
                if (modalOverlay && modalOverlay.style.display !== 'none') {
                    closeAllPopovers();
                    return;
                }

                // 7. 드롭다운 메뉴 (편집, 심벌, 출력)
                if (editDropdownMenu && editDropdownMenu.style.display !== 'none') {
                    closeEditDropdown();
                    return;
                }
                const symMenu = document.getElementById('symbol-filter-dropdown-menu');
                if (symMenu && symMenu.style.display !== 'none') {
                    closeSymbolFilterDropdown();
                    return;
                }
                const printMenu = document.getElementById('print-dropdown-menu');
                if (printMenu && printMenu.style.display !== 'none') {
                    closePrintDropdown();
                    return;
                }

                // 7-1. 심벌 배치 모드 종료
                if (typeof isSymbolMode !== 'undefined' && isSymbolMode) {
                    exitSymbolEditMode();
                    return;
                }

                // 8. 축척 2점 기준선 실측 모드 취소
                if (isScaleMeasuring) {
                    cancelScaleCalibrationMeasure();
                    return;
                }

                // 9. 그리기 모드 내 연속 거리 측정 진행 중일 때: 그려진 상태 그대로 펜(그리기) 모드로 전환
                if (typeof isFreehandMode !== 'undefined' && isFreehandMode && typeof freehandSubTool !== 'undefined' && freehandSubTool === 'distance') {
                    finishFreehandDistanceMeasure();
                    return;
                }

                // 10. 그리기 모드 내 면적 측정 진행 중일 때
                if (typeof isFreehandMode !== 'undefined' && isFreehandMode && typeof freehandSubTool !== 'undefined' && freehandSubTool === 'area') {
                    if (typeof activeMeasurePoints !== 'undefined' && activeMeasurePoints.length >= 3) {
                        finishFreehandAreaMeasure();
                    } else {
                        setFreehandSubTool('pen');
                    }
                    return;
                }

                // 10.5. 설비 라인 드로잉 모드 취소
                if (typeof isUtilLineDrawingMode !== 'undefined' && isUtilLineDrawingMode) {
                    if (typeof exitUtilityLineDrawingMode === 'function') {
                        exitUtilityLineDrawingMode();
                    }
                    return;
                }

                // 11. 매장 다각형 드로잉 모드 취소
                if (isDrawingMode) {
                    exitAddStoreMode();
                    return;
                }

                // 12. 구역 드로잉 모드: 제연구획 선분 그리기 진행 중 ESC 시 그려진 부분 유지 및 완성
                if (isZoneDrawingMode) {
                    if (typeof handleZoneCancelOrEsc === 'function') {
                        handleZoneCancelOrEsc();
                    } else {
                        exitAddZoneMode();
                    }
                    return;
                }

                // 13. 사이드바 닫기 (우측 매장/기능실 패널, 좌측 층 선택 패널)
                let closedAnySidebar = false;
                if (storePanel && !storePanel.classList.contains('hidden')) {
                    storePanel.classList.add('hidden');
                    if (btnMapStore) btnMapStore.classList.remove('active-panel-btn');
                    if (btnMapUtility) btnMapUtility.classList.remove('active-panel-btn');
                    closedAnySidebar = true;
                }
                if (floorPanel && !floorPanel.classList.contains('hidden')) {
                    floorPanel.classList.add('hidden');
                    if (btnMapFloor) btnMapFloor.classList.remove('active-panel-btn');
                    closedAnySidebar = true;
                }

                // 14. 자유 그리기 모드 자체 종료 (펜 모드에서 ESC 시)
                if (!closedAnySidebar && typeof isFreehandMode !== 'undefined' && isFreehandMode) {
                    exitFreehandDrawing();
                    return;
                }

                closeAllPopovers();
            } else if (e.key === 'Enter') {
                if (typeof isUtilLineDrawingMode !== 'undefined' && isUtilLineDrawingMode) {
                    if (typeof finishUtilityLine === 'function') finishUtilityLine();
                    return;
                }
                if (isDrawingMode && drawingPoints.length >= 3) {
                    finishDrawingPolygon();
                } else if (isZoneDrawingMode) {
                    finishDrawingZone();
                } else if (isFreehandMode && freehandSubTool === 'distance' && activeMeasurePoints.length >= 2) {
                    finishFreehandDistanceMeasure();
                } else if (isFreehandMode && freehandSubTool === 'area' && activeMeasurePoints.length >= 3) {
                    finishFreehandAreaMeasure();
                }
            } else if (e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
                if (typeof isUtilLineDrawingMode !== 'undefined' && isUtilLineDrawingMode && typeof utilLineDrawingPoints !== 'undefined' && utilLineDrawingPoints.length > 0) {
                    e.preventDefault();
                    utilLineDrawingPoints.pop();
                    if (typeof updateTempDrawingLine === 'function') updateTempDrawingLine();
                    if (typeof updateUtilLineGuideUI === 'function') updateUtilLineGuideUI();
                    return;
                }
                if (isDrawingMode && drawingPoints.length > 0) {
                    e.preventDefault();
                    drawingPoints.pop();
                    updateDrawingPreview();
                } else if (isZoneDrawingMode && drawingZonePoints.length > 0) {
                    e.preventDefault();
                    drawingZonePoints.pop();
                    updateZoneDrawingPreview();
                    updateZoneGuideUI();
                }
            }
        });


// 검색 입력 이벤트 바인딩
(function initSearchBox() {
    var searchBox = document.getElementById('store-search-box');
    if (searchBox) {
        searchBox.addEventListener('input', function(e) {
            filterStoreList(e.target.value);
        });
    }
})();

// 앱 초기 구동 — 도면 자료(Supabase)를 받은 뒤 (mapStore.js)
mapStore.ready.then(() => {
    renderFloorList();
    if (isPhoneView() && floorPanel && !floorPanel.classList.contains('hidden')) toggleFloorPanel();   // 휴대폰: 층 선택은 접어 두고 시작 (결정 376)
    selectFloor(typeof currentFloorIdx !== 'undefined' ? currentFloorIdx : 0); // 각 건물별 기본층 자동 로드
    updateUndoButtonState();
}).catch(e => {
    document.body.innerHTML = '<div style="padding:40px 16px;text-align:center;font-size:16px;line-height:1.6">' +
        String(e && e.message ? e.message : e).replace(/[&<>]/g, '') + '</div>';
});