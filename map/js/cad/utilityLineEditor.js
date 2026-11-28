/* ==========================================================================
   utilityLineEditor.js - 매장(자) ← 기능실(모) 설비 배관/간선(전기, 수도, 가스, 배수). 선은 길찾기로 자동 (결정 246)
   ========================================================================== */

var isUtilLineDrawingMode = false;
var utilLineSourceStore = null;    // 자 = 매장 (결정 246. 예전에는 기능실이 자)
var utilLineTargetStore = null;    // 모 = 기능실. 흐름은 모 → 자
var utilLineSelectedType = 'power';// 'power'(전기) | 'water'(수도) | 'gas'(가스) | 'drain'(배수)
var utilLinePowerKind = '일반';     // 전기만: '일반' | '비상' (결정 354)
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
        color: '#dc2626', // 붉은색 (결정 254)
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

// 같은 기능실–같은 매장 사이 선이 여럿이면 선 사이 1px 간격으로 나란히 (선 굵기 3px + 간격 1px = 가운데끼리 4px). 저장 위치는 그대로, 그릴 때만 옮김 (결정 254)
var UTIL_LINE_PITCH = 4;
function offsetPolyline(pts, d) {
    const p = pts.filter((q, i) => i === 0 || q.x !== pts[i - 1].x || q.y !== pts[i - 1].y);
    if (!d || p.length < 2) return pts;
    const nrm = [];
    for (let i = 0; i < p.length - 1; i++) {
        const dx = p[i + 1].x - p[i].x, dy = p[i + 1].y - p[i].y, len = Math.hypot(dx, dy) || 1;
        nrm.push({ x: -dy / len, y: dx / len });
    }
    const out = [{ x: p[0].x + nrm[0].x * d, y: p[0].y + nrm[0].y * d }];
    for (let j = 1; j < p.length - 1; j++) {
        const a = nrm[j - 1], b = nrm[j], k = 1 + a.x * b.x + a.y * b.y;
        const m = k > 0.2 ? { x: (a.x + b.x) * d / k, y: (a.y + b.y) * d / k } : { x: a.x * d, y: a.y * d };   // 뾰족한 꺾임은 모서리 안 뻗게
        out.push({ x: p[j].x + m.x, y: p[j].y + m.y });
    }
    const l = nrm[nrm.length - 1], e = p[p.length - 1];
    out.push({ x: e.x + l.x * d, y: e.y + l.y * d });
    return out;
}
function utilPairOffsets(lines) {
    const groups = {}, off = {};
    lines.forEach(l => { const k = (l.sourceStoreId || l.sourceName || '') + '|' + (l.targetStoreId || l.targetName || ''); (groups[k] = groups[k] || []).push(l); });
    Object.values(groups).forEach(g => {
        g.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        g.forEach((l, i) => { off[l.id] = (i - (g.length - 1) / 2) * UTIL_LINE_PITCH; });
    });
    return off;
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
    const pairOff = utilPairOffsets(lines.filter(l => l.points && l.points.length >= 2));

    lines.forEach(line => {
        if (!line.points || line.points.length < 2) return;
        const drawPts = offsetPolyline(line.points, pairOff[line.id] || 0);

        // 레이어 필터 가시성 확인
        const sub = line.subType || 'power';
        if (sub in utilLineFilterState && !utilLineFilterState[sub]) return;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'util-line-item-group');
        g.setAttribute('data-id', line.id);

        // 1. 선분(Polyline)
        const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        const ptsStr = drawPts.map(p => `${+p.x.toFixed(2)},${+p.y.toFixed(2)}`).join(' ');
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
        const midPt = getMidPointOfPoints(drawPts);
        let labelGroup = null;
        if (midPt) {
            labelGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            labelGroup.setAttribute('class', 'util-spec-badge-group');
            labelGroup.style.cursor = 'pointer';

            // 이름표 글자: 고친 글자(labelText, 여러 줄)가 있으면 그것, 없으면 「전기 (50A)」 (결정 308)
            const textLines = utilLabelLines(line);
            const approxWidth = Math.max(Math.max(...textLines.map(utilTextWidth)) + 16, 54);
            const boxH = 22 + (textLines.length - 1) * UTIL_LABEL_LINE;

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', -approxWidth / 2);
            rect.setAttribute('y', -boxH / 2);
            rect.setAttribute('width', approxWidth);
            rect.setAttribute('height', boxH);
            rect.setAttribute('rx', 5);
            rect.setAttribute('fill', isSelected ? '#ef4444' : 'rgba(15, 23, 42, 0.9)');
            rect.setAttribute('stroke', isSelected ? '#ffffff' : (line.color || '#2563eb'));
            rect.setAttribute('stroke-width', '1.5');

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', 0);
            text.setAttribute('y', 4 - (textLines.length - 1) * UTIL_LABEL_LINE / 2);
            text.setAttribute('fill', '#ffffff');
            text.setAttribute('font-size', '11');
            text.setAttribute('font-weight', '700');
            text.setAttribute('text-anchor', 'middle');
            textLines.forEach((t, i) => {
                const ts = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
                ts.setAttribute('x', 0);
                if (i) ts.setAttribute('dy', String(UTIL_LABEL_LINE));
                ts.textContent = t;
                text.appendChild(ts);
            });

            labelGroup.appendChild(rect);
            labelGroup.appendChild(text);
            labelGroup.setAttribute('transform', `translate(${midPt.x},${midPt.y})`);   // 실제 자리는 layoutUtilLabels 가 겹치지 않게 다시 정함 (결정 258)
            labelGroup._w = approxWidth;
            labelGroup._h = boxH;
            g._pts = drawPts;
            g._line = line;
            bindUtilLabelEdit(labelGroup, line, g);
            labelGroup.style.cursor = utilLabelEditable(line) ? 'move' : 'default';
            const link = document.createElementNS('http://www.w3.org/2000/svg', 'line');   // 이름표가 선에서 떨어졌을 때 잇는 가는 선
            link.setAttribute('class', 'util-label-link');
            link.setAttribute('stroke', line.color || '#2563eb'); link.setAttribute('stroke-width', '1'); link.setAttribute('pointer-events', 'none');
            link.style.display = 'none';
            g._link = link;
            g.appendChild(link);
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
                g.style.display = isSelected ? '' : 'none';   // 연결 안 된 선은 안 보임 (결정 254)
                if (labelGroup) labelGroup.style.display = 'none';
            }
        } else {
            polyline.style.opacity = '1';
            g.style.display = isSelected ? '' : 'none';   // 평소에는 선이 안 보임. 매장·기능실을 누르면 연결선만 보임
            if (labelGroup) labelGroup.style.display = isSelected ? 'block' : 'none';
        }

        // 선분 클릭 시 -> 선분 선택 및 삭제 확인 모달/토스트
        const clickHandler = (e) => {
            e.stopPropagation();
            selectUtilLineForDelete(line);
        };

        polyline.addEventListener('click', clickHandler);
        if (labelGroup) labelGroup.addEventListener('click', e => e.stopPropagation());   // 이름표 한 번 누름은 아무것도 안 함 (더블클릭 고치기와 안 부딪히게, 결정 308)

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
    layoutUtilLabels();
}

