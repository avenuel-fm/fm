/* ==========================================================================
   undoManager.js - 최대 5회 히스토리 스택 및 되돌리기(Undo) 엔진
   ========================================================================== */

var MAX_UNDO = 5;
var undoStack = [];

        // 되돌리기(Undo) 히스토리 엔진 (최대 5회 클립보드/세션 백업 지원)
        function pushUndoState(actionName = '작업') {
            const floor = FLOORS[currentFloorIdx];
            if (!floor) return;

            const snapshot = {
                floorIdx: currentFloorIdx,
                floorCode: floor.code,
                actionName: actionName,
                deletedStores: JSON.parse(JSON.stringify(getDeletedStores(floor.code))),
                renamedStores: JSON.parse(JSON.stringify(getRenamedStores(floor.code))),
                customStores: JSON.parse(JSON.stringify(getCustomStores(floor.code))),
                storedSpecs: JSON.parse(JSON.stringify(getStoredSpecs(floor.code))),
                storeBook: getStoreBook(floor.code),
                vacantPolygons: JSON.parse(JSON.stringify(getVacantPolygons(floor.code))),
                floorZones: JSON.parse(JSON.stringify(getFloorZones(floor.code))),
                symbols: JSON.parse(JSON.stringify(typeof loadFloorSymbols === 'function' ? loadFloorSymbols(floor.code) : [])),
                utilityLines: typeof getFloorUtilityLines === 'function' ? getFloorUtilityLines(floor.code) : [],
                timestamp: Date.now()
            };

            undoStack.push(snapshot);
            if (undoStack.length > MAX_UNDO) {
                undoStack.shift();
            }

            try {
                sessionStorage.setItem('lotte_undo_clipboard', JSON.stringify(undoStack));
            } catch (e) {}

            updateUndoButtonState();
        }

        function handleUndo() {
            if (undoStack.length === 0) {
                showToast('되돌릴 이전 작업 내역이 없습니다.', 1500);
                return;
            }

            const prevState = undoStack.pop();
            const floorCode = prevState.floorCode;

            saveDeletedStores(floorCode, prevState.deletedStores);
            saveRenamedStores(floorCode, prevState.renamedStores);
            saveCustomStores(floorCode, prevState.customStores);
            saveStoredSpecs(floorCode, prevState.storedSpecs);
            if (prevState.storeBook) saveStoreBook(floorCode, prevState.storeBook);
            saveVacantPolygons(floorCode, prevState.vacantPolygons);
            saveFloorZones(floorCode, prevState.floorZones);
            if (prevState.symbols && typeof saveFloorSymbols === 'function') {
                saveFloorSymbols(floorCode, prevState.symbols);
            }
            if (prevState.utilityLines && typeof saveFloorUtilityLines === 'function') {
                saveFloorUtilityLines(floorCode, prevState.utilityLines);
            }

            try {
                sessionStorage.setItem('lotte_undo_clipboard', JSON.stringify(undoStack));
            } catch (e) {}

            svgCache.delete(floorCode);
            try {
                const storageKey = typeof getSavedSvgStorageKey === 'function' ? getSavedSvgStorageKey(floorCode) : `lotte_saved_svg_${floorCode}`;
                mapStore.removeItem(storageKey);
            } catch (e) {}

            closeAllPopovers();

            if (currentFloorIdx !== prevState.floorIdx) {
                selectFloor(prevState.floorIdx);
            } else {
                selectFloor(currentFloorIdx, true);
            }

            updateUndoButtonState();
            showToast(`'${prevState.actionName}' 작업을 되돌렸습니다. (남은 되돌리기: ${undoStack.length}회)`, 1500);
        }

        function updateUndoButtonState() {
            const btnUndo = document.getElementById('btn-undo');
            if (!btnUndo) return;
            const count = undoStack.length;
            if (count === 0) {
                btnUndo.style.opacity = '0.5';
                btnUndo.title = '되돌리기 (작업 내역 없음)';
            } else {
                btnUndo.style.opacity = '1';
                btnUndo.title = `되돌리기 (남은 횟수: ${count}회, 단축키: Ctrl+Z)`;
            }
        }