/* ==========================================================================
   utilityLineEditor.js - 매장(자) ← 기능실(모) 설비 배관/간선(전기, 수도, 가스, 배수). 선은 길찾기로 자동 (결정 246)
   ========================================================================== */

var isUtilLineDrawingMode = false;
var utilLineSourceStore = null;    // 자 = 매장 (결정 246. 예전에는 기능실이 자)
var utilLineTargetStore = null;    // 모 = 기능실. 흐름은 모 → 자
var utilLineSelectedType = 'power';// 'power'(전기) | 'water'(수도) | 'gas'(가스) | 'drain'(배수)
var utilLineInputValue = '50';     // 입력 규격 (전기: A, 수도: mm, 배수: mm, 가스: 비활성)
var utilLineDrawingPoints = [];    // 선분 점 목록 [{x, y}, ...]
var activeHighlightedStore = null;   // 현재 라인 하이라이트 중인 매장/기능실
var activeSelectedUtilLineId = null;// 현재 선택된 설비 선분 ID (삭제용)

// 상단 레이어 필터 상태 (전기, 수도, 가스, 배수 개별 표시 제어)
var utilLineFilterState = {
    power: true, // 전기
    water: true, // 수도
    gas: true,   // 가스
    drain: true  // 배수
};

// 설비 4종 스펙 정의 (라디오버튼 연동)
var UTIL_SPECS_CONFIG = {
    power: {
        id: 'power',
        label: '전기',
        color: '#2563eb', // 파란색
        className: 'util-line-eps',
        direction: 'forward', // 모 -> 자 (점 순서가 기능실 → 매장)
        unit: 'A',
        defaultVal: '50',
        disabledInput: false,
        placeholder: '00 A'
    },
    water: {
        id: 'water',
        label: '수도',
        color: '#0284c7', // 파란색/하늘색
        className: 'util-line-water',
        direction: 'forward', // 모 -> 자 (점 순서가 기능실 → 매장)
        unit: 'mm',
        defaultVal: '25',
        disabledInput: false,
        placeholder: '00 mm'
    },
    gas: {
        id: 'gas',
        label: '가스',
        color: '#eab308', // 노란색
        className: 'util-line-gas',
        direction: 'forward', // 모 -> 자 (점 순서가 기능실 → 매장)
        unit: '',
        defaultVal: '',
        disabledInput: true, // 입력칸 비활성화
        placeholder: '입력없음'
    },
    drain: {
        id: 'drain',
        label: '배수',
        color: '#0f172a', // 검은색
        className: 'util-line-drain',
        direction: 'forward', // 모 -> 자
        unit: 'mm',
        defaultVal: '50',
        disabledInput: false,
        placeholder: '00 mm'
    }
};

// 현재 층에 등록된 기능실(utility) 존재 여부 체크
function hasAnyUtilityStores() {
    if (typeof currentStores === 'undefined' || !currentStores) return false;
    return currentStores.some(s => s.type === 'utility');
}

// 레이어 필터 체크박스 제어
function onUtilLineCheckboxChange(type, isChecked) {
    if (type in utilLineFilterState) {
        utilLineFilterState[type] = isChecked;
    }
    renderFloorUtilityLines();
}

// SVG 레이어 확보
function ensureUtilityLinesLayer(svgEl) {
    if (!svgEl) return null;
    let layer = svgEl.querySelector('#utility-lines-layer');
    if (!layer) {
        layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        layer.setAttribute('id', 'utility-lines-layer');
        const symbolsLayer = svgEl.querySelector('#map-symbols-layer');
        if (symbolsLayer) {
            svgEl.insertBefore(layer, symbolsLayer);
        } else {
            svgEl.appendChild(layer);
        }
    }
    return layer;
}

// 중간 지점 계산 (라벨 배치용)
function getMidPointOfPoints(points) {
    if (!points || points.length < 2) return null;
    const midIdx = Math.floor(points.length / 2);
    const p1 = points[midIdx - 1];
    const p2 = points[midIdx];
    return {
        x: Math.round((p1.x + p2.x) / 2),
        y: Math.round((p1.y + p2.y) / 2)
    };
}

