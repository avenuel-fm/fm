/* ==========================================================================
   symbolEditor.js - 도면 심벌(청정소화기, 분말소화기, 소화전, 공기호흡기) 관리 & CAD 엔진
   ========================================================================== */

var SYMBOL_DEFINITIONS = {
    clean_extinguisher: {
        id: 'clean_extinguisher',
        name: '청정소화기',
        color: '#94a3b8', // 연회색
        emoji: '🧯',
        diameter: 10,
        radius: 5
    },
    powder_extinguisher: {
        id: 'powder_extinguisher',
        name: '분말소화기',
        color: '#f97316', // 주황색
        emoji: '🧯',
        diameter: 10,
        radius: 5
    },
    fire_hydrant: {
        id: 'fire_hydrant',
        name: '소화전',
        color: '#1e293b', // 검은색
        emoji: '🚒',
        diameter: 10,
        radius: 5
    },
    air_respirator: {
        id: 'air_respirator',
        name: '공기호흡기',
        color: '#2563eb', // 파란색
        emoji: '🤿',
        diameter: 10,
        radius: 5
    }
};

var symbolFilterState = {
    clean_extinguisher: true,
    powder_extinguisher: true,
    fire_hydrant: true,
    air_respirator: true
};

var isSymbolMode = false;
var activeSymbolType = 'clean_extinguisher';
var tempSymbolPreviewNode = null;

