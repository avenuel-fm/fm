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
                if (editBadge) editBadge.textContent = '기능실 편집';
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
                if (editBadge) editBadge.textContent = '정보 편집';
                if (currentEditColor === '#cbdbe9') {
                    selectEditColor('#e6f0fc');
                }
            }
            applyTypeShape(type);
        }

        // 탭을 바꾸면 모양도 그 종류 규칙으로 (결정 316): 기능실 = 매장 옆이면 붙고 3px · 매장 침범은 그린 대로, 매장 = 기존 도형과 2px.
        // 수정 창이 열린 직접 그린 도형만, 저장 때 남음(닫으면 되돌림)
        function applyTypeShape(type) {
            const se = typeof shapeEdit !== 'undefined' ? shapeEdit : null;
            if (!se || se.store !== activeSelectedStore) return;
            const p = se.store.polygonElement;
            const raw = se.store.rawPts || parseSvgPathPoints(se.origD);
            let pts;
            try {
                if (type === 'utility') pts = utilityShapeFor(raw, p);
                else if (se.store.rawPts) {
                    const rs = avoidStoreShapes([raw.map(q => [q.x, q.y])], false, null, p);
                    pts = rs.length ? rs.reduce((a, r) => ringArea(r) > ringArea(a) ? r : a).map(q => ({ x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10 })) : raw;
                } else pts = parseSvgPathPoints(se.origD);
            } catch (err) { console.warn('모양 다시 계산 실패', err); return; }
            if (pts.length < 3) return;
            p.setAttribute('d', pointsToPathD(pts));
            shapeRelabel(se.store, true);
            drawShapeHandles();
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

        // 수정 창의 상세 항목 칸 (항목은 엑셀에 열을 더해 늘림, 결정 154)
        function renderStoreDetailForm(store) {
            const box = document.getElementById('store-detail-form');
            if (!box) return;
            if (!store.bookId) {
                box.innerHTML = '<p class="store-form-note">이 글자는 묶인 도형이 없어 상세내역을 넣을 수 없습니다.</p>';
                return;
            }
            const book = getStoreBook(FLOORS[currentFloorIdx].code);
            const it = book.items[store.bookId] || { details: {} };
            box.innerHTML = StoreBook.groups(StoreBook.itemsWith(getStoreItems(), book), it).map(g => `
                <div class="store-form-title">${escapeHtml(g.title)}</div>
                <div class="store-form-grid${g.rows.length === 4 ? ' cols2' : ''}">${g.rows.map(r => `
                    <div class="form-group"><label>${escapeHtml(r.label)}</label><input type="text" data-detail-key="${escapeHtml(r.key)}" value="${escapeHtml(r.value)}"></div>`).join('')}
                </div>`).join('');
        }

        function gatherStoreDetails() {
            const out = {};
            document.querySelectorAll('#store-detail-form [data-detail-key]').forEach(el => {
                const v = StoreBook.clean(el.value);
                if (v) out[el.getAttribute('data-detail-key')] = v;
            });
            return out;
        }

        function setStoreIdChip(el, store) {
            if (!el) return;
            el.textContent = store.bookId || '';
            el.hidden = !store.bookId;
        }

        // 이름만 지움: 고유번호·상세내역은 도형에 그대로 남음
        function clearStoreName() {
            if (!activeSelectedStore || !activeSelectedStore.bookId) return;
            if (editNameInput) editNameInput.value = '';
            saveStoreEdit();
        }

        // 매장/기능실 선택 및 모달 열기
        function selectAndHighlightStore(storeItem) {
            if (shapeEdit && shapeEdit.store === storeItem) return;   // 고치는 중인 도형을 누르거나 끈 것은 선택이 아님
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
            if (statusBadge) statusBadge.textContent = isUtil ? '기능실 시설 현황' : '매장 시설 현황';

            statusStoreName.textContent = StoreBook.show(storeItem.name);
            setStoreIdChip(document.getElementById('status-store-id'), storeItem);

            // 동적 시설 항목 테이블 렌더링
            const tableEl = document.getElementById('status-facility-table');
            if (tableEl) {
                tableEl.innerHTML = '';
                const book = getStoreBook(FLOORS[currentFloorIdx].code);
                const it = storeItem.bookId && book.items[storeItem.bookId];
                const sections = it ? StoreBook.groups(StoreBook.itemsWith(getStoreItems(), book), it)
                    : [{ title: '', rows: (storeItem.fields || []) }];
                if (sections.some(g => g.rows.length)) {
                    tableEl.innerHTML = sections.map(g => `
                        ${g.title ? `<div class="facility-group">${escapeHtml(g.title)}</div>` : ''}
                        ${g.rows.map(f => `<div class="facility-row"><div class="facility-label">${escapeHtml(f.label)}</div><div class="facility-value">${escapeHtml(f.value || '-')}</div></div>`).join('')}`).join('');
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
                btnConnect.className = 'btn-sm btn-sm-primary';
                btnConnect.textContent = '매장 연결선';
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
            if (!store || isImmutableStore(store.name) || mapStore.readOnly()) return;
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

            let currentColor = store.fillColor || store.polygonElement?.getAttribute('fill') || (type === 'utility' ? '#cbdbe9' : '#e6f0fc');
            if (type !== 'utility' && currentColor.toLowerCase() === '#cbdbe9') currentColor = '#e6f0fc';   // 매장명 탭 기본은 첫 번째 색 (결정 314)
            selectEditColor(currentColor);

            // 기능실 라디오 버튼 상태 동기화
            const utilRadios = document.querySelectorAll('input[name="util-type-opt"]');
            utilRadios.forEach(r => {
                r.checked = (type === 'utility' && r.value === store.name);
            });

            renderStoreDetailForm(store);
            setStoreIdChip(document.getElementById('edit-store-id'), store);
            document.getElementById('store-name-note').hidden = !store.bookId;
            document.getElementById('btn-clear-name').hidden = !store.bookId;

            btnPopoverDelete.style.display = 'inline-flex';

            modalOverlay.classList.remove('as-toast-overlay');
            modalOverlay.classList.add('as-side-overlay');   // 창은 오른쪽 아래, 지도는 그대로 만짐 (결정 308)
            modalOverlay.style.display = 'flex';
            statusModal.style.display = 'none';
            editModal.style.display = 'flex';
            startShapeEdit(store);
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
            endShapeEdit();   // 저장 안 하고 닫으면 모양·자리 되돌림
            modalOverlay.classList.remove('as-toast-overlay', 'as-side-overlay');
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
                const customList = getCustomStores(floor.code).filter(cs => cs.id !== sId);
                saveCustomStores(floor.code, customList);
                if (activeSelectedStore.shapeKey) saveStoreBook(floor.code, StoreBook.removeShape(getStoreBook(floor.code), activeSelectedStore.shapeKey, false));
                // 현재 런타임 매장 목록에서 제거
                currentStores = currentStores.filter(s => s.id !== sId);
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

            if (!newName && !activeSelectedStore.bookId) {
                return showToast(isUtil ? '기능실명을 입력해주세요.' : '매장명을 입력해주세요.', 1500);
            }

            if (activeSelectedStore) {
                delete activeSelectedStore.isNewlyDrawn;
            }

            pushUndoState('매장 정보 수정');
            const editedStore = activeSelectedStore;
            const shapeChanged = commitShapeEdit();

            const floor = FLOORS[currentFloorIdx];
            const oldName = activeSelectedStore.name;
            const bookId = activeSelectedStore.bookId;

            activeSelectedStore.name = newName;
            activeSelectedStore.type = currentEditType;
            activeSelectedStore.fillColor = currentEditColor;

            // 대장에 저장: 번호는 그대로, 이름·상세내역만 바뀜 (결정 154)
            if (bookId) {
                const book = getStoreBook(floor.code);
                const it = book.items[bookId];
                if (it) {
                    it.name = newName;
                    it.type = currentEditType;
                    it.color = currentEditColor;
                    it.details = gatherStoreDetails();
                    saveStoreBook(floor.code, book);
                    activeSelectedStore.details = it.details;
                    activeSelectedStore.fields = StoreBook.fields(StoreBook.itemsWith(getStoreItems(), book), it);
                }
            }

            // SVG DOM 업데이트
            if (activeSelectedStore.textElement) {
                if (activeSelectedStore.isCustom) layoutStoreLabel(activeSelectedStore.textElement, StoreBook.show(newName), activeSelectedStore.polygonElement);
                else {
                    const tspan = activeSelectedStore.textElement.querySelector('tspan') || activeSelectedStore.textElement;
                    tspan.textContent = StoreBook.show(newName);
                }
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
                const targetCs = customStores.find(cs => cs.id === activeSelectedStore.id);
                if (targetCs) {
                    targetCs.name = newName;
                    targetCs.type = currentEditType;
                    targetCs.fillColor = currentEditColor;
                    saveCustomStores(floor.code, customStores);
                }
            } else if (!bookId && oldName && oldName !== newName) {
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

            // 도형 없는 글자만 예전 칸에 종류·색을 남김
            if (!bookId) {
                const storedSpecs = getStoredSpecs(floor.code);
                if (oldName && oldName !== newName) {
                    delete storedSpecs[oldName];
                }
                storedSpecs[newName] = { type: currentEditType, fillColor: currentEditColor, fields: [] };
                saveStoredSpecs(floor.code, storedSpecs);
            }

            syncSvgCache();
            renderStoreList(currentStores);
            closeAllPopovers();
            showToast(`'${StoreBook.show(newName)}' ${isUtil ? '기능실' : '매장'} 정보가 저장되었습니다.`, 1500);
            if (shapeChanged && typeof rerouteLinesForStore === 'function' && rerouteLinesForStore(editedStore)) syncSvgCache();   // 붙은 연결선도 새 자리로
        }

        // ================= 직접 그린 도형 크기 조절·옮기기 (수정 창이 열린 동안, 결정 308) =================
        var shapeEdit = null;   // { store, origD }

        // 도형 모양이 바뀐 것을 저장 (직접 그린 도형만, 보기 전용은 화면만)
        function persistCustomShape(pathEl) {
            if (!pathEl || mapStore.readOnly()) return;
            const d = pathEl.getAttribute('d'), pts = parseSvgPathPoints(d);
            if (pts.length < 3) return;
            const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
            const floor = FLOORS[currentFloorIdx], id = String(pathEl.getAttribute('data-store-id'));
            const list = getCustomStores(floor.code), cs = list.find(c => String(c.id) === id);
            if (cs) { cs.pathData = d; cs.x = cx; cs.y = cy; saveCustomStores(floor.code, list); }
            const s = currentStores.find(x => x.polygonElement === pathEl);
            if (s) { s.pathData = d; s.x = cx; s.y = cy; }
        }

        function shapeRelabel(store, noGrow) {
            if (store.textElement && store.polygonElement) layoutStoreLabel(store.textElement, StoreBook.show(store.name), store.polygonElement, noGrow);
        }

        function startShapeEdit(store) {
            endShapeEdit();
            const p = store && store.polygonElement;
            if (!store || !store.isCustom || !p || mapStore.readOnly()) return;
            shapeEdit = { store, origD: p.getAttribute('d') };
            p.classList.remove('selected');            // 원래 색 그대로 보이게
            p.classList.add('shape-editing');
            if (store.groupElement) store.groupElement.classList.remove('selected');
            if (store.textElement) store.textElement.style.pointerEvents = 'none';
            p.onmousedown = e => shapeDrag(e, (pts, dx, dy) => pts.map(q => ({ x: q.x + dx, y: q.y + dy })));
            drawShapeHandles();
        }

        function endShapeEdit() {
            const se = shapeEdit;
            if (!se) return;
            shapeEdit = null;
            const p = se.store.polygonElement;
            if (p) {
                if (p.getAttribute('d') !== se.origD) { p.setAttribute('d', se.origD); shapeRelabel(se.store, true); }
                p.classList.remove('shape-editing');
                p.onmousedown = null;
            }
            if (se.store.textElement) se.store.textElement.style.pointerEvents = '';
            mapContainer.querySelector('#shape-edit-handles')?.remove();
        }

        // 저장 때: 바뀐 모양을 남기고 끝냄 → 바뀌었으면 true
        function commitShapeEdit() {
            const se = shapeEdit;
            if (!se) return false;
            const d = se.store.polygonElement.getAttribute('d'), changed = d !== se.origD;
            se.origD = d;
            endShapeEdit();
            if (changed) persistCustomShape(se.store.polygonElement);
            return changed;
        }

        // 점선 테두리 + 모서리 네 개 손잡이 (화면에서 늘 같은 크기)
        function drawShapeHandles() {
            const svgEl = mapContainer.querySelector('svg');
            svgEl?.querySelector('#shape-edit-handles')?.remove();
            if (!svgEl || !shapeEdit) return;
            const pts = parseSvgPathPoints(shapeEdit.store.polygonElement.getAttribute('d'));
            if (pts.length < 3) return;
            const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
            const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
            const k = 1 / (typeof scale !== 'undefined' && scale ? scale : 1), ns = 'http://www.w3.org/2000/svg';
            const g = document.createElementNS(ns, 'g');
            g.setAttribute('id', 'shape-edit-handles');
            const mk = (tag, at) => { const e = document.createElementNS(ns, tag); Object.entries(at).forEach(([n, v]) => e.setAttribute(n, v)); g.appendChild(e); return e; };
            mk('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'none', stroke: '#2563eb', 'stroke-width': 1.5 * k, 'stroke-dasharray': `${6 * k} ${4 * k}`, 'pointer-events': 'none' });
            const H = 10 * k;
            [[x0, y0, 'nwse'], [x1, y0, 'nesw'], [x1, y1, 'nwse'], [x0, y1, 'nesw']].forEach(([cx, cy, cur], i) => {
                const h = mk('rect', { x: cx - H / 2, y: cy - H / 2, width: H, height: H, class: 'shape-handle', 'stroke-width': 1.5 * k, 'data-corner': i });
                h.style.cursor = cur + '-resize';
                const ox = i === 0 || i === 3 ? x1 : x0, oy = i < 2 ? y1 : y0;   // 맞은편 모서리가 기준
                h.onmousedown = e => shapeDrag(e, (pts0, dx, dy, ev) => {
                    const w = cx - ox, hh = cy - oy;
                    let fx = w ? (w + dx) / w : 1, fy = hh ? (hh + dy) / hh : 1;
                    if (!ev.shiftKey) fx = fy = Math.max(0.05, (fx * Math.abs(w) + fy * Math.abs(hh)) / (Math.abs(w) + Math.abs(hh)));   // 그린 모양 그대로 (Shift 는 가로·세로 따로)
                    fx = Math.max(0.05, fx); fy = Math.max(0.05, fy);
                    return pts0.map(q => ({ x: ox + (q.x - ox) * fx, y: oy + (q.y - oy) * fy }));
                });
            });
            svgEl.appendChild(g);
        }

        // 끌기 공통: apply(시작 점들, 지도 dx, dy, 이벤트) → 새 점들
        function shapeDrag(e, apply) {
            if (e.button !== 0 || !shapeEdit) return;
            e.stopPropagation(); e.preventDefault();       // 지도 끌기 대신 도형 끌기
            const se = shapeEdit, p = se.store.polygonElement;
            const pts0 = parseSvgPathPoints(p.getAttribute('d')), sx = e.clientX, sy = e.clientY;
            const ctm = p.getScreenCTM(), k = ctm && ctm.a ? ctm.a : 1;
            let moved = false;
            const move = ev => {
                if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
                moved = true;
                p.setAttribute('d', pointsToPathD(apply(pts0, (ev.clientX - sx) / k, (ev.clientY - sy) / k, ev)));
                shapeRelabel(se.store, true);
                drawShapeHandles();
            };
            const up = () => {
                window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
                if (moved) shapeRelabel(se.store, true);
            };
            window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
        }

        // 매장/기능실 도형 및 정보 즉시 삭제 (상단 토스트 1초간 표시, 삭제된 도형은 바닥 색상 흰색(#ffffff)으로 영구 보존)
        function deleteCurrentStore() {
            if (!activeSelectedStore) return;
            if (isImmutableStore(activeSelectedStore.name)) {
                return showToast('해당 항목은 삭제할 수 없습니다.', 1500);
            }
            if (activeSelectedStore.bookId && !confirm('도형을 삭제하면 매장명·고유번호·상세내역이 함께 삭제됩니다. 삭제할까요?')) return;
            pushUndoState('매장 삭제');

            const targetName = activeSelectedStore.name;
            const isUtil = activeSelectedStore.type === 'utility';
            const floor = FLOORS[currentFloorIdx];
            const shapeKey = activeSelectedStore.shapeKey;
            const shapeBase = shapeKey ? StoreBook.baseOf(shapeKey) : null;

            // 1. 사용자가 추가/편집으로 생성한 커스텀 도형인 경우:
            // 흰색(#ffffff) 바닥으로 덮지 않고 도형 자체를 즉시 제거하여 바탕의 원래 색상(#cbdbe9 공용부 등)이 그대로 유지되도록 처리!
            if (activeSelectedStore.isCustom) {
                const customList = getCustomStores(floor.code).filter(cs => cs.id !== activeSelectedStore.id);
                saveCustomStores(floor.code, customList);
                if (shapeKey) saveStoreBook(floor.code, StoreBook.removeShape(getStoreBook(floor.code), shapeKey, false));
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

                if (shapeKey) {
                    // 도형에 묶어 지움: 같은 이름의 다른 도형은 남고, 이 도형을 같이 쓰던 글자는 함께 지움
                    saveStoreBook(floor.code, StoreBook.removeShape(getStoreBook(floor.code), shapeKey, true));
                    currentStores.filter(s => s.shapeKey && StoreBook.baseOf(s.shapeKey) === shapeBase).forEach(s => s.textElement?.remove());
                } else {
                    const deletedList = getDeletedStores(floor.code);
                    if (!deletedList.includes(targetName)) {
                        deletedList.push(targetName);
                        saveDeletedStores(floor.code, deletedList);
                    }
                }
            }

            currentStores = currentStores.filter(s => s.id !== activeSelectedStore.id && !(shapeBase && s.shapeKey && StoreBook.baseOf(s.shapeKey) === shapeBase));
            closeAllPopovers();
            renderStoreList(currentStores);
            syncSvgCache();
            showToast(`${isUtil ? '기능실' : '매장'} '${StoreBook.show(targetName)}'이(가) 삭제되었습니다.`, 1500);
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
            // 기존 매장·기능실과 겹친 부분을 빼고 둘레 2px 띄움. 둘로 나뉘면 큰 쪽만 (결정 314)
            // 닫힌 외벽 밖은 잘라 냄 (결정 316). 기능실 탭을 고르면 이 모양(rawPts)에서 다시 계산
            let rawPts = drawingPoints.slice();
            try {
                const toPts = r => r.map(q => ({ x: Math.round(q[0] * 10) / 10, y: Math.round(q[1] * 10) / 10 }));
                const inWall = clipRingsToWall([drawingPoints.map(p => [p.x, p.y])], 0);
                if (!inWall.length) { showToast('그린 도형이 모두 외벽 밖입니다.', 2000); return; }
                if (inWall.length > 1 || Math.abs(ringArea(inWall[0]) - ringArea(drawingPoints.map(p => [p.x, p.y]))) > 1) {
                    rawPts = toPts(inWall.reduce((a, r) => ringArea(r) > ringArea(a) ? r : a));
                    showToast('외벽 밖으로 나간 부분은 잘라 냈습니다.', 1500);
                }
                drawingPoints = rawPts;
                const rings = avoidStoreShapes([drawingPoints.map(p => [p.x, p.y])], false);
                if (!rings.length) { showToast('그린 도형이 모두 기존 매장 안이라 남는 곳이 없습니다.', 2000); return; }
                const big = rings.reduce((a, r) => ringArea(r) > ringArea(a) ? r : a);
                const moved = rings.length > 1 || Math.abs(ringArea(big) - ringArea(drawingPoints.map(p => [p.x, p.y]))) > 0.5;
                if (moved) drawingPoints = toPts(big);
                if (moved) showToast('기존 도형과 겹치지 않게 2px 띄워 그렸습니다.', 1500);
            } catch (err) { console.warn('매장 피하기 실패, 그린 그대로', err); }

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
            newText.setAttribute('font-size', String(STORE_LABEL_SIZE));
            newText.setAttribute('font-weight', '400');
            newText.setAttribute('fill', '#000000');
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

            // 4. 스토어 객체 등록 (상세내역은 빈 칸으로 시작)
            const shapeKey = 'c_' + Date.now().toString(36);
            const floor = FLOORS[currentFloorIdx];
            const storeItem = {
                id: sId,
                name: '새 매장',
                type: 'store',
                fillColor: '#e6f0fc',
                fields: [],
                x: centroidX,
                y: centroidY,
                pathData: pathData,
                isCustom: true,
                isNewlyDrawn: true,
                textElement: newText,
                polygonElement: newPath,
                groupElement: newGroup,
                shapeKey: shapeKey,
                shapeW: width,
                shapeH: height,
                rawPts: rawPts
            };

            // 커스텀 생성 매장 목록에 저장 (새로고침 시 복원)
            const customStores = getCustomStores(floor.code);
            customStores.push({
                id: sId,
                name: '새 매장',
                type: 'store',
                fillColor: '#e6f0fc',
                fields: [],
                pathData: pathData,
                x: centroidX,
                y: centroidY,
                isCustom: true,
                shape: shapeKey
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
            layoutStoreLabel(newText, '새 매장', newPath);
            bringZoneLayersToFront();   // 새 매장 층이 생겨도 인포 그림은 그 위로
            applyStoreBook(floor);   // 새 도형에 새 고유번호
            cleanupTempDrawingGroup();
            syncSvgCache();
            renderStoreList(currentStores);
            exitAddStoreMode();

            // 즉시 정보 입력 모달 오픈
            openEditModalForStore(storeItem);
            showToast('새 도형이 생성되었습니다. 정보를 입력해주세요.', 1500);
        }