// ================= 도면 위 라인 및 스펙 라벨 렌더링 =================
function renderFloorUtilityLines() {
    const svgEl = mapContainer?.querySelector('svg');
    if (!svgEl || !FLOORS[currentFloorIdx]) return;
    const layer = ensureUtilityLinesLayer(svgEl);
    if (!layer) return;

    layer.innerHTML = '';
    const floor = FLOORS[currentFloorIdx];
    const lines = getFloorUtilityLines(floor.code);

    lines.forEach(line => {
        if (!line.points || line.points.length < 2) return;

        // 레이어 필터 가시성 확인
        const sub = line.subType || 'power';
        if (sub in utilLineFilterState && !utilLineFilterState[sub]) return;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'util-line-item-group');
        g.setAttribute('data-id', line.id);

        // 1. 선분(Polyline)
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const ptsStr = line.points.map(p => `${p.x},${p.y}`).join(' ');
        polyline.setAttribute('points', ptsStr);
        polyline.setAttribute('class', `util-feeder-line ${line.className || 'util-line-eps'}`);
        polyline.setAttribute('data-id', line.id);
        polyline.setAttribute('data-source-id', line.sourceStoreId || '');
        polyline.setAttribute('data-target-id', line.targetStoreId || '');
        polyline.setAttribute('data-source-name', line.sourceName || '');
        polyline.setAttribute('data-target-name', line.targetName || '');
        polyline.setAttribute('data-sub-type', line.subType || '');

        // 선분 선택 상태인 경우 (삭제 대기)
        const isSelected = (activeSelectedUtilLineId === line.id);
        if (isSelected) {
            // 'important' 필수: .util-line-* 클래스가 stroke에 !important를 사용
            polyline.style.setProperty('stroke', '#ef4444', 'important');
            polyline.style.setProperty('stroke-width', '5px', 'important');
            polyline.style.strokeDasharray = '4 4';
        }

        // 2. 스펙 라벨(Badge)
        const midPt = getMidPointOfPoints(line.points);
        let labelGroup = null;
        if (midPt) {
            labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            labelGroup.setAttribute('class', 'util-spec-badge-group');
            labelGroup.style.cursor = 'pointer';

            const specStr = line.specText ? `${line.subTypeLabel || ''} (${line.specText})` : (line.subTypeLabel || '설비');
            const approxWidth = Math.max(specStr.length * 9 + 16, 54);

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', midPt.x - approxWidth / 2);
            rect.setAttribute('y', midPt.y - 11);
            rect.setAttribute('width', approxWidth);
            rect.setAttribute('height', 22);
            rect.setAttribute('rx', 5);
            rect.setAttribute('fill', isSelected ? '#ef4444' : 'rgba(15, 23, 42, 0.9)');
            rect.setAttribute('stroke', isSelected ? '#ffffff' : (line.color || '#2563eb'));
            rect.setAttribute('stroke-width', '1.5');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', midPt.x);
            text.setAttribute('y', midPt.y + 4);
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('font-size', '11');
            text.setAttribute('font-weight', '700');
            text.setAttribute('text-anchor', 'middle');
            text.textContent = specStr;

            labelGroup.appendChild(rect);
            labelGroup.appendChild(text);
        }

        // 활성/하이라이트 상태 동기화
        if (activeHighlightedStore) {
            const isRelated = (line.targetStoreId && line.targetStoreId === activeHighlightedStore.id) ||
                              (line.targetName && line.targetName === activeHighlightedStore.name) ||
                              (line.sourceStoreId && line.sourceStoreId === activeHighlightedStore.id) ||
                              (line.sourceName && line.sourceName === activeHighlightedStore.name);
            if (isRelated) {
                polyline.classList.add('highlighted');
                polyline.style.opacity = '1';
                if (labelGroup) labelGroup.style.display = 'block';
            } else {
                polyline.classList.add('inactive');
                polyline.style.opacity = '0.12';
                if (labelGroup) labelGroup.style.display = 'none';
            }
        } else {
            polyline.style.opacity = isSelected ? '1' : '0.4';
            if (labelGroup) labelGroup.style.display = isSelected ? 'block' : 'none';
        }

        // 선분 클릭 시 -> 선분 선택 및 삭제 확인 모달/토스트
        const clickHandler = (e) => {
            e.stopPropagation();
            selectUtilLineForDelete(line);
        };

        polyline.addEventListener('click', clickHandler);
        if (labelGroup) labelGroup.addEventListener('click', clickHandler);

        // 마우스 호버 시 라벨 노출
        polyline.addEventListener('mouseenter', () => {
            if (labelGroup) labelGroup.style.display = 'block';
        });
        polyline.addEventListener('mouseleave', () => {
            if (labelGroup && (!activeHighlightedStore || !polyline.classList.contains('highlighted')) && activeSelectedUtilLineId !== line.id) {
                labelGroup.style.display = 'none';
            }
        });

        g.appendChild(polyline);
        if (labelGroup) g.appendChild(labelGroup);
        layer.appendChild(g);
    });
}