// ================= 저장소(LocalStorage) 관리 =================
function getFloorSymbolsKey(floorCode) {
    const bId = (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? `_${currentBuildingId}` : '';
    return `lotte_symbols_${floorCode}${bId}`;
}

function loadFloorSymbols(floorCode) {
    try {
        const raw = mapStore.getItem(getFloorSymbolsKey(floorCode));
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

function saveFloorSymbols(floorCode, symbols) {
    try {
        mapStore.setItem(getFloorSymbolsKey(floorCode), JSON.stringify(symbols));
    } catch (e) {}
}

// ================= 심벌 SVG 렌더링 =================
function ensureSymbolsLayer(svgEl) {
    if (!svgEl) return null;
    let layer = svgEl.querySelector('#map-symbols-layer');
    if (!layer) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('id', 'map-symbols-layer');
    }
    // 도면 요소들 중 항상 최상단에 위치하도록 맨 뒤에 append
    svgEl.appendChild(layer);
    return layer;
}

function renderFloorSymbols() {
    const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    const layer = ensureSymbolsLayer(svgEl);
    if (!layer) return;

    layer.innerHTML = '';
    const floor = FLOORS[currentFloorIdx];
    if (!floor) return;

    const symbols = loadFloorSymbols(floor.code);
    symbols.forEach(sym => {
        const def = SYMBOL_DEFINITIONS[sym.type];
        if (!def) return;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'cad-symbol-node');
        g.setAttribute('data-id', sym.id);
        g.setAttribute('data-type', sym.type);
        g.setAttribute('transform', `translate(${sym.x}, ${sym.y})`);
        g.style.display = symbolFilterState[sym.type] ? 'inline' : 'none';

        // 지름 10px (반경 5px) 원형
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', def.color);
        circle.setAttribute('stroke', '#ffffff');
        circle.setAttribute('stroke-width', '1.2');
        g.appendChild(circle);

        // 중앙 이모티콘 텍스트
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('font-size', '6.5');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('y', '-0.2');
        text.textContent = def.emoji;
        g.appendChild(text);

        // 툴팁
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = `${def.name} (${sym.x.toFixed(0)}, ${sym.y.toFixed(0)}) - 클릭하여 삭제`;
        g.appendChild(title);

        // 클릭 이벤트 (심벌 모드일 때 클릭 시 삭제)
        g.onclick = (e) => {
            e.stopPropagation();
            if (isSymbolMode) {
                deleteSymbol(sym.id);
            } else {
                showToast(`${def.name} (${def.emoji})`, 1000);
            }
        };

        layer.appendChild(g);
    });
}

// ================= 심벌 필터 제어 =================
function toggleSymbolFilterDropdown() {
    const menu = document.getElementById('symbol-filter-dropdown-menu');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    closeAllDropdowns();
    menu.style.display = isOpen ? 'none' : 'block';
}

function closeSymbolFilterDropdown() {
    const menu = document.getElementById('symbol-filter-dropdown-menu');
    if (menu) menu.style.display = 'none';
}

function onSymbolCheckboxChange(type, isChecked) {
    symbolFilterState[type] = isChecked;
    const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    const nodes = svgEl.querySelectorAll(`.cad-symbol-node[data-type="${type}"]`);
    nodes.forEach(n => {
        n.style.display = isChecked ? 'inline' : 'none';
    });
}

// ================= 심벌 추가/편집 모드 =================
function startSymbolEditMode() {
    closeEditDropdown();
    if (typeof exitAddStoreMode === 'function') exitAddStoreMode();
    if (typeof exitAddZoneMode === 'function') exitAddZoneMode();
    if (typeof exitFreehandMode === 'function') exitFreehandMode();

    isSymbolMode = true;
    viewport.style.cursor = 'crosshair';

    // 심벌 레이어에 체크되어 있지 않아도 편집 화면에서는 즉시 모두 표시
    const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (svgEl) {
        const layer = ensureSymbolsLayer(svgEl);
        if (layer) layer.style.display = 'inline';
        svgEl.querySelectorAll('.cad-symbol-node').forEach(node => {
            node.style.display = 'inline';
        });
    }

    // 바닥 그리드 자동 표시
    if (typeof showFloorGrid === 'function') showFloorGrid();

    const banner = document.getElementById('symbol-guide-banner');
    if (banner) banner.style.display = 'flex';
    updateSymbolChipsUI();

    showToast('도면을 클릭하여 심벌을 배치하세요. (종료: ESC)', 1500);
}

function exitSymbolEditMode() {
    isSymbolMode = false;
    viewport.style.cursor = 'grab';

    if (tempSymbolPreviewNode) {
        tempSymbolPreviewNode.remove();
        tempSymbolPreviewNode = null;
    }

    const banner = document.getElementById('symbol-guide-banner');
    if (banner) banner.style.display = 'none';

    // 편집 완료 뒤에는 심벌 레이어 체크 상태에 맞게 화면 복원
    const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (svgEl) {
        svgEl.querySelectorAll('.cad-symbol-node').forEach(node => {
            const type = node.getAttribute('data-type');
            node.style.display = symbolFilterState[type] ? 'inline' : 'none';
        });
    }

    // 다른 편집 모드가 아니면 그리드 숨김
    if (!isDrawingMode && !isZoneDrawingMode) {
        if (typeof hideFloorGrid === 'function') hideFloorGrid();
    }
}

function setSymbolType(type) {
    if (SYMBOL_DEFINITIONS[type]) {
        activeSymbolType = type;
        updateSymbolChipsUI();
        showToast(`${SYMBOL_DEFINITIONS[type].name} 선택됨`, 1000);
    }
}

function updateSymbolChipsUI() {
    document.querySelectorAll('.symbol-type-chip').forEach(chip => {
        const type = chip.getAttribute('data-type');
        chip.classList.toggle('active', type === activeSymbolType);
    });
}

function updateSymbolPreview(svgX, svgY) {
    if (!isSymbolMode) return;
    const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    const layer = ensureSymbolsLayer(svgEl);
    if (!layer) return;

    let targetX = svgX;
    let targetY = svgY;
    if (typeof snapToGrid === 'function') {
        const gSnap = snapToGrid(svgX, svgY);
        if (gSnap.isSnapped) {
            targetX = gSnap.x;
            targetY = gSnap.y;
        }
    }

    if (!tempSymbolPreviewNode) {
        tempSymbolPreviewNode = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        tempSymbolPreviewNode.setAttribute('id', 'temp-symbol-preview');
        tempSymbolPreviewNode.style.pointerEvents = 'none';
        layer.appendChild(tempSymbolPreviewNode);
    }

    const def = SYMBOL_DEFINITIONS[activeSymbolType];
    tempSymbolPreviewNode.setAttribute('transform', `translate(${targetX}, ${targetY})`);
    tempSymbolPreviewNode.innerHTML = `
        <circle r="6" fill="${def.color}" opacity="0.4" stroke="${def.color}" stroke-width="1.5" stroke-dasharray="3 2"/>
        <circle r="5" fill="${def.color}" stroke="#ffffff" stroke-width="1.2"/>
        <text font-size="6.5" text-anchor="middle" dominant-baseline="central" y="-0.2">${def.emoji}</text>
    `;
}

function addSymbolAt(svgX, svgY) {
    const floor = FLOORS[currentFloorIdx];
    if (!floor) return;

    let targetX = svgX;
    let targetY = svgY;
    if (typeof snapToGrid === 'function') {
        const gSnap = snapToGrid(svgX, svgY);
        if (gSnap.isSnapped) {
            targetX = gSnap.x;
            targetY = gSnap.y;
        }
    }

    const symbols = loadFloorSymbols(floor.code);
    const def = SYMBOL_DEFINITIONS[activeSymbolType];
    const newSym = {
        id: `sym_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type: activeSymbolType,
        typeName: def.name,
        x: parseFloat(targetX.toFixed(2)),
        y: parseFloat(targetY.toFixed(2)),
        floorCode: floor.code,
        createdAt: new Date().toISOString()
    };

    if (typeof pushUndoState === 'function') {
        pushUndoState(`${def.name} 추가`);
    }

    symbols.push(newSym);
    saveFloorSymbols(floor.code, symbols);

    renderFloorSymbols();
    showToast(`${def.name} 배치 완료`, 1000);
}

function deleteSymbol(symId) {
    const floor = FLOORS[currentFloorIdx];
    if (!floor) return;

    const symbols = loadFloorSymbols(floor.code);
    const targetIdx = symbols.findIndex(s => s.id === symId);
    if (targetIdx === -1) return;

    const deletedSym = symbols[targetIdx];
    if (typeof pushUndoState === 'function') {
        pushUndoState(`${deletedSym.typeName || '항목'} 삭제`);
    }

    symbols.splice(targetIdx, 1);
    saveFloorSymbols(floor.code, symbols);

    renderFloorSymbols();
    showToast(`${deletedSym.typeName || '항목'} 삭제 완료`, 1000);
}
