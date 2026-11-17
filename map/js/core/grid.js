/* ==========================================================================
   grid.js - 바닥 그리드(Grid Pattern) 생성 및 가시성 제어 (연회색 CAD 그리드)
   ========================================================================== */

function getGridSpacingMeters() {
    try {
        const val = parseFloat(localStorage.getItem('lotte_grid_spacing_meters'));
        return (!isNaN(val) && val > 0) ? val : 1.0;
    } catch (e) {
        return 1.0;
    }
}

function setGridSpacingMeters(meters) {
    const val = parseFloat(meters);
    if (!isNaN(val) && val > 0) {
        try {
            localStorage.setItem('lotte_grid_spacing_meters', val.toString());
        } catch (e) {}
        applyGridSpacing();
        updateGridSpacingUI();
    }
}

function updateGridSpacingUI() {
    const spacingMeters = getGridSpacingMeters();
    const inp = document.getElementById('input-grid-spacing-meters');
    if (inp) inp.value = spacingMeters;

    const scaleSettings = (typeof getScaleSettings === 'function') ? getScaleSettings() : { metersPerPixel: 0.05 };
    const metersPerPixel = scaleSettings.metersPerPixel || 0.05;
    const subGridPx = Math.max(5, spacingMeters / metersPerPixel);

    const badge = document.getElementById('grid-spacing-px-badge');
    if (badge) {
        badge.textContent = `1칸 = 약 ${Math.round(subGridPx)}px`;
    }
}

function applyGridSpacing(svgEl) {
    if (!svgEl) {
        svgEl = (typeof mapContainer !== 'undefined' && mapContainer) ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    }
    if (!svgEl) return;

    let defs = svgEl.querySelector('defs');
    if (!defs) {
        defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        svgEl.insertBefore(defs, svgEl.firstChild);
    }
    let pattern = svgEl.querySelector('#cad-floor-grid-pattern');
    if (!pattern) {
        pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        pattern.setAttribute('id', 'cad-floor-grid-pattern');
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        defs.appendChild(pattern);
    }

    const spacingMeters = getGridSpacingMeters();
    const scaleSettings = (typeof getScaleSettings === 'function') ? getScaleSettings() : { metersPerPixel: 0.05 };
    const metersPerPixel = scaleSettings.metersPerPixel || 0.05;

    // 1칸에 해당하는 픽셀 수 (최소 5px로 클램핑하여 과도한 연산 방지)
    const subGridPx = Math.max(5, spacingMeters / metersPerPixel);
    const majorGridPx = subGridPx * 5;

    pattern.setAttribute('width', majorGridPx.toFixed(2));
    pattern.setAttribute('height', majorGridPx.toFixed(2));

    // 보조선 4개 (1, 2, 3, 4)
    let subPaths = '';
    for (let i = 1; i < 5; i++) {
        const p = (i * subGridPx).toFixed(2);
        subPaths += `M ${p} 0 L ${p} ${majorGridPx.toFixed(2)} M 0 ${p} L ${majorGridPx.toFixed(2)} ${p} `;
    }

    pattern.innerHTML = `
        <path d="${subPaths.trim()}" fill="none" stroke="#cbd5e1" stroke-width="0.8" stroke-opacity="0.85"/>
        <path d="M ${majorGridPx.toFixed(2)} 0 L 0 0 0 ${majorGridPx.toFixed(2)}" fill="none" stroke="#94a3b8" stroke-width="1.4" stroke-opacity="0.95"/>
    `;
}

// ================= 바닥 그리드(Grid Pattern) 엔진 =================
function ensureFloorGrid(svgEl) {
    if (!svgEl) return;
    applyGridSpacing(svgEl);

    let gridRect = svgEl.querySelector('#cad-floor-grid-rect');
    if (!gridRect) {
        gridRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        gridRect.setAttribute('id', 'cad-floor-grid-rect');
        gridRect.setAttribute('x', '-20000');
        gridRect.setAttribute('y', '-20000');
        gridRect.setAttribute('width', '60000');
        gridRect.setAttribute('height', '60000');
        gridRect.setAttribute('fill', 'url(#cad-floor-grid-pattern)');
        gridRect.setAttribute('style', 'display:none; pointer-events:none; mix-blend-mode:multiply;');
        svgEl.appendChild(gridRect);
    } else {
        gridRect.setAttribute('style', `${gridRect.style.display === 'block' ? 'display:block;' : 'display:none;'} pointer-events:none; mix-blend-mode:multiply;`);
    }
}

var isGridLayerExplicitlyOn = false;

function isAnyEditModeActive() {
    return !!(
        (typeof isDrawingMode !== 'undefined' && isDrawingMode) ||
        (typeof isZoneDrawingMode !== 'undefined' && isZoneDrawingMode) ||
        (typeof isSymbolMode !== 'undefined' && isSymbolMode)
    );
}

function onGridCheckboxChange(isChecked) {
    isGridLayerExplicitlyOn = !!isChecked;
    if (isChecked) {
        showFloorGrid();
    } else {
        hideFloorGrid(true);
    }
}

function showFloorGrid() {
    const svgEl = (typeof mapContainer !== 'undefined' && mapContainer) ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    ensureFloorGrid(svgEl);
    const gridRect = svgEl.querySelector('#cad-floor-grid-rect');
    if (gridRect) {
        gridRect.style.display = 'block';
        // 편집 진행 시 도면 바닥 및 매장 위로 그리드를 올려서 그리드 선이 선명하게 보이도록 배치
        svgEl.appendChild(gridRect);
        // 단, 방화구역/제연구획, 심벌 및 실시간 드로잉 선은 그리드보다 상위에 위치
        if (typeof bringZoneLayersToFront === 'function') {
            bringZoneLayersToFront();
        }
    }
}

function hideFloorGrid(force = false) {
    // 레이어 체크박스로 명시적으로 켜둔 상태가 아니고, 편집 모드가 아니면 그리드 숨김
    if (!force && isGridLayerExplicitlyOn) return;
    const svgEl = (typeof mapContainer !== 'undefined' && mapContainer) ? mapContainer.querySelector('svg') : document.querySelector('#map-container svg');
    if (!svgEl) return;
    const gridRect = svgEl.querySelector('#cad-floor-grid-rect');
    if (gridRect) gridRect.style.display = 'none';
}

// ================= 그리드 자석(스냅 Snap) 연산 엔진 =================
function getGridCellPixelSize() {
    const spacingMeters = getGridSpacingMeters();
    const scaleSettings = (typeof getScaleSettings === 'function') ? getScaleSettings() : { metersPerPixel: 0.05 };
    const metersPerPixel = scaleSettings.metersPerPixel || 0.05;
    return Math.max(5, spacingMeters / metersPerPixel);
}

function snapToGrid(curX, curY, threshold = 16) {
    const subGridPx = getGridCellPixelSize();
    const snapX = Math.round(curX / subGridPx) * subGridPx;
    const snapY = Math.round(curY / subGridPx) * subGridPx;
    const dist = Math.hypot(curX - snapX, curY - snapY);

    if (dist <= threshold) {
        return { x: snapX, y: snapY, isSnapped: true, type: 'intersection' };
    }

    const diffX = Math.abs(curX - snapX);
    const diffY = Math.abs(curY - snapY);
    if (diffX <= threshold * 0.6) {
        return { x: snapX, y: curY, isSnapped: true, type: 'vertical' };
    }
    if (diffY <= threshold * 0.6) {
        return { x: curX, y: snapY, isSnapped: true, type: 'horizontal' };
    }

    return { x: curX, y: curY, isSnapped: false };
}
