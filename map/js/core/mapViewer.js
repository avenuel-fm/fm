/* ==========================================================================
   mapViewer.js - SVG 도면 로드, 컬러 필터, 매장 렌더링, 사이드바 검색 및 팝오버 관리
   ========================================================================== */

var storeFilterMode = 'all'; // 'all' | 'store' | 'utility'

        // 도면 다각형에 통일된 쿨 블루 톤앤매너 팔레트 적용
        function applyBlueThemeToSvg(rawSvg) {
            // 지하 1층 매장 색상의 6각형 더미 도형(ff65ec50-0a22-4d3c-a72b-5e7222f29469) 및 관련 POI 완전 삭제
            let res = rawSvg.replace(/<path\b[^>]*id="ff65ec50-0a22-4d3c-a72b-5e7222f29469"[^>]*>(\s*<\/path>)?/gi, '');
            res = res.replace(/<g\b[^>]*ref-id="ff65ec50-0a22-4d3c-a72b-5e7222f29469"[^>]*>[\s\S]*?<\/g>/gi, '');

            const colorMap = {
                '#f0ebe2': '#e6f0fc', // 기본 매장: 맑고 정돈된 아이스 블루
                '#F0EBE2': '#e6f0fc',
                '#dad9bb': '#d8e8fc', // F&B 식음: 세련된 파스텔 스카이 블루
                '#DAD9BB': '#d8e8fc',
                '#f4e2c0': '#e0edfd', // 서비스 구역: 쿨 페리윙클 블루
                '#F4E2C0': '#e0edfd',
                '#c7c0b7': '#cbdbe9', // 공용 시설(화장실/EV): 쿨 슬레이트
                '#C7C0B7': '#cbdbe9',
                '#c7d7a1': '#c8e0ea', // 외곽 녹지/조경: 쿨 아쿠아
                '#C7D7A1': '#c8e0ea',
                '#f4f1ec': '#edf4fb', // 월드타워 기단: 소프트 아이스 그레이
                '#F4F1EC': '#edf4fb',
                '#67615d': '#334155', // 외벽/기둥: 모던 슬레이트 네이비
                '#67615D': '#334155'
            };
            for (const [oldC, newC] of Object.entries(colorMap)) {
                res = res.split(oldC).join(newC);
            }
            return res;
        }


        // 층 목록 사이드바 렌더링
        function renderFloorList() {
            const badge = document.querySelector('#floor-panel .panel-badge');
            if (badge) badge.textContent = `${FLOORS.length}개 층`;
            floorListContainer.innerHTML = '';
            FLOORS.forEach((f, idx) => {
                const isActive = idx === currentFloorIdx;
                const card = document.createElement('div');
                card.className = `floor-card-item ${isActive ? 'active' : ''}`;
                card.onclick = () => selectFloor(idx);
                card.innerHTML = `
                    <div class="floor-card-left">
                        <div class="floor-code-badge">${f.code}</div>
                        <div class="floor-meta-wrap">
                            <span class="floor-title-text">${f.name}</span>
                            <span class="floor-category-text">${f.category}</span>
                        </div>
                    </div>
                    ${isActive ? '<span class="floor-tag-active">선택됨</span>' : ''}
                `;
                floorListContainer.appendChild(card);
            });
        }

        // 층간 이동 (위/아래 화살표 버튼)
        function navigateFloor(direction) {
            // direction: -1 (위층으로, e.g. 1F -> 2F), +1 (아래층으로, e.g. 1F -> B1)
            const newIdx = currentFloorIdx + direction;
            if (newIdx >= 0 && newIdx < FLOORS.length) {
                selectFloor(newIdx);
            }
        }

        function updateFloorNavButtons() {
            const btnUp = document.getElementById('btn-floor-up');
            const btnDown = document.getElementById('btn-floor-down');
            if (!btnUp || !btnDown) return;
            // 6층(최상층, index 0)에서는 위 버튼 완전 삭제/숨김
            const hideUp = (currentFloorIdx <= 0);
            btnUp.classList.toggle('hidden-btn', hideUp);
            btnUp.style.setProperty('display', hideUp ? 'none' : 'inline-flex', 'important');

            // B1층(최하층, index FLOORS.length - 1)에서는 아래 버튼 완전 삭제/숨김
            const hideDown = (currentFloorIdx >= FLOORS.length - 1);
            btnDown.classList.toggle('hidden-btn', hideDown);
            btnDown.style.setProperty('display', hideDown ? 'none' : 'inline-flex', 'important');
        }

        async function selectFloor(idx, keepView = false) {
            closeAllPopovers();
            exitAddStoreMode();
            exitAddZoneMode();
            if (typeof exitSymbolEditMode === 'function') exitSymbolEditMode();
            currentFloorIdx = idx;
            const floor = FLOORS[idx];
            renderFloorList();
            if (typeof updateFloorNavButtons === 'function') {
                updateFloorNavButtons();
            }

            floorIndicator.querySelector('span').textContent = `${floor.name} ${floor.category}`;

            loading.style.display = 'flex';
            loadingMsg.textContent = `${floor.name} 도면을 불러오는 중입니다...`;

            try {
                // B1 구 크롭 캐시 및 6각형 도형 잔여 캐시 자동 무효화 (스크린샷 지정 구역 도면으로 갱신)
                if (floor.code === 'B1') {
                    try {
                        const cachedB1 = mapStore.getItem('lotte_saved_svg_B1');
                        if (cachedB1 && (!cachedB1.includes('8950 3600 3200 2000') || cachedB1.includes('ff65ec50-0a22-4d3c-a72b-5e7222f29469'))) {
                            mapStore.removeItem('lotte_saved_svg_B1');
                            svgCache.delete('B1');
                        }
                    } catch (e) {}
                }

                let svgText = svgCache.get(floor.code);
                if (!svgText) {
                    try {
                        const storageKey = typeof getSavedSvgStorageKey === 'function' ? getSavedSvgStorageKey(floor.code) : `lotte_saved_svg_${floor.code}`;
                        svgText = mapStore.getItem(storageKey);
                    } catch (e) {}
                }
                if (!svgText) {
                    const baseKey = getBaseSvgStorageKey(floor.code);
                    let fetchedRaw = mapStore.viewAt ? mapStore.getItem(baseKey) : null;   // 지난 날짜: 그때 보관한 업체 도면 (결정 132)
                    if (!fetchedRaw) {
                        if (!floor.svgUrl) throw new Error('도면 주소가 없습니다');
                        const res = await fetch(floor.svgUrl);
                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                        fetchedRaw = await res.text();
                        mapStore.keepBase(baseKey, fetchedRaw);   // 업체가 그림을 바꿨으면 보관
                    }
                    svgText = applyBlueThemeToSvg(fetchedRaw);
                    svgCache.set(floor.code, svgText);
                }

                mapContainer.style.width = `${floor.crop.width}px`;
                mapContainer.style.height = `${floor.crop.height}px`;
                let processed = svgText;
                if (!processed.includes('viewBox=')) {
                    processed = processed.replace('<svg ', `<svg viewBox="${floor.crop.viewBox}" width="${floor.crop.width}" height="${floor.crop.height}" style="background-color:var(--canvas-bg);" `);
                } else {
                    processed = processed.replace(/viewBox="[^"]*"/, `viewBox="${floor.crop.viewBox}"`)
                                         .replace(/width="[^"]*"/, `width="${floor.crop.width}"`)
                                         .replace(/height="[^"]*"/, `height="${floor.crop.height}" style="background-color:var(--canvas-bg);"`);
                }
                mapContainer.innerHTML = processed;

                // 도면 로드 시 기존 캐시에 잔존할 수 있는 임시 드로잉 레이어 및 스냅 링/마커 완벽 청소
                const loadedSvg = mapContainer.querySelector('svg');
                if (loadedSvg) {
                    const dirtyElements = loadedSvg.querySelectorAll('#temp-zone-drawing-layer, #temp-drawing-layer, #wall-vertex-handles-layer, #cad-floor-grid-rect, circle[stroke="#0ea5e9"], circle[fill="rgba(14, 165, 233, 0.25)"]');
                    if (dirtyElements.length > 0) {
                        dirtyElements.forEach(el => el.remove());
                        if (typeof syncSvgCache === 'function') {
                            syncSvgCache();
                        }
                    }
                }

                bindStoresAndPolygons(floor);
                renderFloorZones(floor.code);
                if (typeof renderFloorSymbols === 'function') {
                    renderFloorSymbols();
                }
                if (typeof renderFloorUtilityLines === 'function') {
                    renderFloorUtilityLines();
                }
                if (typeof bringZoneLayersToFront === 'function') {
                    bringZoneLayersToFront();
                }

                if (!keepView) {
                    resetView();
                } else {
                    updateTransform();
                }
            } catch (err) {
                console.error(err);
                showToast(`도면 로드 실패: ${err.message}`);
            } finally {
                loading.style.display = 'none';
            }
        }

        // 매장 텍스트와 다각형(<path>) 바인딩
        function bindStoresAndPolygons(floor) {
            currentStores = [];
            activeSelectedStore = null;
            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return;

            // B1 매장 색상 6각형 더미 도형(ff65ec50-0a22-4d3c-a72b-5e7222f29469) 및 관련 POI 즉시 제거
            if (floor.code === 'B1') {
                svgEl.querySelector('#ff65ec50-0a22-4d3c-a72b-5e7222f29469')?.remove();
                svgEl.querySelector('[ref-id="ff65ec50-0a22-4d3c-a72b-5e7222f29469"]')?.remove();
                svgEl.querySelector('#ddc7e6ab-135f-4df4-b2bd-12b17142b38c')?.remove();
            }

            // 건물 외벽(제일 외곽 검은선 및 외벽 기둥) 식별 및 수정/삭제 완전 차단
            const allShapeEls = Array.from(svgEl.querySelectorAll('path, polygon, polyline, line'));
            allShapeEls.forEach(el => {
                const stroke = (el.getAttribute('stroke') || '').toLowerCase();
                const fill = (el.getAttribute('fill') || '').toLowerCase();
                const dsW = parseFloat(el.getAttribute('ds-width')) || el.getBBox?.()?.width || 0;
                const dsH = parseFloat(el.getAttribute('ds-height')) || el.getBBox?.()?.height || 0;

                const isWallColor = stroke === '#334155' || stroke === '#67615d' || stroke === '#000000' ||
                                    fill === '#334155' || fill === '#67615d' || fill === '#000000';
                const isLargePerimeter = (dsW > 1600 || dsH > 1600);

                if (isWallColor || isLargePerimeter) {
                    el.classList.add('building-exterior-wall');
                    el.setAttribute('data-building-wall', 'true');
                    el.setAttribute('data-name', '건물 외벽');
                    el.style.pointerEvents = 'none';
                    el.style.cursor = 'default';
                    el.onclick = null;
                    if (el.id === 'f0869314-ab5c-4c66-b042-32a342f68693') {
                        el.setAttribute('stroke', '#334155');
                        el.setAttribute('stroke-width', '3.5');
                    }
                }
            });

            const deletedStores = getDeletedStores(floor.code);
            const renamedMap = getRenamedStores(floor.code);
            const storedSpecs = getStoredSpecs(floor.code);
            const storeBook = getStoreBook(floor.code);
            const bookShapes = new Set(Object.values(storeBook.items).map(it => it.shape));
            const shapeLabels = {};

            const pathEls = Array.from(svgEl.querySelectorAll('path, polygon')).filter(p => {
                if (p.classList.contains('building-exterior-wall')) return false;
                if (p.closest('#custom-stores-top-layer')) return false;   // 직접 그린 매장은 아래에서 따로 묶음
                const fill = (p.getAttribute('fill') || '').toLowerCase();
                const stroke = (p.getAttribute('stroke') || '').toLowerCase();
                const dsW = parseFloat(p.getAttribute('ds-width')) || p.getBBox?.()?.width || 0;
                const dsH = parseFloat(p.getAttribute('ds-height')) || p.getBBox?.()?.height || 0;
                const dsX = parseFloat(p.getAttribute('ds-x')) || (p.getBBox?.()?.x + dsW/2) || 0;
                const dsY = parseFloat(p.getAttribute('ds-y')) || (p.getBBox?.()?.y + dsH/2) || 0;

                if (!fill || fill === '#ffffff' || fill === '#334155' || fill === '#67615d' || fill === '#000000' || fill === 'none') return false;
                if (stroke === '#334155' || stroke === '#67615d' || stroke === '#000000') return false;
                if (dsW > 1600 || dsH > 1600) return false;
                return (dsX >= floor.crop.minX - 50 && dsX <= floor.crop.maxX + 50 && dsY >= floor.crop.minY - 50 && dsY <= floor.crop.maxY + 50);
            });

            const textEls = Array.from(svgEl.querySelectorAll('g[group-type="POI_GROUP"] text, text')).filter(t => {
                if (t.closest('#custom-stores-top-layer')) return false;
                const tspan = t.querySelector('tspan') || t;
                const txt = tspan.textContent.trim();
                if (!txt || txt === 'NaN' || txt.length === 0) return false;

                const x = parseFloat(t.getAttribute('x')) || 0;
                const y = parseFloat(t.getAttribute('y')) || 0;

                if (x < floor.crop.minX - 40 || x > floor.crop.maxX + 40 || y < floor.crop.minY - 40 || y > floor.crop.maxY + 40) {
                    t.style.display = 'none';
                    return false;
                }
                return true;
            });

            let storeIdx = 0;
            textEls.forEach(textEl => {
                const tspan = textEl.querySelector('tspan') || textEl;
                const rawName = tspan.textContent.trim();
                const x = parseFloat(textEl.getAttribute('x')) || 0;
                const y = parseFloat(textEl.getAttribute('y')) || 0;

                const matchingPaths = pathEls.filter(p => {
                    const dsW = parseFloat(p.getAttribute('ds-width')) || p.getBBox?.()?.width || 0;
                    const dsH = parseFloat(p.getAttribute('ds-height')) || p.getBBox?.()?.height || 0;
                    const dsX = parseFloat(p.getAttribute('ds-x')) || (p.getBBox?.()?.x + dsW/2) || 0;
                    const dsY = parseFloat(p.getAttribute('ds-y')) || (p.getBBox?.()?.y + dsH/2) || 0;
                    const minX = dsX - dsW / 2;
                    const maxX = dsX + dsW / 2;
                    const minY = dsY - dsH / 2;
                    const maxY = dsY + dsH / 2;
                    return (x >= minX - 15 && x <= maxX + 15 && y >= minY - 15 && y <= maxY + 15);
                });

                let matchedPolygon = null;
                if (matchingPaths.length > 0) {
                    matchingPaths.sort((a, b) => {
                        const wA = parseFloat(a.getAttribute('ds-width')) || a.getBBox?.()?.width || 0;
                        const hA = parseFloat(a.getAttribute('ds-height')) || a.getBBox?.()?.height || 0;
                        const wB = parseFloat(b.getAttribute('ds-width')) || b.getBBox?.()?.width || 0;
                        const hB = parseFloat(b.getAttribute('ds-height')) || b.getBBox?.()?.height || 0;
                        return (wA * hA) - (wB * hB);
                    });
                    matchedPolygon = matchingPaths[0];
                }

                // 도형의 고유값: 한 도형에 글자가 여럿이면 뒤에 #2, #3 (결정 154)
                let shapeKey = null;
                if (matchedPolygon) {
                    const base = matchedPolygon.id || `xy:${matchedPolygon.getAttribute('ds-x')}:${matchedPolygon.getAttribute('ds-y')}`;
                    shapeLabels[base] = (shapeLabels[base] || 0) + 1;
                    shapeKey = shapeLabels[base] > 1 ? `${base}#${shapeLabels[base]}` : base;
                }
                const shapeDeleted = shapeKey && storeBook.deleted.includes(StoreBook.baseOf(shapeKey));
                const nameDeleted = !(shapeKey && bookShapes.has(shapeKey)) && (deletedStores.includes(rawName) || (renamedMap[rawName] && deletedStores.includes(renamedMap[rawName])));

                // 삭제된 매장인지 확인하여 도면에서 바닥 색상을 흰색(#ffffff)으로 처리하고 목록에서 제외 (경계선 완전 제거)
                if (shapeDeleted || nameDeleted) {
                    textEl.remove();
                    if (matchedPolygon) {
                        matchedPolygon.setAttribute('fill', '#ffffff');
                        matchedPolygon.setAttribute('stroke', '#ffffff');
                        matchedPolygon.setAttribute('stroke-width', '0');
                        matchedPolygon.style.fill = '#ffffff';
                        matchedPolygon.style.stroke = 'none';
                        matchedPolygon.style.strokeWidth = '0';
                        matchedPolygon.style.cursor = 'default';
                        matchedPolygon.style.pointerEvents = 'none';
                        matchedPolygon.onclick = null;
                        matchedPolygon.classList.remove('store-polygon');
                        matchedPolygon.classList.add('vacant-floor-polygon');
                    }
                    return;
                }

                // '월드타워', '서울스카이'는 모달창 및 클릭 이벤트 완전 차단
                if (isImmutableStore(rawName)) {
                    textEl.style.cursor = 'default';
                    textEl.style.pointerEvents = 'none';
                    textEl.onclick = null;
                    if (matchedPolygon) {
                        matchedPolygon.style.cursor = 'default';
                        matchedPolygon.style.pointerEvents = 'none';
                        matchedPolygon.onclick = null;
                        matchedPolygon.classList.remove('store-polygon');
                    }
                    return;
                }

                // 매장명 수정 내역 반영
                const name = renamedMap[rawName] || rawName;
                if (name !== rawName) {
                    tspan.textContent = name;
                }

                const sId = storeIdx++;
                const rawSpec = storedSpecs[name];
                let itemType = 'store';
                let itemColor = matchedPolygon ? (matchedPolygon.getAttribute('fill') || '#e6f0fc') : '#e6f0fc';
                let itemFields = [];

                if (rawSpec) {
                    itemType = rawSpec.type || 'store';
                    if (rawSpec.fillColor) itemColor = rawSpec.fillColor;
                    if (Array.isArray(rawSpec.fields)) {
                        itemFields = rawSpec.fields;
                    } else {
                        itemFields = [
                            { label: '차단기 규격', value: rawSpec.breaker || '' },
                            { label: '수도배관 규격', value: rawSpec.plumbing || '' },
                            { label: '가스등급 규격', value: rawSpec.gas || '' }
                        ];
                    }
                }

                let storeGroup = null;
                if (matchedPolygon) {
                    matchedPolygon.classList.add('store-polygon');
                    matchedPolygon.setAttribute('data-store-id', sId);
                    if (rawSpec && rawSpec.fillColor) {
                        matchedPolygon.setAttribute('fill', rawSpec.fillColor);
                    }

                    if (!matchedPolygon.parentNode.classList.contains('store-group')) {
                        storeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                        storeGroup.setAttribute('class', 'store-group');
                        storeGroup.setAttribute('data-store-id', sId);
                        storeGroup.setAttribute('data-store-name', name);
                        storeGroup.setAttribute('data-store-type', itemType);
                        matchedPolygon.parentNode.insertBefore(storeGroup, matchedPolygon);
                        storeGroup.appendChild(matchedPolygon);
                    } else {
                        storeGroup = matchedPolygon.parentNode;
                        storeGroup.setAttribute('data-store-type', itemType);
                    }
                    storeGroup.appendChild(textEl);
                }

                textEl.classList.add('editable-store-name');
                textEl.setAttribute('data-store-id', sId);

                const storeItem = {
                    id: sId,
                    name: name,
                    type: itemType,
                    fillColor: itemColor,
                    fields: itemFields,
                    x: x,
                    y: y,
                    isCustom: false,
                    textElement: textEl,
                    polygonElement: matchedPolygon,
                    groupElement: storeGroup,
                    shapeKey: shapeKey,
                    shapeW: matchedPolygon ? (parseFloat(matchedPolygon.getAttribute('ds-width')) || 0) : 0,
                    shapeH: matchedPolygon ? (parseFloat(matchedPolygon.getAttribute('ds-height')) || 0) : 0
                };
                currentStores.push(storeItem);

                const clickHandler = (e) => {
                    if (typeof isSymbolMode !== 'undefined' && isSymbolMode) return;
                    if (isDrawingMode || isZoneDrawingMode) return;
                    if (typeof isUtilLineDrawingMode !== 'undefined' && isUtilLineDrawingMode) {
                        e.stopPropagation();
                        const pt = typeof getSvgPoint === 'function' ? getSvgPoint(e) : { x: e.offsetX, y: e.offsetY };
                        handleUtilLineMapClick(pt, storeItem);
                        return;
                    }
                    e.stopPropagation();
                    selectAndHighlightStore(storeItem);
                };

                textEl.onclick = clickHandler;
                if (matchedPolygon) {
                    matchedPolygon.onclick = clickHandler;
                }
            });

            // 사용자가 추가한 커스텀 도형/매장 복원
            const customStores = getCustomStores(floor.code);
            customStores.forEach(cs => {
                const customShape = cs.shape || `c:${cs.id}`;
                if (!bookShapes.has(customShape) && deletedStores.includes(cs.name)) return;

                let existingGroup = svgEl.querySelector(`#custom-stores-top-layer g.store-group[data-store-id="${cs.id}"]`);
                let pathEl = null;
                let textEl = null;

                if (!existingGroup) {
                    const newPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    newPath.setAttribute('d', cs.pathData);
                    newPath.setAttribute('fill', cs.fillColor || '#e6f0fc');
                    newPath.setAttribute('stroke', '#c8ddf7');
                    newPath.setAttribute('stroke-width', '1');
                    newPath.classList.add('store-polygon');
                    newPath.setAttribute('data-store-id', cs.id);

                    const newText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    newText.setAttribute('font-family', 'Pretendard, sans-serif');
                    newText.setAttribute('font-size', '18');
                    newText.setAttribute('font-weight', '600');
                    newText.setAttribute('fill', '#0f172a');
                    newText.setAttribute('text-anchor', 'middle');
                    newText.setAttribute('x', cs.x.toFixed(2));
                    newText.setAttribute('y', (cs.y + 6).toFixed(2));
                    newText.classList.add('editable-store-name');
                    newText.setAttribute('data-store-id', cs.id);

                    const newTspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                    newTspan.textContent = cs.name;
                    newText.appendChild(newTspan);

                    existingGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    existingGroup.setAttribute('class', 'store-group');
                    existingGroup.setAttribute('data-store-id', cs.id);
                    existingGroup.setAttribute('data-store-name', cs.name);
                    existingGroup.setAttribute('data-store-type', cs.type || 'store');

                    existingGroup.appendChild(newPath);
                    existingGroup.appendChild(newText);
                    let customTopLayer = svgEl.querySelector('#custom-stores-top-layer');
                    if (!customTopLayer) {
                        customTopLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                        customTopLayer.setAttribute('id', 'custom-stores-top-layer');
                        svgEl.appendChild(customTopLayer);
                    }
                    customTopLayer.appendChild(existingGroup);

                    pathEl = newPath;
                    textEl = newText;
                } else {
                    pathEl = existingGroup.querySelector('path');
                    textEl = existingGroup.querySelector('text');
                }
                layoutStoreLabel(textEl, cs.name, pathEl);

                const spec = storedSpecs[cs.name] || cs;
                const customItem = {
                    id: cs.id,
                    name: cs.name,
                    type: spec.type || cs.type || 'store',
                    fillColor: spec.fillColor || cs.fillColor || '#e6f0fc',
                    fields: spec.fields || cs.fields || [],
                    x: cs.x,
                    y: cs.y,
                    pathData: cs.pathData,
                    isCustom: true,
                    textElement: textEl,
                    polygonElement: pathEl,
                    groupElement: existingGroup,
                    shapeKey: customShape
                };
                currentStores.push(customItem);

                const clickHandler = (e) => {
                    if (typeof isSymbolMode !== 'undefined' && isSymbolMode) return;
                    if (isDrawingMode || isZoneDrawingMode) return;
                    if (typeof isUtilLineDrawingMode !== 'undefined' && isUtilLineDrawingMode) {
                        e.stopPropagation();
                        const pt = typeof getSvgPoint === 'function' ? getSvgPoint(e) : { x: e.offsetX, y: e.offsetY };
                        handleUtilLineMapClick(pt, customItem);
                        return;
                    }
                    e.stopPropagation();
                    selectAndHighlightStore(customItem);
                };
                if (textEl) textEl.onclick = clickHandler;
                if (pathEl) pathEl.onclick = clickHandler;
            });

            // 삭제된 커스텀 도형들(바닥 색상 흰색 #ffffff 처리, 경계선 없음) 렌더링
            const vacantPolygons = getVacantPolygons(floor.code);
            vacantPolygons.forEach(vp => {
                if (!vp.pathData) return;
                const vPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                vPath.setAttribute('d', vp.pathData);
                vPath.setAttribute('fill', '#ffffff');
                vPath.setAttribute('stroke', '#ffffff');
                vPath.setAttribute('stroke-width', '0');
                vPath.setAttribute('pointer-events', 'none');
                vPath.classList.add('vacant-floor-polygon');
                svgEl.appendChild(vPath);
            });

            // 삭제된 매장/바닥 영역의 모든 잔여 경계선 일괄 제거
            svgEl.querySelectorAll('.vacant-floor-polygon, path[fill="#ffffff"]').forEach(p => {
                if (p.classList.contains('building-exterior-wall')) return;
                p.setAttribute('stroke', '#ffffff');
                p.setAttribute('stroke-width', '0');
                p.style.stroke = 'none';
                p.style.strokeWidth = '0';
            });

            // B1 외벽 라인 두께 균일화: 단차(Step) 후 아래로 경사지게 내려가는 외벽 라인을 다른 외벽 라인과 동일한 두께(3.5px, #334155)로 통일 및 불필요한 6각형 도형 제거
            if (floor.code === 'B1') {
                svgEl.querySelector('#ff65ec50-0a22-4d3c-a72b-5e7222f29469')?.remove();
                svgEl.querySelector('#b1-left-exterior-wall-line')?.remove();
                const wallPolyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                wallPolyline.setAttribute('id', 'b1-left-exterior-wall-line');
                wallPolyline.setAttribute('points', '9012.33,4275.99 9012.33,4641.39 9100.71,4641.59 9189.14,5559.65 9265.10,6348.34');
                wallPolyline.setAttribute('stroke', '#334155');
                wallPolyline.setAttribute('stroke-width', '3.5');
                wallPolyline.setAttribute('stroke-linecap', 'round');
                wallPolyline.setAttribute('stroke-linejoin', 'round');
                wallPolyline.setAttribute('fill', 'none');
                wallPolyline.classList.add('building-exterior-wall');
                wallPolyline.style.pointerEvents = 'none';
                svgEl.appendChild(wallPolyline);
            }

            applyStoreBook(floor);
            renderStoreList(currentStores);
            if ((typeof isAnyEditModeActive === 'function' && isAnyEditModeActive()) || (typeof isGridLayerExplicitlyOn !== 'undefined' && isGridLayerExplicitlyOn)) {
                showFloorGrid();
            } else if (typeof hideFloorGrid === 'function') {
                hideFloorGrid(true);
            }
        }


        // 인포 레이어: 업체 도면의 안내 그림을 한 묶음으로 (결정 160). 부모에 위치 변환이 없어 옮겨도 자리 그대로
        var INFO_NAMES = /엘리베이터|elevator|에스컬레이터|escalator|화장실|restroom|계단|stairs|tax ?refund|택스|텍스|안내|information|심장충격|aed|환전|currency exchange/i;
        function collectInfoLayer(svgEl) {
            let layer = svgEl.querySelector('#info-layer');
            const icons = Array.from(svgEl.querySelectorAll('g[group-type="POI_GROUP"]'))
                .filter(g => g.querySelector('image') && INFO_NAMES.test(g.getAttribute('name') || '') && !g.closest('#info-layer'));
            if (!layer && !icons.length) return null;
            if (!layer) {
                layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                layer.setAttribute('id', 'info-layer');
            }
            icons.forEach(g => layer.appendChild(g));
            layer.style.pointerEvents = 'none';   // 그림을 눌러도 매장 그리기·선택을 막지 않음
            layer.style.display = infoLayerOn() ? '' : 'none';
            return layer;
        }
        function infoLayerOn() {
            try { return localStorage.getItem('map_info_layer') !== 'off'; } catch (e) { return true; }
        }
        function onInfoLayerChange(on) {
            try { localStorage.setItem('map_info_layer', on ? 'on' : 'off'); } catch (e) { /* 이 기기만 기억 */ }
            const layer = mapContainer.querySelector('#info-layer');
            if (layer) layer.style.display = on ? '' : 'none';
        }

        // 직접 그린 매장·기능실 이름: 글자 15, 도형보다 길면 다음 줄로 · 왼쪽 정렬 (결정 160)
        var STORE_LABEL_SIZE = 15, STORE_LABEL_LINE = 18, STORE_LABEL_PAD = 4;
        function layoutStoreLabel(textEl, name, pathEl) {
            if (!textEl) return;
            const ns = 'http://www.w3.org/2000/svg';
            textEl.setAttribute('font-size', String(STORE_LABEL_SIZE));
            textEl.textContent = '';
            const one = document.createElementNS(ns, 'tspan');
            one.textContent = name;
            textEl.appendChild(one);
            let box = null;
            try { box = pathEl && pathEl.getBBox(); } catch (e) { /* 화면에 없으면 가운데 한 줄 */ }
            if (!box || !box.width) return;
            const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
            const room = box.width - STORE_LABEL_PAD * 2;
            const width = t => { one.textContent = t; return one.getComputedTextLength(); };
            if (width(name) <= room) {
                textEl.setAttribute('text-anchor', 'middle');
                textEl.setAttribute('x', cx.toFixed(2));
                textEl.setAttribute('y', (cy + STORE_LABEL_SIZE / 3).toFixed(2));
                one.removeAttribute('x'); one.removeAttribute('dy');
                return;
            }
            // 띄어쓰기로 나누고, 한 낱말이 너무 길면 글자 단위로 나눔
            const lines = [];
            let cur = '';
            const pieces = name.split(/(\s+)/).filter(x => x);
            pieces.forEach(piece => {
                const tryLine = cur + piece;
                if (!cur || width(tryLine.trim()) <= room) { cur = tryLine; return; }
                lines.push(cur.trim()); cur = piece.trim();
            });
            if (cur.trim()) lines.push(cur.trim());
            const out = [];
            lines.forEach(line => {
                let part = '';
                Array.from(line).forEach(ch => {
                    if (part && width(part + ch) > room) { out.push(part); part = ch; } else part += ch;
                });
                if (part) out.push(part);
            });
            const x = (box.x + STORE_LABEL_PAD).toFixed(2);
            textEl.setAttribute('text-anchor', 'start');
            textEl.setAttribute('x', x);
            textEl.setAttribute('y', (cy - (out.length - 1) * STORE_LABEL_LINE / 2 + STORE_LABEL_SIZE / 3).toFixed(2));
            textEl.textContent = '';
            out.forEach((line, i) => {
                const t = document.createElementNS(ns, 'tspan');
                t.setAttribute('x', x);
                if (i) t.setAttribute('dy', String(STORE_LABEL_LINE));
                t.textContent = line;
                textEl.appendChild(t);
            });
        }

        // 휴대폰: 윗줄 숨기기 (이 기기에서만 기억, 결정 160)
        function toggleMenuBar(hide) {
            const on = hide === undefined ? !document.body.classList.contains('menu-hidden') : hide;
            document.body.classList.toggle('menu-hidden', on);
            const tab = document.getElementById('btn-menu-tab');
            if (tab) {
                tab.setAttribute('aria-expanded', String(!on));
                tab.innerHTML = on ? '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg><span>메뉴</span>'
                    : '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg><span>메뉴 숨기기</span>';
            }
            if (hide === undefined) { try { localStorage.setItem('map_menu_hidden', on ? '1' : ''); } catch (e) { /* 기억 못 해도 됨 */ } }
        }
        try { if (localStorage.getItem('map_menu_hidden') === '1') toggleMenuBar(true); } catch (e) { /* 처음엔 보임 */ }

        // 전체화면: 지도만 화면 가득, 종료 단추만 보임 (결정 160)
        function toggleMapFullscreen(force) {
            const on = force === undefined ? !document.body.classList.contains('map-full') : !!force;
            document.body.classList.toggle('map-full', on);
            const btn = document.getElementById('btn-fullscreen');
            if (btn) {
                btn.title = on ? '전체화면 종료' : '전체화면';
                btn.innerHTML = on ? '<svg viewBox="0 0 24 24"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg><span>종료</span>'
                    : '<svg viewBox="0 0 24 24"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg><span>전체화면</span>';
            }
            if (on) closeAllPopovers?.();
            try { if (window.parent !== window && window.parent.WS_MAP && window.parent.WS_MAP.full) window.parent.WS_MAP.full(on); } catch (e) { /* 혼자 열린 화면 */ }
            setTimeout(() => resetView(), 250);   // 화면 크기가 바뀐 뒤 지도를 화면에 맞춤
        }

        // 도면의 도형과 매장 대장을 맞추고, 대장의 이름·상세내역을 화면에 씀 (결정 154)
        function applyStoreBook(floor) {
            const key = getStoreBookKey(floor.code);
            const write = !mapStore.readOnly();
            const shapes = currentStores.filter(s => s.shapeKey).map(s => ({
                shape: s.shapeKey, name: s.name, type: s.type, color: s.fillColor, fields: s.fields, x: s.x, y: s.y, w: s.shapeW, h: s.shapeH
            }));
            const r = StoreBook.reconcile(getStoreBook(floor.code), shapes, currentBuildingId, floor.code, write);
            if (write && (r.changed || !mapStore.getItem(key))) saveStoreBook(floor.code, r.book);
            const items = StoreBook.itemsWith(getStoreItems(), r.book);
            currentStores.forEach(s => {
                const id = s.shapeKey && r.byShape[s.shapeKey];
                const it = id && r.book.items[id];
                if (!it) return;
                s.bookId = id;
                s.name = it.name;
                s.type = it.type || s.type;
                s.details = it.details || {};
                s.fields = StoreBook.fields(items, it);
                if (it.color) { s.fillColor = it.color; s.polygonElement?.setAttribute('fill', it.color); }
                if (s.isCustom) layoutStoreLabel(s.textElement, StoreBook.show(it.name), s.polygonElement);
                else {
                    const tspan = s.textElement && (s.textElement.querySelector('tspan') || s.textElement);
                    if (tspan && tspan.textContent !== StoreBook.show(it.name)) tspan.textContent = StoreBook.show(it.name);
                }
                s.groupElement?.setAttribute('data-store-name', it.name);
                s.groupElement?.setAttribute('data-store-type', s.type);
            });
        }

        // 확인이 필요한 곳: 도면에서 못 찾은 번호 · 도형 하나를 같이 쓰는 글자 · 같은 이름 도형
        function storeCheckLines() {
            const lines = [];
            const book = getStoreBook(FLOORS[currentFloorIdx].code);
            Object.keys(book.items).forEach(id => {
                if (book.items[id].lost) lines.push(`${id} 「${StoreBook.show(book.items[id].name)}」: 도면에서 도형을 찾지 못했습니다`);
            });
            currentStores.filter(s => s.bookId && String(s.shapeKey).includes('#')).forEach(s => lines.push(`${s.bookId} 「${StoreBook.show(s.name)}」: 다른 글자와 도형 하나를 같이 씁니다`));
            const count = {};
            currentStores.filter(s => s.bookId && s.name).forEach(s => { count[s.name] = (count[s.name] || 0) + 1; });
            Object.keys(count).filter(n => count[n] > 1).forEach(n => lines.push(`「${n}」: 같은 이름 도형이 ${count[n]}개입니다`));
            return lines;
        }

        function renderStoreChecks() {
            const box = document.getElementById('store-check');
            if (!box) return;
            const lines = storeCheckLines();
            box.hidden = !lines.length;
            box.innerHTML = lines.length ? `<summary>확인 필요 ${lines.length}곳</summary><ul>${lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : '';
        }

        function storeCardSummary(item) {
            const filled = (item.fields || []).filter(f => f.value);
            return filled.length ? filled.slice(0, 2).map(f => `${f.label} ${f.value}`).join(' · ') : '상세 없음';
        }

        // ================= 필터, 탭, 색상 팔레트 및 동적 필드 관리 =================
        function setStoreFilter(mode) {
            storeFilterMode = mode;
            document.querySelectorAll('.store-filter-btn').forEach(btn => {
                btn.classList.toggle('active', btn.getAttribute('data-filter') === mode);
            });
            renderStoreList(currentStores);
        }


        // 매장/기능실 목록 렌더링
        function renderStoreList(list = currentStores) {
            // 층별 매장 갯수 및 기능실 갯수 ('영업창고'는 기능실 갯수 카운트에서 제외)
            const storeOnlyCount = currentStores.filter(s => s.type !== 'utility').length;
            const utilOnlyCount = currentStores.filter(s => s.type === 'utility' && s.name !== '영업창고').length;

            const panelTitle = document.getElementById('store-panel-title');
            if (storeFilterMode === 'utility') {
                if (panelTitle) panelTitle.textContent = '기능실';
                // 기능실 사이드바 메뉴에서는 '매장 관리 ~개' 문구 완전 삭제
                if (storeTotalCount) storeTotalCount.style.display = 'none';
            } else {
                if (panelTitle) panelTitle.textContent = '매장';
                if (storeTotalCount) {
                    storeTotalCount.style.display = 'inline-block';
                    storeTotalCount.textContent = `${storeOnlyCount}개`;
                }
            }

            // 사이드바 필터 모드 (all, store, utility)
            let displayList = list;
            if (storeFilterMode === 'store') {
                displayList = list.filter(s => s.type !== 'utility');
            } else if (storeFilterMode === 'utility') {
                displayList = list.filter(s => s.type === 'utility');
            }

            // 검색어 필터
            const searchBox = document.getElementById('store-search-box');
            const q = searchBox ? searchBox.value.toLowerCase().trim() : '';
            if (q) {
                displayList = displayList.filter(s => s.name.toLowerCase().includes(q) || String(s.bookId || '').toLowerCase().includes(q));
            }

            renderStoreChecks();
            storeListContainer.innerHTML = '';
            if (displayList.length === 0) {
                storeListContainer.innerHTML = `<div style="text-align:center;padding:24px 16px;color:var(--text-muted);font-size:13px;">해당 분류의 항목이 없습니다.</div>`;
                return;
            }

            displayList.forEach((item, index) => {
                const row = document.createElement('div');
                const isUtil = item.type === 'utility';
                row.className = `store-item-card ${isUtil ? 'is-utility' : ''}`;
                row.setAttribute('data-store-id', item.id);

                row.onclick = () => {
                    focusStoreAt(item.x, item.y);
                    selectAndHighlightStore(item);
                };

                row.innerHTML = `
                    <div class="store-card-left">
                        <span class="store-idx-circle ${isUtil ? 'utility-idx' : ''}">${index + 1}</span>
                        <div class="store-card-name-group">
                            <span class="store-name-text" title="${escapeHtml(StoreBook.show(item.name))}">${escapeHtml(StoreBook.show(item.name))}</span>
                            ${isUtil ? '<span class="badge-card-utility">기능실</span>' : ''}
                            ${item.bookId ? `<span class="store-card-sub">${escapeHtml(item.bookId)} · ${escapeHtml(storeCardSummary(item))}</span>` : ''}
                        </div>
                    </div>
                    <div class="store-card-actions">
                        <button class="btn-edit-action" title="정보 수정" onclick="event.stopPropagation(); openEditFromCard(${item.id})">수정</button>
                    </div>
                `;
                storeListContainer.appendChild(row);
            });
        }

        function filterStoreList() {
            renderStoreList(currentStores);
        }

        function focusStoreAt(x, y) {
            if (!x || !y) return;
            const floor = FLOORS[currentFloorIdx];
            const vWidth = viewport.clientWidth;
            const vHeight = viewport.clientHeight;

            scale = 0.95;
            panX = (vWidth / 2) - ((x - floor.crop.minX) * scale);
            panY = (vHeight / 2) - ((y - floor.crop.minY) * scale);
            updateTransform();
        }

        

        // SVG 다운로드
        function downloadCurrentSvg() {
            const floor = FLOORS[currentFloorIdx];
            syncSvgCache();
            let rawSvg = svgCache.get(floor.code);
            if (!rawSvg) return showToast('도면을 불러오는 중입니다.');

            if (!rawSvg.includes('viewBox=')) {
                rawSvg = rawSvg.replace('<svg ', `<svg viewBox="${floor.crop.viewBox}" width="${floor.crop.width}" height="${floor.crop.height}" style="background-color:var(--canvas-bg);" `);
            } else {
                rawSvg = rawSvg.replace(/viewBox="[^"]*"/, `viewBox="${floor.crop.viewBox}"`)
                               .replace(/width="[^"]*"/, `width="${floor.crop.width}"`)
                               .replace(/height="[^"]*"/, `height="${floor.crop.height}" style="background-color:var(--canvas-bg);"`);
            }

            const blob = new Blob([rawSvg], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lotte_avenuel_${floor.code}_map.svg`;
            a.click();
            URL.revokeObjectURL(url);
            showToast(`${floor.name} SVG 파일이 다운로드되었습니다.`);
        }

        // 고화질 PNG 다운로드
        function downloadCurrentPng() {
            const floor = FLOORS[currentFloorIdx];
            syncSvgCache();
            let rawSvg = svgCache.get(floor.code);
            if (!rawSvg) return showToast('도면을 불러오는 중입니다.');

            loading.style.display = 'flex';
            loadingMsg.textContent = `${floor.name} 고해상도 PNG를 생성 중입니다...`;

            setTimeout(() => {
                const canvas = document.createElement('canvas');
                const width = floor.crop.width * 2;
                const height = floor.crop.height * 2;
                const targetViewBox = floor.crop.viewBox;

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = '#f0f4f9';
                ctx.fillRect(0, 0, width, height);

                let svgForRender = rawSvg;
                if (!svgForRender.includes('viewBox=')) {
                    svgForRender = svgForRender.replace('<svg ', `<svg viewBox="${targetViewBox}" width="${width}" height="${height}" `);
                } else {
                    svgForRender = svgForRender.replace(/viewBox="[^"]*"/, `viewBox="${targetViewBox}"`)
                                               .replace(/width="[^"]*"/, `width="${width}"`)
                                               .replace(/height="[^"]*"/, `height="${height}"`);
                }

                const img = new Image();
                const blob = new Blob([svgForRender], { type: 'image/svg+xml;charset=utf-8' });
                const url = URL.createObjectURL(blob);

                img.onload = () => {
                    ctx.drawImage(img, 0, 0, width, height);
                    URL.revokeObjectURL(url);
                    const a = document.createElement('a');
                    a.href = canvas.toDataURL('image/png');
                    a.download = `lotte_avenuel_${floor.code}_map.png`;
                    a.click();
                    loading.style.display = 'none';
                    showToast(`${floor.name} 고화질 PNG 파일이 저장되었습니다.`);
                };
                img.onerror = () => {
                    showToast('PNG 변환 중 오류가 발생했습니다. SVG 저장을 권장합니다.');
                    loading.style.display = 'none';
                };
                img.src = url;
            }, 60);
        }