// 보이는 선들의 이름표가 서로 겹치지 않게 자리를 정함 (결정 258): 선 따라 가운데 → 35% → 65% → 20% → 80%, 다 막히면 아래위로 24px씩 쌓음
function utilPointAt(pts, f) {
    let total = 0; const seg = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push(l); total += l; }
    let d = total * f;
    for (let i = 0; i < seg.length; i++) {
        if (d <= seg[i] || i === seg.length - 1) { const t = seg[i] ? Math.min(1, d / seg[i]) : 0; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }; }
        d -= seg[i];
    }
    return pts[0];
}
function layoutUtilLabels() {
    const layer = mapContainer?.querySelector('#utility-lines-layer');
    if (!layer) return;
    const placed = [], PAD = 2;
    const hit = (x, y, w, h) => placed.some(r => Math.abs(x - r.x) < (w + r.w) / 2 + PAD && Math.abs(y - r.y) < (h + r.h) / 2 + PAD);
    const groups = Array.from(layer.querySelectorAll('.util-line-item-group')).filter(g => {
        const lab = g.querySelector('.util-spec-badge-group');
        return lab && g._pts && g.style.display !== 'none' && lab.style.display !== 'none';
    });
    // 손으로 옮긴 이름표(labelPos)는 그 자리에 고정하고 먼저 자리를 차지함 (결정 308)
    groups.sort((a, b) => (b._line && b._line.labelPos ? 1 : 0) - (a._line && a._line.labelPos ? 1 : 0));
    groups.forEach(g => {
        const lab = g.querySelector('.util-spec-badge-group');
        const w = lab._w || 54, h = lab._h || 22;
        let pos = null, anchor = null;
        const fixed = g._line && g._line.labelPos;
        if (fixed) { pos = { x: fixed.x, y: fixed.y }; anchor = utilPointAt(g._pts, 0.5); }
        for (const f of fixed ? [] : [0.5, 0.35, 0.65, 0.2, 0.8]) {
            const p = utilPointAt(g._pts, f);
            if (!hit(p.x, p.y, w, h)) { pos = p; anchor = p; break; }
        }
        if (!pos) {
            const base = utilPointAt(g._pts, 0.5); anchor = base;
            for (let k = 1; k < 40 && !pos; k++) for (const sg of [1, -1]) { const y = base.y + sg * k * (h + PAD); if (!hit(base.x, y, w, h)) { pos = { x: base.x, y }; break; } }
            pos = pos || base;
        }
        placed.push({ x: pos.x, y: pos.y, w, h });
        lab.setAttribute('transform', `translate(${pos.x.toFixed(1)},${pos.y.toFixed(1)})`);
        if (g._link) {
            const moved = Math.hypot(pos.x - anchor.x, pos.y - anchor.y) > 1;
            g._link.style.display = moved ? '' : 'none';
            if (moved) { g._link.setAttribute('x1', anchor.x); g._link.setAttribute('y1', anchor.y); g._link.setAttribute('x2', pos.x); g._link.setAttribute('y2', pos.y); }
        }
    });
}

