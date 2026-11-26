/* ==========================================================================
   symbolEditor.js - 도면 심벌(청정소화기, 분말소화기, 소화전, 공기호흡기) 관리 & CAD 엔진
   ========================================================================== */

var SYMBOL_DEFINITIONS = {
    clean_extinguisher: {
        id: 'clean_extinguisher',
        name: '청정소화기',
        color: '#475569', // 진한 회색 (결정 292)
        kind: '소화기',
        icon: 'ext'
    },
    powder_extinguisher: {
        id: 'powder_extinguisher',
        name: '분말소화기',
        color: '#f97316', // 주황색
        kind: '소화기',
        icon: 'ext'
    },
    fire_hydrant: {
        id: 'fire_hydrant',
        name: '소화전',
        color: '#1e293b', // 검은색
        kind: '소화전',
        icon: 'hyd'
    },
    air_respirator: {
        id: 'air_respirator',
        name: '공기호흡기',
        color: '#2563eb', // 파란색
        kind: '공기호흡기',
        icon: 'tank'
    }
};

// 심벌 반지름: 옛 5 → 면적 7배 = 5 × √7 (결정 292)
var SYMBOL_R = 13.2;
// 흰 그림 (반지름 13.2 원 안, 가운데 0,0) — ext 소화기 · hyd 소화전 · tank 산소통(공기호흡기)
var SYMBOL_ICONS = {
    ext: '<rect x="-3.6" y="-4" width="7.2" height="11" rx="2" fill="#fff"/><rect x="-1.5" y="-7" width="3" height="3.4" fill="#fff"/><path d="M1.5 -6 L5 -7.5" stroke="#fff" stroke-width="1.4" fill="none"/>',
    hyd: '<rect x="-6.5" y="-5.5" width="13" height="11" rx="1.5" fill="none" stroke="#fff" stroke-width="1.8"/><circle r="2.8" fill="#fff"/>',
    tank: '<rect x="-3.8" y="-4.5" width="7.6" height="12.5" rx="3.8" fill="#fff"/><rect x="-1.4" y="-7.5" width="2.8" height="3.4" fill="#fff"/><rect x="-3.4" y="-9.2" width="6.8" height="1.8" rx="0.9" fill="#fff"/>'
};
function symbolSvgInner(def, r) {
    const k = r / SYMBOL_R;
    return `<circle r="${r}" fill="${def.color}" stroke="#ffffff" stroke-width="${(2 * k).toFixed(2)}"/><g transform="scale(${k.toFixed(3)})">${SYMBOL_ICONS[def.icon]}</g>`;
}

// ================= 이름 규칙 (점검 QR과 같음, 결정 292) =================
// 「위치-소화기1」·「위치-소화전1」·「위치-공기호흡기1」 — 청정·분말은 둘 다 「소화기」. 번호는 같은 위치·같은 종류 안에서 이어서
// shortcut: 번호는 이 층 지도 안에서만 셈 (점검 QR 은 모든 층의 같은 위치를 셈), 같은 위치 이름을 여러 층에 쓰게 되면 그때 맞출 것
function symbolNameOf(place, kind, no) { return `${place}-${kind}${no}`; }
function nextSymbolNo(symbols, place, kind, exceptId) {
    let max = 0;
    symbols.forEach(s => {
        const d = SYMBOL_DEFINITIONS[s.type];
        if (s.id !== exceptId && d && d.kind === kind && s.place === place) max = Math.max(max, s.no || 0);
    });
    return max + 1;
}
// 찍은 자리의 매장 이름 → 없으면 구역(바닥·지우개 제외) 이름 → 없으면 층 이름
function suggestSymbolPlace(x, y) {
    const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    const pt = { x, y };
    if (svgEl && typeof rtPathPoints === 'function') {
        for (const p of svgEl.querySelectorAll('.store-polygon')) {
            const g = p.closest('[data-store-name]');
            const name = g && g.getAttribute('data-store-name');
            if (name && isPointInsidePolygon(pt, rtPathPoints(p))) return name;
        }
    }
    const floor = FLOORS[currentFloorIdx];
    if (typeof getFloorZones === 'function') {
        const z = (getFloorZones(floor.code) || []).find(z => z.category !== 'floor' && z.category !== 'erase' && z.name && z.points && z.points.length >= 3 && isPointInsidePolygon(pt, z.points));
        if (z) return z.name;
    }
    return floor.name || floor.code;
}
// 이름 없는 옛 심벌: 찍은 순서대로 이름을 붙임 (고칠 수 있는 사람이 열면 저장)
function ensureSymbolNames(floorCode, symbols) {
    let changed = false;
    symbols.slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))).forEach(s => {
        const d = SYMBOL_DEFINITIONS[s.type];
        if (!d || s.name) return;
        s.place = s.place || suggestSymbolPlace(s.x, s.y);
        s.no = nextSymbolNo(symbols, s.place, d.kind, s.id);
        s.name = symbolNameOf(s.place, d.kind, s.no);
        changed = true;
    });
    if (changed && !(mapStore.readOnly && mapStore.readOnly())) saveFloorSymbols(floorCode, symbols);
    return symbols;
}

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

