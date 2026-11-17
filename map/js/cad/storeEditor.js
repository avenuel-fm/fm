/* ==========================================================================
   storeEditor.js - 매장/기능실 다각형 CAD 드로잉, 겹침 방지 보정, 시설사양 수정 모달
   ========================================================================== */

var isDrawingMode = false;
var drawingPoints = [];
var tempDrawingGroup = null;
var currentEditType = 'store'; // 'store' | 'utility'
var currentEditColor = '#e6f0fc';
var lastCreatedStoreId = null;

        function setEditType(type) {
            currentEditType = type;
            const utilRadioGroup = document.getElementById('utility-type-radio-group');
            if (type === 'utility') {
                tabTypeStore?.classList.remove('active');
                tabTypeUtility?.classList.add('active');
                if (utilRadioGroup) utilRadioGroup.style.display = 'block';
                if (editNameLabel) editNameLabel.textContent = '기능실명';
                if (editNameInput) editNameInput.placeholder = '기능실명을 입력하세요 (예: EPS, AV, 공조실, PS, PD)';
                if (editModalTitle) editModalTitle.textContent = '기능실 및 시설 수정';
                if (editBadge) {
                    editBadge.textContent = '기능실 편집';
                    editBadge.style.color = '#475569';
                    editBadge.style.background = '#f1f5f9';
                    editBadge.style.borderColor = '#cbd5e1';
                }
                if (currentEditColor === '#e6f0fc') {
                    selectEditColor('#cbdbe9');
                }
            } else {
                tabTypeStore?.classList.add('active');
                tabTypeUtility?.classList.remove('active');
                if (utilRadioGroup) utilRadioGroup.style.display = 'none';
                if (editNameLabel) editNameLabel.textContent = '매장명';
                if (editNameInput) editNameInput.placeholder = '매장명을 입력하세요';
                if (editModalTitle) editModalTitle.textContent = '매장 및 시설 수정';
                if (editBadge) {
                    editBadge.textContent = '정보 편집';
                    editBadge.style.color = '#059669';
                    editBadge.style.background = '#ecfdf5';
                    editBadge.style.borderColor = '#a7f3d0';
                }
                if (currentEditColor === '#cbdbe9') {
                    selectEditColor('#e6f0fc');
                }
            }
        }

        function onSelectUtilityRadio(val) {
            if (editNameInput) editNameInput.value = val;
            if (val === '영업창고') {
                selectEditColor('#e2e8f0');
            }
        }

        function selectEditColor(hex) {
            if (!hex) return;
            currentEditColor = hex;
            document.querySelectorAll('.color-swatch').forEach(sw => {
                const swColor = sw.getAttribute('data-color');
                if (swColor && swColor.toLowerCase() === hex.toLowerCase()) {
                    sw.classList.add('active');
                } else {
                    sw.classList.remove('active');
                }
            });
            if (editColorPicker) editColorPicker.value = hex;

            // 선택된 도형 실시간 프리뷰 반영
            if (activeSelectedStore && activeSelectedStore.polygonElement) {
                activeSelectedStore.polygonElement.setAttribute('fill', hex);
            }
        }

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        const FIELD_OPTIONS = ['-', '차단기', '급수', '배수', '가스등급', '에어컨 유무'];

        function normalizeFieldLabel(rawLabel) {
            if (!rawLabel || rawLabel === '-') return '-';
            const s = rawLabel.trim();
            if (s === '-') return '-';
            if (s.includes('차단기')) return '차단기';
            if (s.includes('수도') || s.includes('급수')) return '급수';
            if (s.includes('배수')) return '배수';
            if (s.includes('가스')) return '가스등급';
            if (s.includes('에어컨') || s.includes('냉난방')) return '에어컨 유무';
            return s;
        }

        function createFieldRowDOM(label = '-', value = '') {
            const listEl = document.getElementById('dynamic-fields-list');
            if (!listEl) return null;
            const emptyNotice = listEl.querySelector('#fields-empty-notice');
            if (emptyNotice) emptyNotice.remove();

            const norm = normalizeFieldLabel(label);
            const isStandard = FIELD_OPTIONS.includes(norm);

            let optionsHtml = FIELD_OPTIONS.map(opt => `<option value="${opt}" ${norm === opt ? 'selected' : ''}>${opt}</option>`).join('');
            if (!isStandard && norm && norm !== '-') {
                optionsHtml += `<option value="${escapeHtml(norm)}" selected>${escapeHtml(norm)}</option>`;
            }

            const row = document.createElement('div');
            row.className = 'dynamic-field-row';
            row.innerHTML = `
                <select class="field-label-select">
                    ${optionsHtml}
                </select>
                <input type="text" class="field-value-input" placeholder="사양/내용 입력" value="${escapeHtml(value)}">
                <button type="button" class="btn-del-field" title="항목 삭제" onclick="removeFieldRow(this)">
                    <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" stroke-width="2.2" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            `;
            listEl.appendChild(row);
            return row;
        }

        function addDynamicFieldRow() {
            const row = createFieldRowDOM('-', '');
            if (row) {
                const selectEl = row.querySelector('.field-label-select');
                if (selectEl) selectEl.focus();
            }
        }

        function removeFieldRow(btn) {
            const row = btn.closest('.dynamic-field-row');
            if (row) row.remove();
            const listEl = document.getElementById('dynamic-fields-list');
            if (listEl && listEl.querySelectorAll('.dynamic-field-row').length === 0) {
                listEl.innerHTML = `
                    <div id="fields-empty-notice" style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">
                        등록된 사양 항목이 없습니다. 상단 '항목 추가'를 눌러 추가하세요.
                    </div>
                `;
            }
        }

        function renderDynamicFields(fields = []) {
            const listEl = document.getElementById('dynamic-fields-list');
            if (!listEl) return;
            listEl.innerHTML = '';

            if (!fields || fields.length === 0) {
                listEl.innerHTML = `
                    <div id="fields-empty-notice" style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px 0;">
                        등록된 사양 항목이 없습니다. 상단 '항목 추가'를 눌러 추가하세요.
                    </div>
                `;
                return;
            }

            fields.forEach(f => {
                createFieldRowDOM(f.label, f.value);
            });
        }

        function gatherDynamicFields() {
            const rows = document.querySelectorAll('#dynamic-fields-list .dynamic-field-row');
            const result = [];
            rows.forEach(r => {
                const label = (r.querySelector('.field-label-select')?.value || r.querySelector('.field-label-input')?.value || '').trim();
                const value = r.querySelector('.field-value-input')?.value.trim();
                if ((label && label !== '-') || value) {
                    result.push({ label: (label && label !== '-') ? label : '기타', value: value || '-' });
                }
            });
            return result;
        }

        // 매장/기능실 선택 및 모달 열기
        function selectAndHighlightStore(storeItem) {
            // 이미 선택된 매장을 다시 클릭한 경우: 상세 팝업창 닫기 및 선택 취소 (토글)
            if (activeSelectedStore && activeSelectedStore.id === storeItem.id && statusModal && statusModal.style.display !== 'none') {
                closeAllPopovers();
                return;
            }

            closeAllPopovers();
            activeSelectedStore = storeItem;

            // 매장 클릭 시 우측 사이드메뉴가 열려있다면 닫기 (사이드메뉴 노출 방지)
            if (typeof storePanel !== 'undefined' && storePanel && !storePanel.classList.contains('hidden')) {
                storePanel.classList.add('hidden');
                if (typeof btnMapStore !== 'undefined' && btnMapStore) btnMapStore.classList.remove('active-panel-btn');
                if (typeof btnMapUtility !== 'undefined' && btnMapUtility) btnMapUtility.classList.remove('active-panel-btn');
            }

            const svgEl = mapContainer.querySelector('svg');
            if (svgEl) {
                svgEl.querySelectorAll('.store-polygon.selected, .store-group.selected').forEach(el => {
                    el.classList.remove('selected');
                });
            }

            if (storeItem.polygonElement) {
                storeItem.polygonElement.classList.add('selected');
                const parentG = storeItem.groupElement || storeItem.polygonElement.parentNode;
                if (parentG && parentG.parentNode) {
                    parentG.parentNode.appendChild(parentG);
                }
            }
            if (storeItem.groupElement) {
                storeItem.groupElement.classList.add('selected');
            }

            document.querySelectorAll('.store-item-card').forEach(c => c.classList.remove('selected'));
            const cardEl = document.querySelector(`.store-item-card[data-store-id="${storeItem.id}"]`);
            if (cardEl) {
                cardEl.classList.add('selected');
            }

            const isUtil = storeItem.type === 'utility';
            if (statusBadge) {
                statusBadge.textContent = isUtil ? '기능실 시설 현황' : '매장 시설 현황';
                statusBadge.style.color = isUtil ? '#475569' : '#1d4ed8';
                statusBadge.style.background = isUtil ? '#f1f5f9' : '#eff6ff';
                statusBadge.style.borderColor = isUtil ? '#cbd5e1' : '#bfdbfe';
            }

            statusStoreName.textContent = storeItem.name;

            // 동적 시설 항목 테이블 렌더링
            const tableEl = document.getElementById('status-facility-table');
            if (tableEl) {
                tableEl.innerHTML = '';
                const fields = storeItem.fields || [
                    { label: '차단기 규격', value: storeItem.breaker || '-' },
                    { label: '수도배관 규격', value: storeItem.plumbing || '-' },
                    { label: '가스등급 규격', value: storeItem.gas || '-' }
                ];
                if (fields.length > 0) {
                    fields.forEach(f => {
                        const row = document.createElement('div');
                        row.className = 'facility-row';
                        row.innerHTML = `
                            <div class="facility-label">${escapeHtml(f.label)}</div>
                            <div class="facility-value">${escapeHtml(f.value || '-')}</div>
                        `;
                        tableEl.appendChild(row);
                    });
                } else {
                    tableEl.innerHTML = `<div style="font-size:12px;color:var(--text-muted);text-align:center;padding:8px 0;">등록된 시설 항목이 없습니다.</div>`;
                }
            }

            // 매장 시설 현황 팝업: 어두운 딤 오버레이 제거 & 우측 하단 플로팅 팝업 카드 표시
            modalOverlay.classList.add('as-toast-overlay');
            modalOverlay.style.display = 'flex';
            statusModal.style.display = 'flex';
            editModal.style.display = 'none';

            // 매장(모) 또는 기능실(자)에 연결된 설비 라인 하이라이트 & 점선 흐름 애니메이션 표시
            if (typeof highlightUtilityLinesForStore === 'function') {
                highlightUtilityLinesForStore(storeItem);
            }

            // 기능실(자)인 경우 모달 푸터에 [🔗 매장 연결선 그리기] 버튼 동적 표시
            let btnConnect = document.getElementById('btn-status-connect-util');
            if (!btnConnect && statusModal) {
                btnConnect = document.createElement('button');
                btnConnect.id = 'btn-status-connect-util';
                btnConnect.className = 'btn-sm';
                btnConnect.style.background = '#2563eb';
                btnConnect.style.color = '#ffffff';
                btnConnect.style.borderColor = '#2563eb';
                btnConnect.innerHTML = '🔗 매장 연결선';
                btnConnect.onclick = () => {
                    const targetStore = activeSelectedStore;
                    closeAllPopovers();
                    if (typeof startUtilityLineDrawingMode === 'function') {
                        startUtilityLineDrawingMode(targetStore);
                    }
                };
                const footer = statusModal.querySelector('.modal-footer');
                if (footer) footer.insertBefore(btnConnect, footer.firstChild);
            }
            if (btnConnect) {
                btnConnect.style.display = isUtil ? 'inline-flex' : 'none';
            }
        }

        function openEditFromCurrentStatus() {
            if (!activeSelectedStore) return;
            openEditModalForStore(activeSelectedStore);
        }

        function openEditFromCard(storeId) {
            const store = currentStores.find(s => s.id === storeId);
            if (!store) return;
            focusStoreAt(store.x, store.y);
            openEditModalForStore(store);
        }

        function openEditModalForStore(store) {
            if (!store || isImmutableStore(store.name)) return;
            closeAllPopovers();
            activeSelectedStore = store;

            if (store.polygonElement) {
                store.polygonElement.classList.add('selected');
                const parentG = store.groupElement || store.polygonElement.parentNode;
                if (parentG && parentG.parentNode) {
                    parentG.parentNode.appendChild(parentG);
                }
            }

            const type = store.type || 'store';
            setEditType(type);

            if (editNameInput) editNameInput.value = store.name || '';

            const currentColor = store.fillColor || store.polygonElement?.getAttribute('fill') || (type === 'utility' ? '#cbdbe9' : '#e6f0fc');
            selectEditColor(currentColor);

            // 기능실 라디오 버튼 상태 동기화
            const utilRadios = document.querySelectorAll('input[name="util-type-opt"]');
            utilRadios.forEach(r => {
                r.checked = (type === 'utility' && r.value === store.name);
            });

            const fields = store.fields && store.fields.length > 0 ? store.fields : [
                { label: '차단기', value: store.breaker || '3P 50A' }
            ];
            renderDynamicFields(fields);

            btnPopoverDelete.style.display = 'inline-flex';

            modalOverlay.classList.remove('as-toast-overlay');
            modalOverlay.style.display = 'flex';
            statusModal.style.display = 'none';
            editModal.style.display = 'flex';
            if (editNameInput) {
                editNameInput.focus();
                editNameInput.select();
            }
        }

        function onOverlayBackdropClick(e) {
            if (e.target === modalOverlay) {
                if (editModal && editModal.style.display !== 'none' && activeSelectedStore && activeSelectedStore.isNewlyDrawn) {
                    cancelStoreEdit();
                } else {
                    closeAllPopovers();
                }
            }
        }

        function closeAllPopovers() {
            modalOverlay.classList.remove('as-toast-overlay');
            modalOverlay.style.display = 'none';
            statusModal.style.display = 'none';
            editModal.style.display = 'none';
            if (zoneModal) zoneModal.style.display = 'none';

            activeSelectedStore = null;

            if (typeof clearUtilityLineHighlight === 'function') {
                clearUtilityLineHighlight();
            }

            if (typeof activeSelectedZone !== 'undefined') {
                activeSelectedZone = null;
            }

            const svgEl = mapContainer.querySelector('svg');
            if (svgEl) {
                svgEl.querySelectorAll('.store-polygon.selected, .store-group.selected, .safety-zone-item.selected-zone').forEach(el => {
                    el.classList.remove('selected');
                    el.classList.remove('selected-zone');
                });
            }
            document.querySelectorAll('.store-item-card').forEach(c => c.classList.remove('selected'));
        }


        // 매장/기능실 정보 수정 취소 (새로 그린 매장이면 롤백 삭제)
        function cancelStoreEdit() {
            if (activeSelectedStore && activeSelectedStore.isNewlyDrawn) {
                const floor = FLOORS[currentFloorIdx];
                const sId = activeSelectedStore.id;
                const targetName = activeSelectedStore.name;
                // 커스텀 매장 목록에서 제거
                const customList = getCustomStores(floor.code).filter(cs => cs.id !== sId && cs.name !== targetName);
                saveCustomStores(floor.code, customList);
                // 현재 런타임 매장 목록에서 제거
                currentStores = currentStores.filter(s => s.id !== sId && s.name !== targetName);
                // DOM 제거
                if (activeSelectedStore.groupElement) activeSelectedStore.groupElement.remove();
                if (activeSelectedStore.polygonElement) activeSelectedStore.polygonElement.remove();
                if (activeSelectedStore.textElement) activeSelectedStore.textElement.remove();

                const svgEl = mapContainer.querySelector('svg');
                if (svgEl) {
                    svgEl.querySelectorAll(`[data-store-id="${sId}"]`).forEach(el => el.remove());
                }

                // 언두 스택 롤백
                undoStack.pop();
                updateUndoButtonState();
                syncSvgCache();
                renderStoreList(currentStores);
                showToast('도형 작성이 취소되었습니다.', 1500);
                activeSelectedStore = null;
            }
            closeAllPopovers();
        }

        // 매장/기능실 정보 저장
        function saveStoreEdit() {
            if (!activeSelectedStore) return;
            if (isImmutableStore(activeSelectedStore.name)) {
                return showToast('해당 항목은 수정할 수 없습니다.', 1500);
            }
            const newName = editNameInput.value.trim();
            const isUtil = currentEditType === 'utility';

            if (!newName) {
                return showToast(isUtil ? '기능실명을 입력해주세요.' : '매장명을 입력해주세요.', 1500);
            }

            if (activeSelectedStore) {
                delete activeSelectedStore.isNewlyDrawn;
            }

            pushUndoState('매장 정보 수정');

            const floor = FLOORS[currentFloorIdx];
            const oldName = activeSelectedStore.name;
            const fields = gatherDynamicFields();

            activeSelectedStore.name = newName;
            activeSelectedStore.type = currentEditType;
            activeSelectedStore.fillColor = currentEditColor;
            activeSelectedStore.fields = fields;

            const breakerF = fields.find(f => f.label.includes('차단기'));
            const plumbF = fields.find(f => f.label.includes('수도') || f.label.includes('급수') || f.label.includes('배관'));
            const gasF = fields.find(f => f.label.includes('가스'));
            activeSelectedStore.breaker = breakerF ? breakerF.value : '-';
            activeSelectedStore.plumbing = plumbF ? plumbF.value : '-';
            activeSelectedStore.gas = gasF ? gasF.value : '-';

            // SVG DOM 업데이트
            if (activeSelectedStore.textElement) {
                const tspan = activeSelectedStore.textElement.querySelector('tspan') || activeSelectedStore.textElement;
                tspan.textContent = newName;
            }
            if (activeSelectedStore.groupElement) {
                activeSelectedStore.groupElement.setAttribute('data-store-name', newName);
                activeSelectedStore.groupElement.setAttribute('data-store-type', currentEditType);
            }
            if (activeSelectedStore.polygonElement) {
                activeSelectedStore.polygonElement.setAttribute('fill', currentEditColor);
            }

            // 커스텀 생성 매장인 경우 customStores 업데이트
            if (activeSelectedStore.isCustom) {
                const customStores = getCustomStores(floor.code);
                const targetCs = customStores.find(cs => cs.id === activeSelectedStore.id || cs.name === oldName);
                if (targetCs) {
                    targetCs.name = newName;
                    targetCs.type = currentEditType;
                    targetCs.fillColor = currentEditColor;
                    targetCs.fields = fields;
                    saveCustomStores(floor.code, customStores);
                }
            } else if (oldName && oldName !== newName) {
                // 원본 매장명 변경 매핑 저장 (새로고침 시 자동 복원)
                const renamedMap = getRenamedStores(floor.code);
                let origKey = oldName;
                for (const [orig, curr] of Object.entries(renamedMap)) {
                    if (curr === oldName) {
                        origKey = orig;
                        break;
                    }
                }
                renamedMap[origKey] = newName;
                saveRenamedStores(floor.code, renamedMap);
            }

            // 시설 사양 저장
            const storedSpecs = getStoredSpecs(floor.code);
            if (oldName && oldName !== newName) {
                delete storedSpecs[oldName];
            }
            storedSpecs[newName] = {
                type: currentEditType,
                fillColor: currentEditColor,
                fields: fields,
                breaker: activeSelectedStore.breaker,
                plumbing: activeSelectedStore.plumbing,
                gas: activeSelectedStore.gas
            };
            saveStoredSpecs(floor.code, storedSpecs);

            syncSvgCache();
            renderStoreList(currentStores);
            closeAllPopovers();
            showToast(`'${newName}' ${isUtil ? '기능실' : '매장'} 정보가 저장되었습니다.`, 1500);
        }

        // 매장/기능실 도형 및 정보 즉시 삭제 (상단 토스트 1초간 표시, 삭제된 도형은 바닥 색상 흰색(#ffffff)으로 영구 보존)
        function deleteCurrentStore() {
            if (!activeSelectedStore) return;
            if (isImmutableStore(activeSelectedStore.name)) {
                return showToast('해당 항목은 삭제할 수 없습니다.', 1500);
            }
            pushUndoState('매장 삭제');

            const targetName = activeSelectedStore.name;
            const isUtil = activeSelectedStore.type === 'utility';
            const floor = FLOORS[currentFloorIdx];

            // 1. 사용자가 추가/편집으로 생성한 커스텀 도형인 경우:
            // 흰색(#ffffff) 바닥으로 덮지 않고 도형 자체를 즉시 제거하여 바탕의 원래 색상(#cbdbe9 공용부 등)이 그대로 유지되도록 처리!
            if (activeSelectedStore.isCustom) {
                const customList = getCustomStores(floor.code).filter(cs => cs.name !== targetName && cs.id !== activeSelectedStore.id);
                saveCustomStores(floor.code, customList);
                activeSelectedStore.groupElement?.remove();
                activeSelectedStore.polygonElement?.remove();
                activeSelectedStore.textElement?.remove();
            } else {
                // 2. 기본 원본 매장 도형일 경우
                const pathD = activeSelectedStore.pathData || activeSelectedStore.polygonElement?.getAttribute('d');
                if (pathD) {
                    // 원본 색상이 공용시설/기능실 슬레이트(#cbdbe9, #c7c0b7)인 경우 흰색으로 덮지 않고 원형 유지
                    const origFill = (activeSelectedStore.polygonElement?.getAttribute('data-orig-fill') || activeSelectedStore.fillColor || '').toLowerCase();
                    const isFacilitySlate = origFill === '#cbdbe9' || origFill === '#c7c0b7';
                    if (!isFacilitySlate) {
                        const vacantList = getVacantPolygons(floor.code);
                        if (!vacantList.some(v => v.pathData === pathD)) {
                            vacantList.push({
                                id: 'vacant_' + Date.now(),
                                pathData: pathD,
                                fillColor: '#ffffff'
                            });
                            saveVacantPolygons(floor.code, vacantList);
                        }
                    }
                }

                if (activeSelectedStore.textElement) {
                    activeSelectedStore.textElement.remove();
                }
                if (activeSelectedStore.polygonElement) {
                    const origFill = (activeSelectedStore.polygonElement.getAttribute('data-orig-fill') || activeSelectedStore.fillColor || '').toLowerCase();
                    const isFacilitySlate = origFill === '#cbdbe9' || origFill === '#c7c0b7';
                    if (!isFacilitySlate) {
                        activeSelectedStore.polygonElement.setAttribute('fill', '#ffffff');
                        activeSelectedStore.polygonElement.setAttribute('stroke', '#ffffff');
                        activeSelectedStore.polygonElement.setAttribute('stroke-width', '0');
                        activeSelectedStore.polygonElement.style.stroke = 'none';
                        activeSelectedStore.polygonElement.style.strokeWidth = '0';
                        activeSelectedStore.polygonElement.classList.remove('store-polygon', 'selected');
                        activeSelectedStore.polygonElement.classList.add('vacant-floor-polygon');
                    } else {
                        activeSelectedStore.polygonElement.setAttribute('fill', '#cbdbe9');
                        activeSelectedStore.polygonElement.classList.remove('store-polygon', 'selected');
                    }
                    activeSelectedStore.polygonElement.onclick = null;
                }

                const deletedList = getDeletedStores(floor.code);
                if (!deletedList.includes(targetName)) {
                    deletedList.push(targetName);
                    saveDeletedStores(floor.code, deletedList);
                }
            }

            currentStores = currentStores.filter(s => s.name !== targetName && s.id !== activeSelectedStore.id);
            closeAllPopovers();
            renderStoreList(currentStores);
            syncSvgCache();
            showToast(`${isUtil ? '기능실' : '매장'} '${targetName}'이(가) 삭제되었습니다.`, 1500);
        }


        // ================= 다각형 클릭 연결 드로잉 CAD 엔진 =================
        function toggleAddStoreMode() {
            isDrawingMode = !isDrawingMode;
            if (isDrawingMode) {
                document.body.classList.add('drawing-locked');
                btnAddStore.classList.add('active-mode');
                btnAddStore.querySelector('span').textContent = '드로잉 종료 (ESC)';
                viewport.classList.add('crosshair');
                drawingGuideBanner.style.display = 'flex';
                drawingPoints = [];
                createTempDrawingGroup();
                showFloorGrid();
                showToast('도면을 클릭하여 다각형 꼭짓점을 연결하세요.');
            } else {
                exitAddStoreMode();
            }
        }

        function exitAddStoreMode() {
            isDrawingMode = false;
            document.body.classList.remove('drawing-locked');
            btnAddStore.classList.remove('active-mode');
            btnAddStore.querySelector('span').textContent = '매장 추가/편집';
            viewport.classList.remove('crosshair');
            drawingGuideBanner.style.display = 'none';
            cleanupTempDrawingGroup();
            drawingPoints = [];
            hideFloorGrid();
        }

        function createTempDrawingGroup() {
            cleanupTempDrawingGroup();
            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return;
            tempDrawingGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            tempDrawingGroup.setAttribute('id', 'temp-drawing-layer');
            svgEl.appendChild(tempDrawingGroup);
        }

        function cleanupTempDrawingGroup() {
            if (tempDrawingGroup) {
                tempDrawingGroup.remove();
                tempDrawingGroup = null;
            }
            const existing = mapContainer.querySelector('#temp-drawing-layer');
            if (existing) existing.remove();
        }

        function updateDrawingPreview(currentMouseSvgX = null, currentMouseSvgY = null) {
            if (!tempDrawingGroup) return;
            tempDrawingGroup.innerHTML = '';
            if (drawingPoints.length === 0) return;

            // 1. 고정된 선들 (직선만 지원)
            const polylinePoints = drawingPoints.map(p => `${p.x},${p.y}`).join(' ');
            const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', polylinePoints);
            polyline.setAttribute('stroke', '#1d4ed8');
            polyline.setAttribute('stroke-width', '2.5');
            polyline.setAttribute('stroke-dasharray', '6 3');
            polyline.setAttribute('fill', 'none');
            tempDrawingGroup.appendChild(polyline);

            // 2. 마우스 커서로 이어지는 실시간 러버밴드 직선 및 그리드 자석 스냅
            if (currentMouseSvgX !== null && currentMouseSvgY !== null && drawingPoints.length > 0) {
                let targetX = currentMouseSvgX;
                let targetY = currentMouseSvgY;
                let isSnapped = false;
                if (typeof snapToGrid === 'function') {
                    const gSnap = snapToGrid(currentMouseSvgX, currentMouseSvgY);
                    if (gSnap.isSnapped) {
                        targetX = gSnap.x;
                        targetY = gSnap.y;
                        isSnapped = true;
                    }
                }

                const lastPt = drawingPoints[drawingPoints.length - 1];
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', lastPt.x);
                line.setAttribute('y1', lastPt.y);
                line.setAttribute('x2', targetX);
                line.setAttribute('y2', targetY);
                line.setAttribute('stroke', '#2563eb');
                line.setAttribute('stroke-width', '2');
                line.setAttribute('stroke-dasharray', '4 3');
                tempDrawingGroup.appendChild(line);

                if (isSnapped) {
                    const snapRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    snapRing.setAttribute('cx', targetX.toFixed(1));
                    snapRing.setAttribute('cy', targetY.toFixed(1));
                    snapRing.setAttribute('r', '7');
                    snapRing.setAttribute('fill', 'rgba(37, 99, 235, 0.2)');
                    snapRing.setAttribute('stroke', '#2563eb');
                    snapRing.setAttribute('stroke-width', '2');
                    tempDrawingGroup.appendChild(snapRing);
                }
            }

            // 3. 꼭짓점 원형 마커
            drawingPoints.forEach((p, i) => {
                const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                circle.setAttribute('cx', p.x);
                circle.setAttribute('cy', p.y);
                circle.setAttribute('r', i === 0 ? '6' : '4');
                circle.setAttribute('fill', i === 0 ? '#2563eb' : '#ffffff');
                circle.setAttribute('stroke', '#1d4ed8');
                circle.setAttribute('stroke-width', '2');
                tempDrawingGroup.appendChild(circle);
            });
        }

        // 다각형 완성 및 매장 생성 (도형 + 매장명 그룹화)
        function finishDrawingPolygon() {
            if (drawingPoints.length < 3) {
                showToast('다각형을 만들려면 최소 3개 이상의 꼭짓점이 필요합니다.');
                return;
            }

            // 기존 도형과 겹침 방지 및 8px 평행 간격 자동 보정
            drawingPoints = adjustStorePolygonClearance(drawingPoints);

            pushUndoState('매장 추가');

            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return;

            // 1. 다각형 Path 생성 (직선 연결 곡선 불가)
            const pathData = 'M ' + drawingPoints.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ') + ' Z';
            const newPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            newPath.setAttribute('d', pathData);
            newPath.setAttribute('fill', '#e6f0fc'); // 블루 톤
            newPath.setAttribute('stroke', '#c8ddf7');
            newPath.setAttribute('stroke-width', '1');
            newPath.classList.add('store-polygon');

            // 바운딩 박스 계산
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            let sumX = 0, sumY = 0;
            drawingPoints.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
                sumX += p.x;
                sumY += p.y;
            });
            const width = maxX - minX;
            const height = maxY - minY;
            const centroidX = sumX / drawingPoints.length;
            const centroidY = sumY / drawingPoints.length;

            newPath.setAttribute('ds-x', (minX + width/2).toFixed(2));
            newPath.setAttribute('ds-y', (minY + height/2).toFixed(2));
            newPath.setAttribute('ds-width', width.toFixed(2));
            newPath.setAttribute('ds-height', height.toFixed(2));

            // 2. 매장명 텍스트 요소 생성
            const newText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            newText.setAttribute('font-family', 'Pretendard, sans-serif');
            newText.setAttribute('font-size', '18');
            newText.setAttribute('font-weight', '600');
            newText.setAttribute('fill', '#0f172a');
            newText.setAttribute('text-anchor', 'middle');
            newText.setAttribute('x', centroidX.toFixed(2));
            newText.setAttribute('y', (centroidY + 6).toFixed(2)); // 살짝 텍스트 베이스라인 보정
            newText.classList.add('editable-store-name');

            const newTspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
            newTspan.textContent = '새 매장';
            newText.appendChild(newTspan);

            // 3. 다각형과 텍스트를 하나의 <g class="store-group">으로 묶기
            const sId = currentStores.length > 0 ? Math.max(...currentStores.map(s => s.id)) + 1 : 0;
            const newGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            newGroup.setAttribute('class', 'store-group');
            newGroup.setAttribute('data-store-id', sId);
            newGroup.setAttribute('data-store-name', '새 매장');
            newGroup.setAttribute('data-store-type', 'store');
            newPath.setAttribute('data-store-id', sId);
            newText.setAttribute('data-store-id', sId);

            newGroup.appendChild(newPath);
            newGroup.appendChild(newText);
            let customTopLayer = svgEl.querySelector('#custom-stores-top-layer');
            if (!customTopLayer) {
                customTopLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                customTopLayer.setAttribute('id', 'custom-stores-top-layer');
                svgEl.appendChild(customTopLayer);
            }
            customTopLayer.appendChild(newGroup);

            // 4. 기본 시설 사양 목록 구성 및 스토어 객체 등록 (차단기만 유지)
            const defaultFields = [
                { label: '차단기', value: '3P 50A' }
            ];

            const floor = FLOORS[currentFloorIdx];
            const storeItem = {
                id: sId,
                name: '새 매장',
                type: 'store',
                fillColor: '#e6f0fc',
                fields: defaultFields,
                x: centroidX,
                y: centroidY,
                pathData: pathData,
                isCustom: true,
                isNewlyDrawn: true,
                textElement: newText,
                polygonElement: newPath,
                groupElement: newGroup,
                breaker: '3P 50A',
                plumbing: '미사용',
                gas: '미사용'
            };

            // 커스텀 생성 매장 목록에 저장 (새로고침 시 복원)
            const customStores = getCustomStores(floor.code);
            customStores.push({
                id: sId,
                name: '새 매장',
                type: 'store',
                fillColor: '#e6f0fc',
                fields: defaultFields,
                pathData: pathData,
                x: centroidX,
                y: centroidY,
                isCustom: true
            });
            saveCustomStores(floor.code, customStores);

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
            newText.onclick = clickHandler;
            newPath.onclick = clickHandler;

            currentStores.push(storeItem);
            cleanupTempDrawingGroup();
            syncSvgCache();
            renderStoreList(currentStores);
            exitAddStoreMode();

            // 즉시 정보 입력 모달 오픈
            openEditModalForStore(storeItem);
            showToast('새 도형이 생성되었습니다. 정보를 입력해주세요.', 1500);
        }