// ================= 이름표 고치기 · 옮기기 (결정 308) =================
// 더블클릭 → 그 자리에서 고침(Enter 줄바꿈 · 바깥 누르면 저장 · Esc 취소), 끌면 옮김. 저장: line.labelText(줄은 \n) · line.labelPos({x,y})
var UTIL_LABEL_LINE = 14;
function utilDefaultLabel(line) {
    const base = line.specText ? `${line.subTypeLabel || ''} (${line.specText})` : (line.subTypeLabel || '설비');
    return line.originName ? `${base}/${line.originName}` : base;   // 다른 층에서 시작한 선은 「/1층 3번 EPS」 (결정 366)
}
function utilLabelLines(line) { return (line.labelText || utilDefaultLabel(line)).split('\n'); }
function utilTextWidth(t) {
    const c = utilTextWidth._c || (utilTextWidth._c = document.createElement('canvas').getContext('2d'));
    c.font = '700 11px Pretendard, sans-serif';
    return c.measureText(t).width || t.length * 9;
}
function updateUtilityLineLabel(lineId, patch) {
    const floor = FLOORS[currentFloorIdx];
    if (typeof pushUndoState === 'function') pushUndoState('설비 연결선 이름표');
    const lines = getFloorUtilityLines(floor.code), l = lines.find(x => x.id === lineId);
    if (!l) return;
    Object.keys(patch).forEach(k => { if (patch[k] === null) delete l[k]; else l[k] = patch[k]; });
    saveFloorUtilityLines(floor.code, lines);
}
function utilLabelEditable(line) { return !mapStore.readOnly() && !isLayerLocked(line.subType || 'power'); }
function bindUtilLabelEdit(lab, line, g) {
    lab.addEventListener('mousedown', e => {
        if (e.button !== 0 || !utilLabelEditable(line)) return;
        e.stopPropagation();                          // 지도 끌기 대신 이름표 끌기
        const ctm = lab.parentNode.getScreenCTM(), k = ctm ? ctm.a : 1;
        const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(lab.getAttribute('transform') || '');
        const x0 = m ? +m[1] : 0, y0 = m ? +m[2] : 0, sx = e.clientX, sy = e.clientY;
        let moved = false, nx = x0, ny = y0;
        const move = ev => {
            const dx = ev.clientX - sx, dy = ev.clientY - sy;
            if (!moved && Math.hypot(dx, dy) < 4) return;
            moved = true;
            nx = x0 + dx / k; ny = y0 + dy / k;
            lab.setAttribute('transform', `translate(${nx.toFixed(1)},${ny.toFixed(1)})`);
            if (g._link) {
                const a = utilPointAt(g._pts, 0.5);
                g._link.style.display = '';
                g._link.setAttribute('x1', a.x); g._link.setAttribute('y1', a.y); g._link.setAttribute('x2', nx); g._link.setAttribute('y2', ny);
            }
        };
        const up = () => {
            window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
            if (!moved) return;
            updateUtilityLineLabel(line.id, { labelPos: { x: Math.round(nx * 10) / 10, y: Math.round(ny * 10) / 10 } });
            line.labelPos = { x: nx, y: ny };
            layoutUtilLabels();
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    });
    lab.addEventListener('dblclick', e => {
        e.stopPropagation(); e.preventDefault();
        if (!utilLabelEditable(line)) return;
        openUtilLabelEditor(lab, line);
    });
}
function openUtilLabelEditor(lab, line) {
    document.getElementById('util-label-editor')?.remove();
    const r = lab.querySelector('rect').getBoundingClientRect(), ctm = lab.getScreenCTM(), k = ctm ? ctm.a : 1;
    const ta = document.createElement('textarea');
    ta.id = 'util-label-editor';
    ta.value = utilLabelLines(line).join('\n');
    ta.spellcheck = false;
    const fs = Math.max(11 * k, 12), lh = UTIL_LABEL_LINE / 11 * fs;
    Object.assign(ta.style, {
        position: 'fixed', zIndex: 3000, resize: 'none', overflow: 'hidden', boxSizing: 'border-box', margin: 0,
        background: '#1e293b', color: '#fff', border: '2px solid #38bdf8', borderRadius: '6px', boxShadow: '0 0 0 3px rgba(56,189,248,.35)',
        font: `700 ${fs}px/${lh}px Pretendard, sans-serif`, textAlign: 'center', padding: '3px 8px', outline: 'none', whiteSpace: 'pre'
    });
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const fit = () => {                               // 줄 수·글자 길이에 맞춰 상자 크기
        const ls = ta.value.split('\n'), w = Math.max(...ls.map(utilTextWidth)) * fs / 11 + 24, h = ls.length * lh + 10;
        ta.style.width = Math.max(w, r.width) + 'px'; ta.style.height = h + 'px';
        ta.style.left = (cx - Math.max(w, r.width) / 2) + 'px'; ta.style.top = (cy - h / 2) + 'px';
    };
    let done = false;
    const finish = save => {
        if (done) return; done = true;
        const v = ta.value.replace(/\s+$/, '').split('\n').map(s => s.replace(/\s+$/, '')).join('\n');
        ta.remove();
        if (!save) return;
        const same = !v.trim() || v === utilDefaultLabel(line);
        if (same ? !line.labelText : v === line.labelText) return;
        updateUtilityLineLabel(line.id, { labelText: same ? null : v });
        renderFloorUtilityLines();
    };
    ta.addEventListener('input', fit);
    ta.addEventListener('keydown', e => {
        e.stopPropagation();                          // 지도 단축키(Delete·Esc·Enter)와 안 부딪히게
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    ta.addEventListener('blur', () => finish(true));
    ['mousedown', 'click', 'dblclick', 'wheel'].forEach(t => ta.addEventListener(t, e => e.stopPropagation()));
    document.body.appendChild(ta);
    fit(); ta.focus(); ta.select();
}

// ================= 선분 선택 및 삭제 기능 =================
function selectUtilLineForDelete(line) {
    activeSelectedUtilLineId = line.id;
    renderFloorUtilityLines();
    if (mapStore.readOnly()) return;
    if (isLayerLocked(line.subType || 'power')) { warnLayerLocked(); return; }   // 보기 전용: 선택(라벨 보기)만

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
        const sel = getFloorUtilityLines(floor.code).find(l => l.id === activeSelectedUtilLineId);
        if (sel && isLayerLocked(sel.subType || 'power')) { warnLayerLocked(); return; }
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
    if (!store) { clearUtilityLineHighlight(); return; }

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
            g.style.display = '';
            if (badge) badge.style.display = 'block';
            connectedCount++;
        } else {
            line.classList.remove('highlighted');
            line.classList.add('inactive');
            g.style.display = 'none';
            if (badge) badge.style.display = 'none';
        }
    });

    layoutUtilLabels();
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
            line.style.opacity = '1';
        }
        g.style.display = (activeSelectedUtilLineId && g.getAttribute('data-id') === activeSelectedUtilLineId) ? '' : 'none';   // 평소엔 안 보임
        if (badge) badge.style.display = 'none';
    });
    layoutUtilLabels();
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
    utilLineTargetFloor = null;
    utilLinePowerKind = '일반';
    purgeLegacyUtilityLines();
    showUtilLineGuideBanner();
    if (preStore) { handleUtilLineMapClick(null, preStore); return; }   // 기능실 창의 「매장 연결선」에서 온 경우
    showToast('매장(자)과 기능실(모)을 차례로 누르면 선이 길을 따라 자동으로 그려집니다.', 2500);
}