function escSymbolText(t) { return String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function showSymbolBubble(text, cx, cy) {
    let b = document.getElementById('symbol-name-bubble');
    if (!b) {
        b = document.createElement('div');
        b.id = 'symbol-name-bubble';
        b.className = 'symbol-name-bubble';
        document.body.appendChild(b);
    }
    b.textContent = text;
    b.style.left = cx + 'px';
    b.style.top = (cy - 14) + 'px';
    b.style.display = 'block';
    clearTimeout(b._t);
    b._t = setTimeout(() => { b.style.display = 'none'; }, 3000);
}

function renderFloorSymbols() {
    const svgEl = mapContainer ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    const layer = ensureSymbolsLayer(svgEl);
    if (!layer) return;

    layer.innerHTML = '';
    const floor = FLOORS[currentFloorIdx];
    if (!floor) return;

    const symbols = ensureSymbolNames(floor.code, loadFloorSymbols(floor.code));
    symbols.forEach(sym => {
        const def = SYMBOL_DEFINITIONS[sym.type];
        if (!def) return;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'cad-symbol-node');
        g.setAttribute('data-id', sym.id);
        g.setAttribute('data-type', sym.type);
        g.setAttribute('transform', `translate(${sym.x}, ${sym.y})`);
        g.style.display = symbolFilterState[sym.type] ? 'inline' : 'none';

        g.innerHTML = symbolSvgInner(def, SYMBOL_R) +
            `<text class="cad-symbol-label" x="${SYMBOL_R + 3}" y="0" dominant-baseline="central" font-size="10" fill="#0f172a" stroke="#ffffff" stroke-width="3" paint-order="stroke">${escSymbolText(sym.name || def.name)}</text>`;

        // 편집 중: 눌러서 위치 고치기·삭제 / 평소: 이름 말풍선
        g.onclick = (e) => {
            e.stopPropagation();
            if (isSymbolMode) openSymbolDialog(sym);
            else showSymbolBubble(sym.name || def.name, e.clientX, e.clientY);
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

    document.body.classList.add('symbol-mode');
    showToast('도면을 클릭하여 심벌을 배치하세요. (종료: ESC)', 1500);
}

function exitSymbolEditMode() {
    isSymbolMode = false;
    viewport.style.cursor = 'grab';
    closeSymbolDialog();
    document.body.classList.remove('symbol-mode');

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
    tempSymbolPreviewNode.innerHTML = `<circle r="${SYMBOL_R + 3}" fill="${def.color}" opacity="0.3" stroke="${def.color}" stroke-width="1.5" stroke-dasharray="3 2"/>` + symbolSvgInner(def, SYMBOL_R);
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
    openSymbolDialog(null, parseFloat(targetX.toFixed(2)), parseFloat(targetY.toFixed(2)));
}

// 위치 창: sym 이 없으면 새로 배치, 있으면 위치 고치기·삭제 (결정 292)
function openSymbolDialog(sym, x, y) {
    closeSymbolDialog();
    const floor = FLOORS[currentFloorIdx];
    const type = sym ? sym.type : activeSymbolType;
    const def = SYMBOL_DEFINITIONS[type];
    const box = document.createElement('div');
    box.id = 'symbol-place-dialog';
    box.className = 'symbol-place-dialog';
    box.innerHTML = `<div class="spd-title">${def.name} 위치 · ${escSymbolText(floor.name || floor.code)}</div>
        <input id="symbol-place-input" type="text" maxlength="30" autocomplete="off" aria-label="위치">
        <div class="spd-hint">찍은 자리의 매장·구역 이름을 미리 넣었습니다. 점검 QR에 적은 위치와 같게 적어 주세요.</div>
        <div class="spd-name">이름: <b id="symbol-name-preview"></b></div>
        <div class="spd-btns">
            <button type="button" class="spd-ok" id="symbol-place-ok">${sym ? '저장' : '배치'}</button>
            ${sym ? '<button type="button" class="spd-del" id="symbol-place-del">삭제</button>' : ''}
            <button type="button" id="symbol-place-cancel">취소</button>
        </div>`;
    document.body.appendChild(box);
    const input = box.querySelector('#symbol-place-input');
    input.value = sym ? (sym.place || '') : suggestSymbolPlace(x, y);
    const preview = () => {
        const place = input.value.trim();
        const no = (sym && place === sym.place) ? sym.no : nextSymbolNo(loadFloorSymbols(floor.code), place, def.kind, sym && sym.id);
        box.querySelector('#symbol-name-preview').textContent = place ? symbolNameOf(place, def.kind, no) : '(위치를 적어 주세요)';
    };
    const ok = () => {
        const place = input.value.trim();
        if (!place) { input.focus(); showToast('위치를 적어 주세요. (예: 동측 계단 앞)', 1500); return; }
        closeSymbolDialog();
        if (sym) renameSymbol(sym.id, place); else saveNewSymbol(type, x, y, place);
    };
    input.addEventListener('input', preview);
    input.addEventListener('keydown', e => {
        e.stopPropagation();   // 지도 단축키(ESC 로 배치 끝내기 등)가 먼저 돌지 않게
        if (e.key === 'Enter') ok();
        else if (e.key === 'Escape') closeSymbolDialog();
    });
    box.querySelector('#symbol-place-ok').onclick = ok;
    box.querySelector('#symbol-place-cancel').onclick = closeSymbolDialog;
    if (sym) box.querySelector('#symbol-place-del').onclick = () => { closeSymbolDialog(); deleteSymbol(sym.id); };
    preview();
    input.focus();
    input.select();
}

function closeSymbolDialog() {
    const box = document.getElementById('symbol-place-dialog');
    if (box) box.remove();
}

function saveNewSymbol(type, x, y, place) {
    const floor = FLOORS[currentFloorIdx];
    const symbols = loadFloorSymbols(floor.code);
    const def = SYMBOL_DEFINITIONS[type];
    const no = nextSymbolNo(symbols, place, def.kind);
    const newSym = {
        id: `sym_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        type,
        typeName: def.name,
        place,
        no,
        name: symbolNameOf(place, def.kind, no),
        x,
        y,
        floorCode: floor.code,
        createdAt: new Date().toISOString()
    };

    if (typeof pushUndoState === 'function') {
        pushUndoState(`${def.name} 추가`);
    }

    symbols.push(newSym);
    saveFloorSymbols(floor.code, symbols);

    renderFloorSymbols();
    showToast(`${newSym.name} 배치 완료`, 1200);
}

function renameSymbol(symId, place) {
    const floor = FLOORS[currentFloorIdx];
    const symbols = loadFloorSymbols(floor.code);
    const sym = symbols.find(s => s.id === symId);
    if (!sym || sym.place === place) return;
    const def = SYMBOL_DEFINITIONS[sym.type];
    if (typeof pushUndoState === 'function') pushUndoState(`${sym.name || def.name} 위치 고침`);
    sym.place = place;
    sym.no = nextSymbolNo(symbols, place, def.kind, sym.id);
    sym.name = symbolNameOf(place, def.kind, sym.no);
    saveFloorSymbols(floor.code, symbols);
    renderFloorSymbols();
    showToast(`${sym.name}(으)로 바꿈`, 1200);
}

function deleteSymbol(symId) {
    const floor = FLOORS[currentFloorIdx];
    if (!floor) return;

    const symbols = loadFloorSymbols(floor.code);
    const targetIdx = symbols.findIndex(s => s.id === symId);
    if (targetIdx === -1) return;

    const deletedSym = symbols[targetIdx];
    if (typeof pushUndoState === 'function') {
        pushUndoState(`${deletedSym.name || deletedSym.typeName || '항목'} 삭제`);
    }

    symbols.splice(targetIdx, 1);
    saveFloorSymbols(floor.code, symbols);

    renderFloorSymbols();
    showToast(`${deletedSym.name || deletedSym.typeName || '항목'} 삭제 완료`, 1000);
}