// ================= 선분 선택 및 삭제 기능 =================
function selectUtilLineForDelete(line) {
    activeSelectedUtilLineId = line.id;
    renderFloorUtilityLines();
    if (mapStore.readOnly()) return;   // 보기 전용: 선택(라벨 보기)만

    const specDesc = line.specText ? ` (${line.specText})` : '';
    const confirmMsg = `[설비 연결선 선택]\n매장(자): ${line.sourceName || '매장'}\n기능실(모): ${line.targetName || '기능실'}\n구분: ${line.subTypeLabel || ''}${specDesc}\n\n이 연결선을 삭제하시겠습니까?`;

    if (confirm(confirmMsg)) {
        const floor = FLOORS[currentFloorIdx];
        deleteUtilityLine(floor.code, line.id);
        activeSelectedUtilLineId = null;
        renderFloorUtilityLines();
        showToast('🗑️ 설비 연결선이 삭제되었습니다.', 1500);
    } else {
        showToast('선택된 연결선: Delete 키로 지우기 · Esc 로 선택 풀기', 2000);   // 선택은 그대로 둠 (Delete 키 삭제, WS_지도 결정 134)
    }
}

// 키보드 Delete 키로 선택된 설비 선분 삭제 지원
window.addEventListener('keydown', (e) => {
    if (!activeSelectedUtilLineId || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') { activeSelectedUtilLineId = null; renderFloorUtilityLines(); return; }
    if (e.key === 'Delete' && !mapStore.readOnly()) {
        const floor = FLOORS[currentFloorIdx];
        deleteUtilityLine(floor.code, activeSelectedUtilLineId);
        activeSelectedUtilLineId = null;
        renderFloorUtilityLines();
        showToast('🗑️ 설비 연결선이 삭제되었습니다.', 1500);
    }
});

// ================= 매장(모) 또는 기능실(자) 클릭 시 연동 =================
function highlightUtilityLinesForStore(store) {
    activeHighlightedStore = store;
    const svgEl = mapContainer?.querySelector('svg');
    if (!svgEl) return;
    const layer = ensureUtilityLinesLayer(svgEl);
    if (!layer) return;

    const allGroups = layer.querySelectorAll('.util-line-item-group');
    if (!store) {
        allGroups.forEach(g => {
            const line = g.querySelector('.util-feeder-line');
            const badge = g.querySelector('.util-spec-badge-group');
            if (line) {
                line.classList.remove('highlighted', 'inactive');
                line.style.opacity = '0.4';
            }
            if (badge) badge.style.display = 'none';
        });
        return;
    }

    let connectedCount = 0;
    allGroups.forEach(g => {
        const line = g.querySelector('.util-feeder-line');
        const badge = g.querySelector('.util-spec-badge-group');
        if (!line) return;

        const targetId = line.getAttribute('data-target-id');
        const targetName = line.getAttribute('data-target-name');
        const sourceId = line.getAttribute('data-source-id');
        const sourceName = line.getAttribute('data-source-name');

        const isMatch = (targetId && targetId === store.id) ||
                        (targetName && targetName === store.name) ||
                        (sourceId && sourceId === store.id) ||
                        (sourceName && sourceName === store.name);

        if (isMatch) {
            line.classList.add('highlighted');
            line.classList.remove('inactive');
            line.style.opacity = '1';
            line.style.display = 'block';
            if (badge) badge.style.display = 'block';
            connectedCount++;
        } else {
            line.classList.remove('highlighted');
            line.classList.add('inactive');
            line.style.opacity = '0.08';
            if (badge) badge.style.display = 'none';
        }
    });

    if (connectedCount > 0) {
        showToast(`🔗 연결된 설비 라인 ${connectedCount}개가 표시됩니다.`, 1200);
    }
}

function clearUtilityLineHighlight() {
    activeHighlightedStore = null;
    const svgEl = mapContainer?.querySelector('svg');
    if (!svgEl) return;
    const layer = svgEl.querySelector('#utility-lines-layer');
    if (!layer) return;
    layer.querySelectorAll('.util-line-item-group').forEach(g => {
        const line = g.querySelector('.util-feeder-line');
        const badge = g.querySelector('.util-spec-badge-group');
        if (line) {
            line.classList.remove('highlighted', 'inactive');
            line.style.opacity = '0.4';
        }
        if (badge) badge.style.display = 'none';
    });
}

// ================= 설비 라인 드로잉 모드 시작/종료 =================
function startUtilityLineDrawingMode(preStore = null) {
    // 1. 기능실 등록 여부 사전 가드 체크
    if (!hasAnyUtilityStores()) {
        showToast('⚠️ 도면에 등록된 기능실이 없습니다. [매장 추가/편집]에서 기능실을 먼저 등록해주세요.', 3000);
        return;
    }
    isUtilLineDrawingMode = true;
    utilLineDrawingPoints = [];
    utilLineSourceStore = null;
    utilLineTargetStore = null;
    purgeLegacyUtilityLines();
    showUtilLineGuideBanner();
    if (preStore) { handleUtilLineMapClick(null, preStore); return; }   // 기능실 창의 「매장 연결선」에서 온 경우
    showToast('매장(자)과 기능실(모)을 차례로 누르면 선이 길을 따라 자동으로 그려집니다.', 2500);
}

// 예전 방식(손으로 꺾어 그린) 배관은 길찾기 방식으로 바뀌며 지움 (결정 246). 자동으로 그린 선은 auto 표시가 있음
function purgeLegacyUtilityLines() {
    if (mapStore.readOnly()) return;
    let total = 0;
    FLOORS.forEach(f => { total += getFloorUtilityLines(f.code).filter(l => !l.auto).length; });
    if (!total) return;
    if (!confirm('예전 방식으로 그린 배관 ' + total + '개가 있습니다.\n배관 연결이 길 따라 자동으로 그리는 방식으로 바뀌어서 이 선들을 지웁니다. (기록에서 「이 날로 되돌리기」로 되살릴 수 있습니다)\n\n지울까요?')) return;
    if (typeof pushUndoState === 'function') pushUndoState('예전 배관 지움');
    FLOORS.forEach(f => {
        const all = getFloorUtilityLines(f.code), keep = all.filter(l => l.auto);
        if (keep.length !== all.length) saveFloorUtilityLines(f.code, keep);
    });
    activeSelectedUtilLineId = null;
    renderFloorUtilityLines();
    showToast('예전 배관 ' + total + '개를 지웠습니다.', 2000);
}
function exitUtilityLineDrawingMode() {
    isUtilLineDrawingMode = false;
    utilLineDrawingPoints = [];
    utilLineSourceStore = null;
    utilLineTargetStore = null;
    activeSelectedUtilLineId = null;
    hideUtilLineGuideBanner();
    removeTempDrawingLine();
    renderFloorUtilityLines();
}

function getStoreCenter(store) {
    if (!store) return null;
    if (store.points && store.points.length > 0) {
        const sumX = store.points.reduce((acc, p) => acc + p.x, 0);
        const sumY = store.points.reduce((acc, p) => acc + p.y, 0);
        return { x: Math.round(sumX / store.points.length), y: Math.round(sumY / store.points.length) };
    }
    if (store.polygonElement) {
        try {
            const bbox = store.polygonElement.getBBox();
            return { x: Math.round(bbox.x + bbox.width / 2), y: Math.round(bbox.y + bbox.height / 2) };
        } catch (e) {}
    }
    return null;
}

// 실시간 프리뷰 선 렌더링 (선택한 설비 색상 및 직각 스냅 적용)
function updateTempDrawingLine(mousePt = null) {
    const svgEl = mapContainer?.querySelector('svg');
    if (!svgEl) return;
    let tempPoly = svgEl.querySelector('#temp-util-drawing-polyline');
    if (!tempPoly) {
        tempPoly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        tempPoly.setAttribute('id', 'temp-util-drawing-polyline');
        tempPoly.setAttribute('fill', 'none');
        tempPoly.setAttribute('stroke-width', '3');
        tempPoly.setAttribute('stroke-dasharray', '8 6');
        svgEl.appendChild(tempPoly);
    }

    const cfg = UTIL_SPECS_CONFIG[utilLineSelectedType] || UTIL_SPECS_CONFIG.power;
    tempPoly.setAttribute('stroke', cfg.color);

    const pts = [...utilLineDrawingPoints];
    if (mousePt && pts.length > 0) {
        const lastPt = pts[pts.length - 1];
        const snappedPt = typeof snapToOrtho === 'function' ? snapToOrtho(mousePt, lastPt) : mousePt;
        pts.push(snappedPt);
    } else if (mousePt) {
        pts.push(mousePt);
    }

    if (pts.length >= 2) {
        tempPoly.setAttribute('points', pts.map(p => `${p.x},${p.y}`).join(' '));
        tempPoly.style.display = 'block';
    } else {
        tempPoly.style.display = 'none';
    }
}

function removeTempDrawingLine() {
    const tempPoly = document.getElementById('temp-util-drawing-polyline');
    if (tempPoly) tempPoly.remove();
}

// 매장(자)·기능실(모)을 누르면 둘이 모였을 때 길찾기로 선을 그림. 누르는 순서는 상관없음
function handleUtilLineMapClick(svgPt, targetStore = null) {
    if (!isUtilLineDrawingMode) return false;
    if (!targetStore) { showToast('도면의 매장 또는 기능실을 눌러 주세요.', 1500); return true; }
    if (targetStore.type === 'utility') {
        utilLineTargetStore = targetStore;
        const nm = (targetStore.name || '').toUpperCase();   // 기능실 이름으로 종류 자동
        if (nm.includes('EPS')) setUtilLineType('power');
        else if (nm.includes('PS')) setUtilLineType('water');
        else if (nm.includes('PD')) setUtilLineType('drain');
        else if (nm.includes('가스')) setUtilLineType('gas');
    } else {
        utilLineSourceStore = targetStore;
    }
    updateUtilLineGuideUI();
    if (utilLineSourceStore && utilLineTargetStore) { finishUtilityLine(); return true; }
    showToast(utilLineTargetStore ? '이제 연결할 매장(자)을 눌러 주세요.' : '이제 연결할 기능실(모)을 눌러 주세요.', 1800);
    return true;
}

function finishUtilityLine() {
    if (!utilLineSourceStore || !utilLineTargetStore) { showToast('매장(자)과 기능실(모)을 모두 눌러 주세요.', 1500); return; }
    const res = routeBetweenStores(utilLineTargetStore, utilLineSourceStore);   // 기능실 → 매장 순서의 점
    if (!res.ok) {
        showToast(res.error, 2800);
        utilLineTargetStore = null; utilLineSourceStore = null;   // 선은 안 그리고 처음부터 다시 고르게
        updateUtilLineGuideUI();
        return;
    }
    const floor = FLOORS[currentFloorIdx];
    const cfg = UTIL_SPECS_CONFIG[utilLineSelectedType] || UTIL_SPECS_CONFIG.power;
    let specText = '';
    if (!cfg.disabledInput) {
        const rawVal = document.getElementById('input-util-spec-val')?.value?.trim() || utilLineInputValue || cfg.defaultVal;
        specText = rawVal ? `${rawVal}${cfg.unit}` : '';
    } else {
        specText = '가스배관';
    }
    const newLine = {
        id: `util-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        auto: true,
        sourceType: utilLineSourceStore.name || '매장',
        subType: cfg.id, subTypeLabel: cfg.label, specText, className: cfg.className, color: cfg.color,
        direction: 'forward',
        sourceStoreId: utilLineSourceStore.id || '', sourceName: utilLineSourceStore.name || '매장',
        targetStoreId: utilLineTargetStore.id || '', targetName: utilLineTargetStore.name || '기능실',
        points: res.points
    };
    addUtilityLine(floor.code, newLine);
    showToast(`✅ 기능실[${newLine.targetName}] ➔ 매장[${newLine.sourceName}] ${newLine.subTypeLabel} 연결 완료!`, 2000);
    const finalStore = utilLineSourceStore;
    exitUtilityLineDrawingMode();
    highlightUtilityLinesForStore(finalStore);
}

// ================= UI 가이드 배너 및 라디오 버튼 4종 =================
function showUtilLineGuideBanner() {
    let banner = document.getElementById('util-line-guide-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'util-line-guide-banner';
        banner.className = 'drawing-guide-banner';
        banner.style.borderLeftColor = '#2563eb';
        document.getElementById('viewport')?.appendChild(banner);
    }
    updateUtilLineGuideUI();
    banner.style.display = 'flex';
}

function hideUtilLineGuideBanner() {
    const banner = document.getElementById('util-line-guide-banner');
    if (banner) banner.style.display = 'none';
}

function setUtilLineType(typeId) {
    if (!(typeId in UTIL_SPECS_CONFIG)) return;
    utilLineSelectedType = typeId;
    const cfg = UTIL_SPECS_CONFIG[typeId];
    utilLineInputValue = cfg.defaultVal;
    updateUtilLineGuideUI();
    updateTempDrawingLine();
}

function updateUtilLineGuideUI() {
    const banner = document.getElementById('util-line-guide-banner');
    if (!banner) return;

    const cfg = UTIL_SPECS_CONFIG[utilLineSelectedType] || UTIL_SPECS_CONFIG.power;
    const srcText = utilLineSourceStore ? utilLineSourceStore.name : '선택 중...';
    const tgtText = utilLineTargetStore ? utilLineTargetStore.name : '선택 중...';
    const isOrtho = (typeof isGlobalOrthoMode !== 'undefined' && isGlobalOrthoMode);

    // 라디오 버튼 4종 생성
    const radioList = ['power', 'water', 'gas', 'drain'].map(k => {
        const item = UTIL_SPECS_CONFIG[k];
        const isChecked = (utilLineSelectedType === k);
        return `
            <label style="display:inline-flex; align-items:center; gap:4px; font-size:12px; font-weight:700; cursor:pointer; padding:3px 7px; border-radius:5px; background:${isChecked ? '#e2e8f0' : 'transparent'};">
                <input type="radio" name="util-type-radio" value="${item.id}" ${isChecked ? 'checked' : ''} onchange="setUtilLineType('${item.id}')" style="cursor:pointer;">
                <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${item.color}; border:1px solid rgba(0,0,0,0.2);"></span>
                <span style="color:${isChecked ? '#0f172a' : '#475569'};">${item.label}</span>
            </label>
        `;
    }).join('');

    // 규격 입력 필드
    let inputFieldHtml = '';
    if (cfg.disabledInput) {
        inputFieldHtml = `
            <span style="font-size:11px; color:#94a3b8; font-weight:600; padding:4px 8px; background:#f1f5f9; border-radius:4px; border:1px dashed #cbd5e1;">(가스: 규격입력 비활성)</span>
        `;
    } else {
        inputFieldHtml = `
            <div style="display:inline-flex; align-items:center; gap:2px; background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; padding:2px 6px;">
                <input type="number" id="input-util-spec-val" value="${utilLineInputValue}" placeholder="00" min="1" max="999" 
                       style="width:48px; border:none; font-size:13px; font-weight:700; outline:none; text-align:right;"
                       oninput="utilLineInputValue = this.value">
                <span style="font-size:12px; font-weight:700; color:#475569;">${cfg.unit}</span>
            </div>
        `;
    }

    banner.innerHTML = `
        <div class="guide-content" style="gap:12px; flex-wrap:wrap; align-items:center;">
            <!-- 자 -> 모 표시 및 점선 이동 연출 -->
            <div style="display:flex; align-items:center; gap:6px; font-weight:700; font-size:13px; color:#0f172a;">
                <span>설비연결:</span>
                <span style="padding:2px 8px; border-radius:4px; background:${utilLineTargetStore ? '#eff6ff' : '#f1f5f9'}; color:${utilLineTargetStore ? '#2563eb' : '#64748b'}; border:1px solid ${utilLineTargetStore ? '#bfdbfe' : '#e2e8f0'};">
                    모 기능실[${tgtText}]
                </span>
                <!-- 점선 흐름 연출 인디케이터 -->
                <div style="display:inline-flex; align-items:center; gap:2px; padding:0 4px; overflow:hidden;">
                    <div style="width:24px; height:3px; background:${cfg.color}; border-radius:2px; position:relative; overflow:hidden;">
                        <div style="width:100%; height:100%; background:repeating-linear-gradient(90deg, ${cfg.color}, ${cfg.color} 4px, transparent 4px, transparent 8px); animation:utilFlowForward 0.8s linear infinite;"></div>
                    </div>
                    <span style="color:${cfg.color}; font-size:12px; font-weight:900;">➔</span>
                </div>
                <span style="padding:2px 8px; border-radius:4px; background:${utilLineSourceStore ? '#eff6ff' : '#f1f5f9'}; color:${utilLineSourceStore ? '#2563eb' : '#64748b'}; border:1px solid ${utilLineSourceStore ? '#bfdbfe' : '#e2e8f0'};">
                    자 매장[${srcText}]
                </span>
            </div>

            <!-- 라디오 버튼 그룹 -->
            <div style="display:inline-flex; align-items:center; gap:3px; background:#f8fafc; padding:2px 6px; border-radius:6px; border:1px solid #e2e8f0;">
                ${radioList}
            </div>

            <!-- 규격 입력 -->
            ${inputFieldHtml}


            <span class="zone-pts-badge">길은 자동</span>
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
            <button class="btn-guide-close" onclick="exitUtilityLineDrawingMode()">취소 (ESC)</button>
        </div>
    `;
}