// 예전 방식(손으로 꺾어 그린) 배관은 길찾기 방식으로 바뀌며 지움 (결정 246). 자동으로 그린 선은 auto 표시가 있음
function purgeLegacyUtilityLines() {
    if (mapStore.readOnly()) return;
    let total = 0;
    FLOORS.forEach(f => { total += getFloorUtilityLines(f.code).filter(l => !l.auto && !isLayerLocked(l.subType || 'power')).length; });
    if (!total) return;
    if (!confirm('예전 방식으로 그린 배관 ' + total + '개가 있습니다.\n배관 연결이 길 따라 자동으로 그리는 방식으로 바뀌어서 이 선들을 지웁니다. (기록에서 「이 날로 되돌리기」로 되살릴 수 있습니다)\n\n지울까요?')) return;
    if (typeof pushUndoState === 'function') pushUndoState('예전 배관 지움');
    FLOORS.forEach(f => {
        const all = getFloorUtilityLines(f.code), keep = all.filter(l => l.auto || isLayerLocked(l.subType || 'power'));
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
    utilLineTargetFloor = null;
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

// ---- 다른 층 매장 연결 (결정 366): 기능실을 고른 뒤 지도의 층 버튼으로 옮기면, 그 층의 같은 기능실(층 뺀 이름이 같음)에서 이어 그림 ----
var utilLineTargetFloor = null;   // 기능실(모)을 고른 층 코드
function utilLineCrossFloor() {
    return !!(utilLineTargetStore && utilLineTargetFloor && utilLineTargetFloor !== FLOORS[currentFloorIdx].code);
}
function utilLineFloorTwin() {    // 지금 층에서 고른 기능실과 같은 기능실 (예: 1층 3번 EPS → 2층 3번 EPS)
    const key = stripFloorName(utilLineTargetStore && utilLineTargetStore.name);
    return key ? currentStores.find(s => s.type === 'utility' && s.polygonElement && stripFloorName(s.name) === key) || null : null;
}

// 매장(자)·기능실(모)을 누르면 둘이 모였을 때 길찾기로 선을 그림. 누르는 순서는 상관없음
function handleUtilLineMapClick(svgPt, targetStore = null) {
    if (!isUtilLineDrawingMode) return false;
    if (!targetStore) { showToast('도면의 매장 또는 기능실을 눌러 주세요.', 1500); return true; }
    if (targetStore.type === 'utility') {
        utilLineTargetStore = targetStore;
        utilLineTargetFloor = FLOORS[currentFloorIdx].code;
        const nm = ((typeof utilKindOf === 'function' ? utilKindOf(targetStore) + ' ' : '') + (targetStore.name || '')).toUpperCase();   // 주요 기능실·이름으로 종류 자동 (결정 362)
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
    let origin = null, from = utilLineTargetStore;
    if (utilLineCrossFloor()) {   // 다른 층: 이 층의 같은 기능실에서 이어 그림
        const twin = utilLineFloorTwin(), here = floorLabel(FLOORS[currentFloorIdx].code);
        if (!twin) { showToast(`${here}에 ${stripFloorName(utilLineTargetStore.name)}이(가) 없습니다.`, 2800); utilLineSourceStore = null; updateUtilLineGuideUI(); return; }
        origin = utilLineTargetStore; from = twin;
    }
    const res = routeBetweenStores(from, utilLineSourceStore);   // 기능실 → 매장 순서의 점
    if (!res.ok) {
        showToast(res.error, 2800);
        if (res.gap) showRouteGap(res.gap);
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
        subType: cfg.id, subTypeLabel: cfg.id === 'power' ? `${cfg.label} ${utilLinePowerKind}` : cfg.label, specText,
        ...(cfg.id === 'power' ? { powerKind: utilLinePowerKind } : {}), className: cfg.className, color: cfg.color,
        direction: 'forward',
        sourceStoreId: utilLineSourceStore.id || '', sourceName: utilLineSourceStore.name || '매장',
        targetStoreId: from.id || '', targetName: from.name || '기능실',
        ...(origin ? { originName: origin.name || '', originFloor: utilLineTargetFloor } : {}),
        points: res.points
    };
    addUtilityLine(floor.code, newLine);
    showToast(`✅ 기능실[${newLine.targetName}] ➔ 매장[${newLine.sourceName}] ${newLine.subTypeLabel} 연결 완료!`, 2000);
    const finalStore = utilLineSourceStore;
    exitUtilityLineDrawingMode();
    highlightUtilityLinesForStore(finalStore);
}

// 복도가 끊긴 자리를 빨간 점선·동그라미로 8초 보여 줌 (결정 308)
function showRouteGap(gap) {
    const svgEl = mapContainer?.querySelector('svg');
    if (!svgEl || !gap) return;
    svgEl.querySelector('#route-gap-mark')?.remove();
    const ns = 'http://www.w3.org/2000/svg', k = 1 / (typeof scale !== 'undefined' && scale ? scale : 1);
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('id', 'route-gap-mark');
    g.style.pointerEvents = 'none';
    const [a, b] = gap, mk = (tag, at) => { const e = document.createElementNS(ns, tag); Object.entries(at).forEach(([n, v]) => e.setAttribute(n, v)); g.appendChild(e); };
    mk('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: '#dc2626', 'stroke-width': 3 * k, 'stroke-dasharray': `${8 * k} ${5 * k}` });
    [a, b].forEach(p => mk('circle', { cx: p.x, cy: p.y, r: 9 * k, fill: 'rgba(220,38,38,.15)', stroke: '#dc2626', 'stroke-width': 2 * k }));
    svgEl.appendChild(g);
    setTimeout(() => g.remove(), 8000);
}

// 매장·기능실 도형을 옮기거나 키운 뒤 붙어 있는 자동 연결선을 다시 그림 (결정 308). 길을 못 찾으면 예전 선 그대로
function rerouteLinesForStore(store) {
    if (!store || typeof routeBetweenStores !== 'function') return 0;
    const floor = FLOORS[currentFloorIdx], id = String(store.id);
    const lines = getFloorUtilityLines(floor.code), byId = sid => currentStores.find(s => String(s.id) === String(sid));
    let n = 0, fail = 0, gap = null;
    lines.forEach(l => {
        if (!l.auto || (String(l.sourceStoreId) !== id && String(l.targetStoreId) !== id)) return;
        const src = byId(l.sourceStoreId), tgt = byId(l.targetStoreId);
        if (!src?.polygonElement || !tgt?.polygonElement) return;
        const res = routeBetweenStores(tgt, src);
        if (res.ok) { l.points = res.points; n++; } else { fail++; gap = gap || res.gap; }
    });
    if (n) { saveFloorUtilityLines(floor.code, lines); renderFloorUtilityLines(); }
    if (fail) { showToast(`연결선 ${fail}개는 길을 못 찾아 예전 자리 그대로입니다.`, 2800); if (gap) showRouteGap(gap); }
    return n;
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
    const srcText = utilLineSourceStore ? utilLineSourceStore.name : utilLineCrossFloor() ? floorLabel(FLOORS[currentFloorIdx].code) + '에서 눌러 주세요' : '선택 중...';
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

    // 다른 층으로 옮겼으면 「2층 보는 중 — 연결할 매장을 눌러 주세요 (2층 3번 EPS 에서 이어 그림)」 (결정 366)
    let crossHtml = '';
    if (utilLineCrossFloor()) {
        const here = floorLabel(FLOORS[currentFloorIdx].code), twin = utilLineFloorTwin();
        crossHtml = `<span id="util-cross-floor" style="padding:2px 8px; border-radius:4px; background:${twin ? '#fef3c7' : '#fee2e2'}; color:${twin ? '#92400e' : '#b91c1c'}; border:1px solid ${twin ? '#fcd34d' : '#fca5a5'};">${twin
            ? `${here} 보는 중 · ${escapeHtml(twin.name)}에서 이어 그림`
            : `${here}에 ${escapeHtml(stripFloorName(utilLineTargetStore.name))}이(가) 없습니다`}</span>`;
    }

    // 전기만 [일반 | 비상] (결정 354)
    const kindHtml = utilLineSelectedType !== 'power' ? '' : `<div id="util-power-kind" style="display:inline-flex; border:1px solid #fca5a5; border-radius:6px; overflow:hidden; background:#fff;">${['일반', '비상'].map(k =>
        `<button type="button" data-kind="${k}" onclick="utilLinePowerKind='${k}'; updateUtilLineGuideUI()" style="border:none; font-size:12px; font-weight:800; padding:4px 10px; cursor:pointer; background:${utilLinePowerKind === k ? '#dc2626' : 'transparent'}; color:${utilLinePowerKind === k ? '#fff' : '#991b1b'};">${k}</button>`).join('')}</div>`;

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
                ${crossHtml}
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

            ${kindHtml}

            <!-- 규격 입력 -->
            ${inputFieldHtml}


            ${crossHtml ? '' : '<span class="zone-pts-badge">길은 자동</span>'}
        </div>

        <div style="display:flex; align-items:center; gap:8px;">
            <button class="btn-guide-close" onclick="exitUtilityLineDrawingMode()">취소 (ESC)</button>
        </div>
    `;
}
