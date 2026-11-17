/* ==========================================================================
   freehandLayer.js - 자유 그리기 메모, 펜/거리/면적 실측 CAD 캔버스 레이어
   ========================================================================== */

var isFreehandMode = false;
var freehandColor = '#ef4444';
var freehandSize = 4;
var freehandStrokes = [];
var isFreehandDrawing = false;
var currentStrokePoints = [];
var freehandSubTool = 'pen'; // 'pen' | 'distance' | 'area'
var freehandMeasurements = [];
var activeMeasurePoints = [];
var freehandHoverPos = null;

        function updateFreehandMeasureBtnsState() {
            const isCal = isScaleCalibrated();
            const btnDist = document.getElementById('btn-fh-tool-dist');
            const btnArea = document.getElementById('btn-fh-tool-area');
            if (btnDist) {
                btnDist.disabled = !isCal;
                btnDist.classList.toggle('disabled-tool', !isCal);
                btnDist.title = isCal ? '거리 측정' : '거리 측정 (축척 캘리브레이션 필요)';
            }
            if (btnArea) {
                btnArea.disabled = !isCal;
                btnArea.classList.toggle('disabled-tool', !isCal);
                btnArea.title = isCal ? '면적 측정' : '면적 측정 (축척 캘리브레이션 필요)';
            }
        }

        function setFreehandSubTool(tool) {
            if ((tool === 'distance' || tool === 'area') && !isScaleCalibrated()) {
                showToast('거리/면적 측정을 위해 먼저 [편집 > 축척입력]에서 기준선 캘리브레이션을 진행해주세요.', 1500);
                return;
            }
            freehandSubTool = tool;
            activeMeasurePoints = [];
            freehandHoverPos = null;
            document.querySelectorAll('.freehand-tool-selector .tool-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            if (tool === 'pen') document.getElementById('btn-fh-tool-pen')?.classList.add('active');
            if (tool === 'distance') document.getElementById('btn-fh-tool-dist')?.classList.add('active');
            if (tool === 'area') document.getElementById('btn-fh-tool-area')?.classList.add('active');

            redrawFreehandStrokes();

            if (tool === 'distance') showToast('도면의 점들을 연속 클릭하여 거리를 측정하세요. (종료: ESC)', 1500);
            if (tool === 'area') showToast('도면을 클릭하여 꼭짓점을 연결하고, 시작점을 다시 클릭하거나 더블클릭/Enter로 면적을 산출하세요.', 1500);
        }

        function toggleFreehandDrawing() {
            isFreehandMode = !isFreehandMode;
            const layer = document.getElementById('freehand-layer');
            const btn = document.getElementById('btn-toggle-freehand');
            if (isFreehandMode) {
                if (isDrawingMode) exitAddStoreMode();
                if (isZoneDrawingMode) exitAddZoneMode();
                layer.style.display = 'block';
                btn?.classList.add('active-mode');
                updateFreehandMeasureBtnsState();
                initFreehandCanvas();
                showToast('그리기 모드가 활성화되었습니다. (스페이스바를 누른 채 마우스 드래그로 지도 이동 가능)', 1500);
            } else {
                exitFreehandDrawing();
            }
        }

        function exitFreehandDrawing() {
            isFreehandMode = false;
            activeMeasurePoints = [];
            freehandHoverPos = null;
            const layer = document.getElementById('freehand-layer');
            const btn = document.getElementById('btn-toggle-freehand');
            if (layer) layer.style.display = 'none';
            if (btn) btn.classList.remove('active-mode');
        }

        function setFreehandColor(c) {
            freehandColor = c;
            document.querySelectorAll('.freehand-colors .color-dot').forEach(dot => {
                dot.classList.toggle('active', dot.getAttribute('data-color') === c);
            });
        }

        function setFreehandSize(s) {
            freehandSize = s;
            document.querySelectorAll('.freehand-sizes .size-pill').forEach(pill => {
                pill.classList.toggle('active', parseInt(pill.getAttribute('data-size')) === s);
            });
        }

        function clearFreehandDrawing() {
            freehandStrokes = [];
            freehandMeasurements = [];
            activeMeasurePoints = [];
            freehandHoverPos = null;
            redrawFreehandStrokes();
            showToast('그린 내용과 거리/면적 측정을 모두 지웠습니다.', 1500);
        }

        function hexToRgba(hex, alpha = 1) {
            let c = hex.replace('#', '');
            if (c.length === 3) c = c.split('').map(x => x + x).join('');
            const num = parseInt(c, 16);
            return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
        }

        function finishFreehandDistanceMeasure() {
            activeMeasurePoints = [];
            freehandHoverPos = null;
            redrawFreehandStrokes();
            setFreehandSubTool('pen');
            showToast('연속 거리 측정이 완료되었습니다. (그리기 모드로 전환)', 1500);
        }

        function finishFreehandAreaMeasure() {
            if (activeMeasurePoints.length < 3) {
                showToast('면적을 산출하려면 최소 3개 이상의 꼭짓점이 필요합니다.', 1500);
                return;
            }
            const config = getScaleSettings();
            let areaMap = 0;
            for (let i = 0; i < activeMeasurePoints.length; i++) {
                const j = (i + 1) % activeMeasurePoints.length;
                areaMap += activeMeasurePoints[i].x * activeMeasurePoints[j].y;
                areaMap -= activeMeasurePoints[j].x * activeMeasurePoints[i].y;
            }
            areaMap = Math.abs(areaMap) / 2;

            const areaSqM = parseFloat((areaMap * Math.pow(config.metersPerPixel, 2)).toFixed(1));
            const pyeong = parseFloat((areaSqM * 0.3025).toFixed(1));

            freehandMeasurements.push({
                type: 'area',
                points: [...activeMeasurePoints],
                color: freehandColor,
                areaSqM: areaSqM,
                pyeong: pyeong
            });

            activeMeasurePoints = [];
            freehandHoverPos = null;
            redrawFreehandStrokes();
            showToast(`면적 산출 완료: ${areaSqM} ㎡ (${pyeong}평)`, 1500);
        }

        function initFreehandCanvas() {
            const canvas = document.getElementById('freehand-canvas');
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = viewport.clientWidth * dpr;
            canvas.height = viewport.clientHeight * dpr;
            canvas.style.width = viewport.clientWidth + 'px';
            canvas.style.height = viewport.clientHeight + 'px';

            redrawFreehandStrokes();

            canvas.onpointerdown = (e) => {
                e.preventDefault();

                // 스페이스바가 눌려 있으면 맵 이동(Pan) 수행
                if (isSpacePressed) {
                    isDragging = true;
                    startX = e.clientX - panX;
                    startY = e.clientY - panY;
                    canvas.setPointerCapture(e.pointerId);
                    canvas.style.cursor = 'grabbing';
                    return;
                }

                const rect = canvas.getBoundingClientRect();
                const screenX = e.clientX - rect.left;
                const screenY = e.clientY - rect.top;
                let mapX = (screenX - panX) / scale;
                let mapY = (screenY - panY) / scale;

                if ((freehandSubTool === 'distance' || freehandSubTool === 'area') && typeof snapToGrid === 'function') {
                    const floor = FLOORS[currentFloorIdx];
                    if (floor && floor.crop) {
                        const svgX = floor.crop.minX + mapX;
                        const svgY = floor.crop.minY + mapY;
                        const gSnap = snapToGrid(svgX, svgY);
                        if (gSnap.isSnapped) {
                            mapX = gSnap.x - floor.crop.minX;
                            mapY = gSnap.y - floor.crop.minY;
                        }
                    }
                }

                if (freehandSubTool === 'pen') {
                    isFreehandDrawing = true;
                    canvas.setPointerCapture(e.pointerId);
                    const currentStroke = { color: freehandColor, size: freehandSize, points: [{ x: mapX, y: mapY }] };
                    freehandStrokes.push(currentStroke);
                    redrawFreehandStrokes();
                } else if (freehandSubTool === 'distance') {
                    const newPt = { x: mapX, y: mapY };
                    activeMeasurePoints.push(newPt);
                    if (activeMeasurePoints.length === 1) {
                        showToast('다음 점을 클릭하여 직전 점과의 거리를 측정하세요. (종료: ESC)', 1500);
                        redrawFreehandStrokes();
                    } else {
                        const p1 = activeMeasurePoints[activeMeasurePoints.length - 2];
                        const p2 = newPt;
                        const dMap = Math.hypot(p2.x - p1.x, p2.y - p1.y);
                        const config = getScaleSettings();
                        const distanceM = parseFloat((dMap * config.metersPerPixel).toFixed(2));

                        freehandMeasurements.push({
                            type: 'distance',
                            p1,
                            p2,
                            color: freehandColor,
                            distanceM
                        });
                        redrawFreehandStrokes();
                        showToast(`구간 거리: ${distanceM}m (계속 클릭하거나 ESC로 완료)`, 1500);
                    }
                } else if (freehandSubTool === 'area') {
                    if (activeMeasurePoints.length >= 3) {
                        const firstPt = activeMeasurePoints[0];
                        const screenFirstX = firstPt.x * scale + panX;
                        const screenFirstY = firstPt.y * scale + panY;
                        const distScreen = Math.hypot(screenX - screenFirstX, screenY - screenFirstY);
                        if (distScreen < 20) {
                            finishFreehandAreaMeasure();
                            return;
                        }
                    }
                    if (activeMeasurePoints.length > 0 && typeof snapToOrtho === 'function') {
                        const ortho = snapToOrtho({ x: mapX, y: mapY }, activeMeasurePoints[activeMeasurePoints.length - 1]);
                        mapX = ortho.x;
                        mapY = ortho.y;
                    }
                    activeMeasurePoints.push({ x: mapX, y: mapY });
                    redrawFreehandStrokes();
                }
            };

            canvas.ondblclick = (e) => {
                if (isSpacePressed) return;
                if (freehandSubTool === 'distance' && activeMeasurePoints.length >= 2) {
                    e.preventDefault();
                    finishFreehandDistanceMeasure();
                } else if (freehandSubTool === 'area' && activeMeasurePoints.length >= 3) {
                    e.preventDefault();
                    finishFreehandAreaMeasure();
                }
            };

            canvas.onpointermove = (e) => {
                // 스페이스바를 누른 채 드래그 시 맵 이동
                if (isSpacePressed && isDragging) {
                    panX = e.clientX - startX;
                    panY = e.clientY - startY;
                    updateTransform();
                    return;
                }
                if (isSpacePressed) return;

                const rect = canvas.getBoundingClientRect();
                const screenX = e.clientX - rect.left;
                const screenY = e.clientY - rect.top;
                let mapX = (screenX - panX) / scale;
                let mapY = (screenY - panY) / scale;

                if ((freehandSubTool === 'distance' || freehandSubTool === 'area') && typeof snapToGrid === 'function') {
                    const floor = FLOORS[currentFloorIdx];
                    if (floor && floor.crop) {
                        const svgX = floor.crop.minX + mapX;
                        const svgY = floor.crop.minY + mapY;
                        const gSnap = snapToGrid(svgX, svgY);
                        if (gSnap.isSnapped) {
                            mapX = gSnap.x - floor.crop.minX;
                            mapY = gSnap.y - floor.crop.minY;
                        }
                    }
                }
                if ((freehandSubTool === 'distance' || freehandSubTool === 'area') && activeMeasurePoints.length > 0 && typeof snapToOrtho === 'function') {
                    const ortho = snapToOrtho({ x: mapX, y: mapY }, activeMeasurePoints[activeMeasurePoints.length - 1]);
                    mapX = ortho.x;
                    mapY = ortho.y;
                }
                freehandHoverPos = { x: mapX, y: mapY };

                if (freehandSubTool === 'pen') {
                    if (!isFreehandDrawing || freehandStrokes.length === 0) return;
                    e.preventDefault();
                    const currentStroke = freehandStrokes[freehandStrokes.length - 1];
                    currentStroke.points.push({ x: mapX, y: mapY });
                    redrawFreehandStrokes();
                } else if (freehandSubTool === 'distance' || freehandSubTool === 'area') {
                    if (activeMeasurePoints.length > 0) {
                        redrawFreehandStrokes();
                    }
                }
            };

            canvas.onpointerup = canvas.onpointercancel = (e) => {
                if (isDragging) {
                    isDragging = false;
                    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
                    canvas.style.cursor = isSpacePressed ? 'grab' : 'crosshair';
                    return;
                }
                if (freehandSubTool === 'pen' && isFreehandDrawing) {
                    e.preventDefault();
                    isFreehandDrawing = false;
                    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
                }
            };
        }

        window.addEventListener('resize', () => {
            if (isFreehandMode) {
                const canvas = document.getElementById('freehand-canvas');
                if (canvas) {
                    const dpr = window.devicePixelRatio || 1;
                    canvas.width = viewport.clientWidth * dpr;
                    canvas.height = viewport.clientHeight * dpr;
                    canvas.style.width = viewport.clientWidth + 'px';
                    canvas.style.height = viewport.clientHeight + 'px';
                    redrawFreehandStrokes();
                }
            }
        });

        // 도면 이동/확대/축소에 맞춰 캔버스 다시 그리기 (도면과 일체화)
        function redrawFreehandStrokes() {
            const canvas = document.getElementById('freehand-canvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.scale(dpr, dpr);

            const toScreen = (pt) => ({
                x: pt.x * scale + panX,
                y: pt.y * scale + panY
            });

            // 1. 자유 필기 스트로크 렌더링
            freehandStrokes.forEach(stroke => {
                if (!stroke.points || stroke.points.length === 0) return;
                ctx.beginPath();
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = Math.max(1.5, stroke.size * Math.sqrt(scale));
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                const s0 = toScreen(stroke.points[0]);
                ctx.moveTo(s0.x, s0.y);
                for (let i = 1; i < stroke.points.length; i++) {
                    const si = toScreen(stroke.points[i]);
                    ctx.lineTo(si.x, si.y);
                }
                ctx.stroke();
            });

            // 2. 완료된 측정 항목 (거리 및 면적) 렌더링
            freehandMeasurements.forEach(m => {
                if (m.type === 'distance') {
                    const sp1 = toScreen(m.p1);
                    const sp2 = toScreen(m.p2);

                    ctx.beginPath();
                    ctx.strokeStyle = m.color;
                    ctx.lineWidth = 3;
                    ctx.moveTo(sp1.x, sp1.y);
                    ctx.lineTo(sp2.x, sp2.y);
                    ctx.stroke();

                    ctx.fillStyle = m.color;
                    ctx.beginPath();
                    ctx.arc(sp1.x, sp1.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(sp2.x, sp2.y, 4, 0, Math.PI * 2);
                    ctx.fill();

                    // 거리 뱃지 라벨
                    const mx = (sp1.x + sp2.x) / 2;
                    const my = (sp1.y + sp2.y) / 2;
                    drawMeasureBadge(ctx, `${m.distanceM} m`, mx, my);
                } else if (m.type === 'area') {
                    if (!m.points || m.points.length < 3) return;
                    const screenPts = m.points.map(toScreen);

                    ctx.beginPath();
                    ctx.moveTo(screenPts[0].x, screenPts[0].y);
                    for (let i = 1; i < screenPts.length; i++) {
                        ctx.lineTo(screenPts[i].x, screenPts[i].y);
                    }
                    ctx.closePath();
                    ctx.fillStyle = hexToRgba(m.color, 0.22);
                    ctx.fill();
                    ctx.strokeStyle = m.color;
                    ctx.lineWidth = 2.5;
                    ctx.setLineDash([6, 3]);
                    ctx.stroke();
                    ctx.setLineDash([]);

                    screenPts.forEach(pt => {
                        ctx.fillStyle = m.color;
                        ctx.beginPath();
                        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
                        ctx.fill();
                    });

                    // 면적 뱃지 라벨 (무게중심)
                    let cx = 0, cy = 0;
                    screenPts.forEach(p => { cx += p.x; cy += p.y; });
                    cx /= screenPts.length;
                    cy /= screenPts.length;
                    drawMeasureBadge(ctx, `📐 ${m.areaSqM} ㎡ (${m.pyeong}평)`, cx, cy);
                }
            });

            // 3. 현재 측정 진행 중 러버밴드 미리보기
            if (freehandSubTool === 'distance' && activeMeasurePoints.length > 0 && freehandHoverPos) {
                const lastPt = activeMeasurePoints[activeMeasurePoints.length - 1];
                const sp1 = toScreen(lastPt);
                const sp2 = toScreen(freehandHoverPos);

                ctx.beginPath();
                ctx.strokeStyle = freehandColor;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.moveTo(sp1.x, sp1.y);
                ctx.lineTo(sp2.x, sp2.y);
                ctx.stroke();
                ctx.setLineDash([]);

                const dMap = Math.hypot(freehandHoverPos.x - lastPt.x, freehandHoverPos.y - lastPt.y);
                const distanceM = (dMap * getScaleSettings().metersPerPixel).toFixed(2);
                drawMeasureBadge(ctx, `${distanceM} m`, (sp1.x + sp2.x) / 2, (sp1.y + sp2.y) / 2);
            } else if (freehandSubTool === 'area' && activeMeasurePoints.length > 0) {
                const screenPts = activeMeasurePoints.map(toScreen);
                ctx.beginPath();
                ctx.strokeStyle = freehandColor;
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 4]);
                ctx.moveTo(screenPts[0].x, screenPts[0].y);
                for (let i = 1; i < screenPts.length; i++) {
                    ctx.lineTo(screenPts[i].x, screenPts[i].y);
                }
                if (freehandHoverPos) {
                    const spHover = toScreen(freehandHoverPos);
                    ctx.lineTo(spHover.x, spHover.y);
                    ctx.lineTo(screenPts[0].x, screenPts[0].y);
                }
                ctx.stroke();
                ctx.setLineDash([]);

                screenPts.forEach((pt, idx) => {
                    ctx.fillStyle = idx === 0 ? '#10b981' : freehandColor;
                    ctx.beginPath();
                    ctx.arc(pt.x, pt.y, idx === 0 ? 5 : 3.5, 0, Math.PI * 2);
                    ctx.fill();
                });
            }

            ctx.restore();
        }

        function drawMeasureBadge(ctx, text, x, y) {
            ctx.font = 'bold 12px Pretendard, sans-serif';
            const metrics = ctx.measureText(text);
            const padX = 8;
            const padY = 4;
            const w = metrics.width + padX * 2;
            const h = 22;
            const rx = x - w / 2;
            const ry = y - h / 2;

            ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(rx, ry, w, h, 6) : ctx.rect(rx, ry, w, h);
            ctx.fill();

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, y);
        }

        function exportFreehandImage() {
            const canvas = document.getElementById('freehand-canvas');
            const floor = FLOORS[currentFloorIdx];
            showToast('도면과 필기/측정 내용을 결합하여 이미지 저장 중...', 1500);

            const compCanvas = document.createElement('canvas');
            const dpr = window.devicePixelRatio || 1;
            compCanvas.width = viewport.clientWidth * dpr;
            compCanvas.height = viewport.clientHeight * dpr;
            const compCtx = compCanvas.getContext('2d');
            compCtx.scale(dpr, dpr);

            compCtx.fillStyle = '#f0f4f9';
            compCtx.fillRect(0, 0, viewport.clientWidth, viewport.clientHeight);

            const svgEl = mapContainer.querySelector('svg');
            if (!svgEl) return;
            const svgCopy = svgEl.cloneNode(true);
            const serializer = new XMLSerializer();
            const svgStr = serializer.serializeToString(svgCopy);
            const img = new Image();
            const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(blob);

            img.onload = () => {
                compCtx.save();
                compCtx.translate(panX, panY);
                compCtx.scale(scale, scale);
                compCtx.drawImage(img, 0, 0);
                compCtx.restore();

                if (canvas) {
                    compCtx.drawImage(canvas, 0, 0, viewport.clientWidth, viewport.clientHeight);
                }

                URL.revokeObjectURL(url);

                compCanvas.toBlob(outBlob => {
                    if (!outBlob) return;
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(outBlob);
                    a.download = `도면메모_${floor.name}_${new Date().toISOString().slice(0,10)}.png`;
                    a.click();
                    showToast('도면 메모 이미지가 저장되었습니다.', 1500);
                }, 'image/png');
            };
            img.src = url;
        }
