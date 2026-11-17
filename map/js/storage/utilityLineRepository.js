/* ==========================================================================
   utilityLineRepository.js - 기능실(자)과 매장(모) 연결 배관/간선 로컬 저장소
   ========================================================================== */

function getUtilLineStorageKey(floorCode) {
    const bId = (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? `_${currentBuildingId}` : '';
    return `lotte_util_lines_${floorCode}${bId}`;
}

function getFloorUtilityLines(floorCode) {
    try {
        const raw = mapStore.getItem(getUtilLineStorageKey(floorCode));
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('Failed to get utility lines', e);
        return [];
    }
}

function saveFloorUtilityLines(floorCode, lines) {
    try {
        mapStore.setItem(getUtilLineStorageKey(floorCode), JSON.stringify(lines));
    } catch (e) {
        console.error('Failed to save utility lines', e);
    }
}

function addUtilityLine(floorCode, lineData) {
    if (typeof pushUndoState === 'function') pushUndoState('설비 연결선 추가');
    const lines = getFloorUtilityLines(floorCode);
    lines.push(lineData);
    saveFloorUtilityLines(floorCode, lines);
    return lines;
}

function deleteUtilityLine(floorCode, lineId) {
    if (typeof pushUndoState === 'function') pushUndoState('설비 연결선 삭제');
    let lines = getFloorUtilityLines(floorCode);
    lines = lines.filter(l => l.id !== lineId);
    saveFloorUtilityLines(floorCode, lines);
    return lines;
}
