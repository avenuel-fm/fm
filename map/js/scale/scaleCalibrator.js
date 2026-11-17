/* ==========================================================================
   scaleCalibrator.js - 도면 축척(Scale) 계산, 2점 기준 실측 캘리브레이션 CAD 엔진
   ========================================================================== */

var currentScaleRatio = 100;
var currentScaleRealMeters = 50;

        // ================= 축척(Scale) 설정 및 면적 산출 엔진 =================
        function getScaleStorageKey() {
            const bId = (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? `_${currentBuildingId}` : '';
            return `lotte_scale_settings${bId}`;
        }

        function getScaleSettings() {
            try {
                const raw = mapStore.getItem(getScaleStorageKey());
                if (!raw) return { ratio: 100, metersPerPixel: 0.05, isCalibrated: false };
                const parsed = JSON.parse(raw);
                return {
                    ratio: parsed.ratio || 100,
                    metersPerPixel: parsed.metersPerPixel || 0.05,
                    isCalibrated: !!parsed.isCalibrated
                };
            } catch (e) {
                return { ratio: 100, metersPerPixel: 0.05, isCalibrated: false };
            }
        }

        function isScaleCalibrated() {
            return getScaleSettings().isCalibrated;
        }

        function saveScaleSettings() {
            const ratioInp = document.getElementById('input-scale-ratio');
            const metersInp = document.getElementById('input-scale-meters');
            const ratio = parseFloat(ratioInp?.value) || 100;
            const metersPerPixel = parseFloat(metersInp?.value) || 0.05;

            const config = { ratio, metersPerPixel, isCalibrated: true };
            try {
                mapStore.setItem(getScaleStorageKey(), JSON.stringify(config));
            } catch (e) {}

            closeScaleModal();
            updateFreehandMeasureBtnsState();
            showToast(`축척 적용 완료 (1:${ratio}, 1px = ${metersPerPixel}m)`, 1000);
        }

        function onScaleRatioChange(val) {
            const ratio = parseFloat(val) || 100;
            const meters = (ratio * 0.0005).toFixed(3);
            const metersInp = document.getElementById('input-scale-meters');
            if (metersInp) metersInp.value = meters;
        }

        function onScaleMetersChange(val) {
            const meters = parseFloat(val) || 0.05;
            const ratio = Math.round(meters / 0.0005);
            const ratioInp = document.getElementById('input-scale-ratio');
            if (ratioInp) ratioInp.value = ratio;
        }

        function updateScaleModalUI() {
            const config = getScaleSettings();
            const ratioInp = document.getElementById('input-scale-ratio');
            const metersInp = document.getElementById('input-scale-meters');
            if (ratioInp) ratioInp.value = config.ratio;
            if (metersInp) metersInp.value = config.metersPerPixel;

            const badge = document.getElementById('scale-status-badge');
            const text = document.getElementById('scale-status-text');
            if (badge) {
                if (config.isCalibrated) {
                    badge.textContent = '✓ 캘리브레이션 완료';
                    badge.style.color = '#059669';
                    badge.style.background = '#ecfdf5';
                    badge.style.border = '1px solid #a7f3d0';
                } else {
                    badge.textContent = '! 기준선 측정 필요';
                    badge.style.color = '#d97706';
                    badge.style.background = '#fef3c7';
                    badge.style.border = '1px solid #fde68a';
                }
            }
            if (text) {
                text.innerHTML = `1 : ${config.ratio} <span style="font-size:12px; font-weight:500; color:var(--text-muted);">(1px = ${config.metersPerPixel}m)</span>`;
            }
            if (typeof updateGridSpacingUI === 'function') {
                updateGridSpacingUI();
            }
        }

        function openScaleModal() {
            closeEditDropdown();
            updateScaleModalUI();
            const modal = document.getElementById('scale-modal');
            if (modal) modal.style.display = 'flex';
        }

        function closeScaleModal() {
            const modal = document.getElementById('scale-modal');
            if (modal) modal.style.display = 'none';
        }

        // 기준 2점 실측 캘리브레이션 (방식 #1)
        var isScaleMeasuring = false;
        let scaleMeasurePts = [];
        let pendingScalePixelDist = 0;

        function cleanupScaleMeasureTempLayer() {
            const svgEl = mapContainer.querySelector('svg');
            if (svgEl) {
                svgEl.querySelector('#scale-measure-temp-layer')?.remove();
            }
        }

        function updateScaleMeasurePreview(curX, curY) {
            if (!isScaleMeasuring || scaleMeasurePts.length !== 1) return;
            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return;

            const p1 = scaleMeasurePts[0];
            const line = svgEl.querySelector('#scale-measure-temp-line');
            if (line) {
                line.setAttribute('x2', curX.toFixed(1));
                line.setAttribute('y2', curY.toFixed(1));
            }

            const badge = svgEl.querySelector('#scale-measure-temp-text');
            if (badge) {
                const distPx = Math.hypot(curX - p1.x, curY - p1.y);
                const midX = (p1.x + curX) / 2;
                const midY = (p1.y + curY) / 2 - 8;
                badge.setAttribute('x', midX.toFixed(1));
                badge.setAttribute('y', midY.toFixed(1));
                badge.textContent = `${distPx.toFixed(0)} px`;
            }
        }

        function startScaleCalibrationMeasure() {
            closeScaleModal();
            cleanupScaleMeasureTempLayer();
            isScaleMeasuring = true;
            scaleMeasurePts = [];
            viewport.style.cursor = 'crosshair';

            const banner = document.getElementById('scale-measure-guide-banner');
            const bannerText = document.getElementById('scale-measure-guide-text');
            if (bannerText) bannerText.textContent = '기준선 시작점(1/2)을 클릭하세요. (취소: ESC)';
            if (banner) banner.style.display = 'flex';
            showToast('도면에서 실측 거리를 알고 있는 기준선(복도/기둥)의 시작점을 클릭하세요.', 1500);
        }

        function cancelScaleCalibrationMeasure() {
            isScaleMeasuring = false;
            scaleMeasurePts = [];
            cleanupScaleMeasureTempLayer();
            viewport.style.cursor = 'grab';
            const banner = document.getElementById('scale-measure-guide-banner');
            if (banner) banner.style.display = 'none';
        }

        function handleScaleMeasureClick(svgX, svgY) {
            let pt = { x: svgX, y: svgY };
            if (scaleMeasurePts.length === 1 && typeof snapToOrtho === 'function') {
                pt = snapToOrtho(pt, scaleMeasurePts[0]);
            }
            scaleMeasurePts.push(pt);
            const svgEl = mapContainer.querySelector('svg');

            if (scaleMeasurePts.length === 1) {
                const bannerText = document.getElementById('scale-measure-guide-text');
                if (bannerText) bannerText.textContent = '기준선 끝점(2/2)을 클릭하세요. (취소: ESC)';
                showToast('기준선의 끝점(두 번째 점)을 클릭하세요.', 1500);

                if (svgEl) {
                    cleanupScaleMeasureTempLayer();
                    const tempLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    tempLayer.setAttribute('id', 'scale-measure-temp-layer');
                    tempLayer.style.pointerEvents = 'none';

                    // 1. 시작점 마커 원형
                    const startDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    startDot.setAttribute('cx', svgX.toFixed(1));
                    startDot.setAttribute('cy', svgY.toFixed(1));
                    startDot.setAttribute('r', '5');
                    startDot.setAttribute('fill', '#2563eb');
                    startDot.setAttribute('stroke', '#ffffff');
                    startDot.setAttribute('stroke-width', '2');
                    tempLayer.appendChild(startDot);

                    // 2. 푸른색 점선 (실시간 트래킹)
                    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                    line.setAttribute('id', 'scale-measure-temp-line');
                    line.setAttribute('x1', svgX.toFixed(1));
                    line.setAttribute('y1', svgY.toFixed(1));
                    line.setAttribute('x2', svgX.toFixed(1));
                    line.setAttribute('y2', svgY.toFixed(1));
                    line.setAttribute('stroke', '#2563eb');
                    line.setAttribute('stroke-width', '2.5');
                    line.setAttribute('stroke-dasharray', '6 4');
                    line.setAttribute('stroke-linecap', 'round');
                    tempLayer.appendChild(line);

                    // 3. 거리 표시 배지
                    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    text.setAttribute('id', 'scale-measure-temp-text');
                    text.setAttribute('x', svgX.toFixed(1));
                    text.setAttribute('y', (svgY - 10).toFixed(1));
                    text.setAttribute('fill', '#2563eb');
                    text.setAttribute('font-size', '12');
                    text.setAttribute('font-weight', '700');
                    text.setAttribute('font-family', 'Pretendard, sans-serif');
                    text.setAttribute('text-anchor', 'middle');
                    text.textContent = '0 px';
                    tempLayer.appendChild(text);

                    svgEl.appendChild(tempLayer);
                }
            } else if (scaleMeasurePts.length === 2) {
                const p1 = scaleMeasurePts[0];
                const p2 = scaleMeasurePts[1];
                cancelScaleCalibrationMeasure();

                pendingScalePixelDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                if (pendingScalePixelDist < 5) {
                    showToast('두 점 사이의 거리가 너무 가깝습니다. 다시 측정해주세요.', 1500);
                    return;
                }

                // 인앱 전용 실측값 입력 팝업 오픈
                const pxEl = document.getElementById('scale-measured-px');
                if (pxEl) pxEl.textContent = pendingScalePixelDist.toFixed(1);
                const inputEl = document.getElementById('input-scale-real-meters');
                if (inputEl) inputEl.value = '5.0';

                const modal = document.getElementById('scale-input-modal');
                if (modal) modal.style.display = 'flex';
                setTimeout(() => inputEl?.focus(), 50);
            }
        }

        function setScaleRealMeters(val) {
            const inputEl = document.getElementById('input-scale-real-meters');
            if (inputEl) inputEl.value = val;
        }

        function closeScaleInputModal() {
            const modal = document.getElementById('scale-input-modal');
            if (modal) modal.style.display = 'none';
        }

        function confirmScaleCalibration() {
            const inputEl = document.getElementById('input-scale-real-meters');
            const meters = parseFloat(inputEl?.value);
            if (!isNaN(meters) && meters > 0 && pendingScalePixelDist > 0) {
                const metersPerPixel = parseFloat((meters / pendingScalePixelDist).toFixed(4));
                const ratio = Math.round(metersPerPixel / 0.0005);
                const config = { ratio, metersPerPixel, isCalibrated: true };
                mapStore.setItem(getScaleStorageKey(), JSON.stringify(config));
                closeScaleInputModal();
                updateScaleModalUI();
                if (typeof applyGridSpacing === 'function') {
                    applyGridSpacing();
                }
                updateFreehandMeasureBtnsState();
                showToast(`축척 캘리브레이션 완료! (1:${ratio}, 1px = ${metersPerPixel}m)`, 1500);
            } else {
                showToast('유효한 실제 거리를 입력해주세요.', 1500);
            }
        }

        // 그리드(격자) 간격 설정 이벤트 핸들러
        function onGridSpacingInputChange(val) {
            const meters = parseFloat(val);
            if (!isNaN(meters) && meters > 0) {
                if (typeof setGridSpacingMeters === 'function') {
                    setGridSpacingMeters(meters);
                }
            }
        }

        function setGridSpacingPreset(val) {
            if (typeof setGridSpacingMeters === 'function') {
                setGridSpacingMeters(val);
            }
            const inp = document.getElementById('input-grid-spacing-meters');
            if (inp) inp.value = val;
            if (typeof showToast === 'function') {
                showToast(`그리드 간격 ${val}m 설정 완료`, 1000);
            }
        }

        function saveGridSpacingSettings() {
            const inp = document.getElementById('input-grid-spacing-meters');
            const meters = parseFloat(inp?.value);
            if (!isNaN(meters) && meters > 0) {
                if (typeof setGridSpacingMeters === 'function') {
                    setGridSpacingMeters(meters);
                }
                if (typeof showToast === 'function') {
                    showToast(`그리드 간격 ${meters}m 적용 완료`, 1500);
                }
            }
        }