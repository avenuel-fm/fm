/**
 * app.js
 * 열화상 리포트 자동 작성기 프론트엔드 통합 앱
 * - 개선안 1: 템플릿 로드 Fallback (CORS/file:// 대응 & IndexedDB 캐싱)
 * - 개선안 2: 스팟 자동 보정 드롭다운
 *     1) 🎯 학습된 위치로 설정 (기존 학습 파일 기반 최적 좌표 적용)
 *     2) 🔥 최고온도(Max Spot) 탐색 (상·하 가이드라인 ROI 제한구역 내 자동 탐색)
 *     3) ↔ 3상(R·S·T) 수평 자동 정렬
 * - 학습 고도화: 예제 사진 파일 일괄 업로드 및 누적 학습 관리
 * - 작성자·날짜 일괄 적용 및 영구 기억
 * - 사진별 개별 측정 위치/회로명 입력 및 키보드 1px 정밀 미세조정
 */

(function() {
    const DB_NAME = 'avenuel_thermal_db';
    const DB_VERSION = 1;
    const STORE_NAME = 'templates';

    const STORAGE_KEY_INSPECTOR = 'avenuel_thermal_last_inspector';
    const STORAGE_KEY_TITLE = 'avenuel_thermal_last_title';

    // 전역 상태
    const state = {
        bridge: null,
        templateUrl: "./master_template.atr",
        templateBuffer: null,
        pages: [],
        currentIndex: 0,
        selectedSpotIndex: 0,
        spotModel: new SpotModelManager(),

        // 상·하 가이드라인 상태 (0~240 픽셀 기준)
        guideline: {
            active: false,
            topY: 48,    // 상단 20%
            bottomY: 192 // 하단 80%
        },
        draggingGuideline: null
    };

    // DOM 캐시
    const DOM = {
        inpTitle: document.getElementById('inpTitle'),
        inpInspector: document.getElementById('inpInspector'),
        inpDate: document.getElementById('inpDate'),
        dropZone: document.getElementById('dropZone'),
        fileInput: document.getElementById('fileInput'),
        btnReset: document.getElementById('btnReset'),
        btnPrint: document.getElementById('btnPrint'),
        btnModelModal: document.getElementById('btnModelModal'),
        btnGenerateAtr: document.getElementById('btnGenerateAtr'),
        templateFallbackBanner: document.getElementById('templateFallbackBanner'),
        btnSelectTemplate: document.getElementById('btnSelectTemplate'),
        templateFileInput: document.getElementById('templateFileInput'),
        reportLayout: document.getElementById('reportLayout'),
        sidebarList: document.getElementById('sidebarList'),
        pageCountBadge: document.getElementById('pageCountBadge'),
        inpCircuitName: document.getElementById('inpCircuitName'),
        btnDeletePage: document.getElementById('btnDeletePage'),
        dropdownSpotCorrection: document.getElementById('dropdownSpotCorrection'),
        btnSpotCorrectionMenu: document.getElementById('btnSpotCorrectionMenu'),
        btnMenuLearnedSpot: document.getElementById('btnMenuLearnedSpot'),
        btnMenuMaxSpot: document.getElementById('btnMenuMaxSpot'),
        btnMenuAlignHorizontal: document.getElementById('btnMenuAlignHorizontal'),
        imgVisual: document.getElementById('imgVisual'),
        imgThermal: document.getElementById('imgThermal'),
        thermalFrame: document.getElementById('thermalFrame'),
        guidelineNotice: document.getElementById('guidelineNotice'),
        guidelineTop: document.getElementById('guidelineTop'),
        guidelineBottom: document.getElementById('guidelineBottom'),
        guidelineMaskTop: document.getElementById('guidelineMaskTop'),
        guidelineMaskBottom: document.getElementById('guidelineMaskBottom'),
        handleTop: document.getElementById('handleTop'),
        handleBottom: document.getElementById('handleBottom'),
        markers: [
            document.getElementById('marker1'),
            document.getElementById('marker2'),
            document.getElementById('marker3')
        ],
        labels: [
            document.getElementById('label1'),
            document.getElementById('label2'),
            document.getElementById('label3')
        ],
        tblSp1: document.getElementById('tblSp1'),
        tblSp2: document.getElementById('tblSp2'),
        tblSp3: document.getElementById('tblSp3'),
        tblDeltaT: document.getElementById('tblDeltaT'),
        tblStatus: document.getElementById('tblStatus'),
        modalModel: document.getElementById('modalModel'),
        trainingDropzone: document.getElementById('trainingDropzone'),
        trainingFileInput: document.getElementById('trainingFileInput'),
        trainingProgress: document.getElementById('trainingProgress'),
        patternCount: document.getElementById('patternCount'),
        patternsTableBody: document.getElementById('patternsTableBody'),
        btnLearnCurrent: document.getElementById('btnLearnCurrent'),
        btnResetModel: document.getElementById('btnResetModel'),
        btnCloseModal: document.getElementById('btnCloseModal')
    };

    /**
     * 앱 초기화
     */
    async function init() {
        state.bridge = (window.parent && window.parent.WS_THERMAL) || window.WS_THERMAL;

        // 점검일자 기본값: 오늘
        const today = new Date().toISOString().split('T')[0];
        DOM.inpDate.value = today;

        // 로컬에 기억된 작성자 / 제목 불러오기
        const savedInspector = localStorage.getItem(STORAGE_KEY_INSPECTOR);
        if (savedInspector) DOM.inpInspector.value = savedInspector;

        const savedTitle = localStorage.getItem(STORAGE_KEY_TITLE);
        if (savedTitle) DOM.inpTitle.value = savedTitle;

        if (state.bridge) {
            try {
                const me = await state.bridge.me();
                if (me && me.name && !savedInspector) {
                    DOM.inpInspector.value = me.name;
                }

                const bootInfo = await state.bridge.boot();
                if (bootInfo) {
                    if (bootInfo.template_url) state.templateUrl = bootInfo.template_url;
                    if (bootInfo.model) state.spotModel.load(bootInfo.model);
                }
            } catch (e) {
                console.warn('Bridge init error:', e);
            }
        }

        // 템플릿 로드 & IndexedDB 캐시 시도
        await loadTemplateWithFallback();

        bindEvents();
    }

    /**
     * [개선 1] 템플릿 로드 및 IndexedDB 캐시
     */
    async function loadTemplateWithFallback() {
        try {
            const resp = await fetch(state.templateUrl);
            if (resp.ok) {
                state.templateBuffer = await resp.arrayBuffer();
                await saveTemplateToDb(state.templateBuffer);
                return;
            }
        } catch (e) {
            console.warn('Direct fetch failed (likely file:// or CORS):', e);
        }

        const cached = await getTemplateFromDb();
        if (cached) {
            state.templateBuffer = cached;
            console.log('Loaded template from IndexedDB cache');
            return;
        }

        DOM.templateFallbackBanner.classList.add('active');
    }

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                req.result.createObjectStore(STORE_NAME);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveTemplateToDb(buffer) {
        try {
            const db = await openDb();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(buffer, 'master_template');
        } catch (e) {}
    }

    async function getTemplateFromDb() {
        try {
            const db = await openDb();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const req = tx.objectStore(STORE_NAME).get('master_template');
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => resolve(null);
            });
        } catch (e) {
            return null;
        }
    }

    /**
     * 이벤트 바인딩
     */
    function bindEvents() {
        // 작성자·제목 변경 시 자동 기억 (다음 실행 시 일괄 유지)
        DOM.inpInspector.addEventListener('input', (e) => {
            localStorage.setItem(STORAGE_KEY_INSPECTOR, e.target.value.trim());
        });
        DOM.inpTitle.addEventListener('input', (e) => {
            localStorage.setItem(STORAGE_KEY_TITLE, e.target.value.trim());
        });

        // 드롭존 & 파일 인풋
        DOM.dropZone.addEventListener('click', () => DOM.fileInput.click());
        DOM.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            DOM.dropZone.classList.add('dragover');
        });
        DOM.dropZone.addEventListener('dragleave', () => DOM.dropZone.classList.remove('dragover'));
        DOM.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            DOM.dropZone.classList.remove('dragover');
            if (e.dataTransfer.files) handleFiles(Array.from(e.dataTransfer.files));
        });
        DOM.fileInput.addEventListener('change', (e) => {
            if (e.target.files) handleFiles(Array.from(e.target.files));
        });

        // 템플릿 수동 선택
        DOM.btnSelectTemplate.addEventListener('click', () => DOM.templateFileInput.click());
        DOM.templateFileInput.addEventListener('change', async (e) => {
            if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                const buf = await file.arrayBuffer();
                state.templateBuffer = buf;
                await saveTemplateToDb(buf);
                DOM.templateFallbackBanner.classList.remove('active');
                // 업무지원 통로가 있으면 양식을 서버에도 올려 다른 기기에서도 쓰게 함 (결정 168). 공개 저장소에는 양식 파일을 두지 않음
                let shared = '';
                if (state.bridge && state.bridge.upload && state.bridge.saveTemplate) {
                    try {
                        const up = await state.bridge.upload(file, file.name);
                        await state.bridge.saveTemplate({ path: up.path, url: up.url, name: file.name });
                        shared = ' 다른 기기에서도 쓸 수 있게 서버에 올렸습니다.';
                    } catch (err) { shared = ' (서버에는 올리지 못했습니다: ' + err.message + ')'; }
                }
                alert('양식 파일이 성공적으로 등록되었습니다.' + shared);
            }
        });

        // 사진별 개별 측정 위치 / 회로명 변경
        DOM.inpCircuitName.addEventListener('input', (e) => {
            const page = state.pages[state.currentIndex];
            if (page) {
                page.circuit_name = e.target.value.trim();
                renderSidebar();
            }
        });

        // 현재 쪽 삭제
        DOM.btnDeletePage.addEventListener('click', () => {
            if (state.pages.length === 0) return;
            state.pages.splice(state.currentIndex, 1);
            state.currentIndex = Math.max(0, Math.min(state.currentIndex, state.pages.length - 1));
            if (state.pages.length === 0) resetApp();
            else selectPage(state.currentIndex);
        });

        // 새 문서 (초기화)
        DOM.btnReset.addEventListener('click', () => {
            if (confirm('현재 작업 중인 사진들을 초기화하고 새 문서를 만드시겠습니까? (작성자 및 점검일자는 유지됩니다)')) {
                resetApp();
            }
        });

        // 인쇄 / PDF 출력
        DOM.btnPrint.addEventListener('click', () => {
            window.print();
        });

        // 드롭다운 메뉴 토글
        DOM.btnSpotCorrectionMenu.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.dropdownSpotCorrection.classList.toggle('open');
        });
        window.addEventListener('click', () => {
            DOM.dropdownSpotCorrection.classList.remove('open');
        });

        // [개선안 2 - 옵션 1]: 🎯 학습된 위치로 설정
        DOM.btnMenuLearnedSpot.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.dropdownSpotCorrection.classList.remove('open');
            applyLearnedSpotsToCurrentPage();
        });

        // [개선안 2 - 옵션 2]: 🔥 최고온도(Max Spot) 탐색
        DOM.btnMenuMaxSpot.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.dropdownSpotCorrection.classList.remove('open');
            toggleMaxSpotGuideline();
        });

        // [개선안 2 - 옵션 3]: ↔ 3상 수평 자동 정렬
        DOM.btnMenuAlignHorizontal.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.dropdownSpotCorrection.classList.remove('open');
            alignSpotsHorizontal();
        });

        // 상·하 가이드라인 드래그 설정
        setupGuidelineDrag();

        // 스팟 마커 마우스 드래그 & 터치
        setupMarkerDrag();

        // 키보드 방향키 정밀 이동 (1px / 5px)
        setupKeyboardMove();

        // 스팟 학습 관리 모달
        DOM.btnModelModal.addEventListener('click', () => {
            renderPatternsTable();
            DOM.modalModel.classList.add('active');
        });
        DOM.btnCloseModal.addEventListener('click', () => DOM.modalModel.classList.remove('active'));

        // 학습용 예제 파일 업로드 (드래그 & 선택)
        DOM.trainingDropzone.addEventListener('click', () => DOM.trainingFileInput.click());
        DOM.trainingFileInput.addEventListener('change', async (e) => {
            if (e.target.files && e.target.files.length > 0) {
                await processTrainingFiles(Array.from(e.target.files));
            }
        });
        DOM.trainingDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            DOM.trainingDropzone.style.borderColor = 'var(--navy)';
        });
        DOM.trainingDropzone.addEventListener('dragleave', () => {
            DOM.trainingDropzone.style.borderColor = 'var(--line)';
        });
        DOM.trainingDropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            DOM.trainingDropzone.style.borderColor = 'var(--line)';
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                await processTrainingFiles(Array.from(e.dataTransfer.files));
            }
        });

        // 현재 페이지 수동 미세조정 좌표 학습
        DOM.btnLearnCurrent.addEventListener('click', async () => {
            const page = state.pages[state.currentIndex];
            if (!page) return alert('학습할 사진 페이지가 없습니다.');
            state.spotModel.learn(page.circuit_name, page.spots);
            if (state.bridge && state.bridge.saveModel) {
                await state.bridge.saveModel(state.spotModel.export());
            }
            renderPatternsTable();
            alert(`[${page.circuit_name}] 위치에 대한 스팟 좌표가 학습되었습니다.`);
        });

        // 학습 모델 초기화
        DOM.btnResetModel.addEventListener('click', async () => {
            if (confirm('학습된 모든 위치 패턴을 초기화하시겠습니까?')) {
                state.spotModel = new SpotModelManager();
                if (state.bridge && state.bridge.saveModel) {
                    await state.bridge.saveModel(state.spotModel.export());
                }
                renderPatternsTable();
                alert('학습 모델이 초기화되었습니다.');
            }
        });

        // 리포트(.atr) 생성 및 다운로드
        DOM.btnGenerateAtr.addEventListener('click', generateAtrReport);
    }

    /**
     * [개선안 2 - 옵션 1] 현재 페이지에 학습된 스팟 좌표 적용
     */
    function applyLearnedSpotsToCurrentPage() {
        const page = state.pages[state.currentIndex];
        if (!page) return;

        const predicted = state.spotModel.predict(page.circuit_name, page.fileName);
        for (let i = 0; i < 3; i++) {
            page.spots[i].x = predicted[i].x;
            page.spots[i].y = predicted[i].y;
            page.spots[i].temp = page.calculator.getTempAt(predicted[i].x, predicted[i].y);
        }

        updateMarkerPositions(page);
        updateTempTable(page);
        renderSidebar();
    }

    /**
     * 학습용 예제 파일 일괄 분석 및 모델 고도화
     */
    async function processTrainingFiles(files) {
        const valid = files.filter(f => /\.(jpe?g)$/i.test(f.name));
        if (valid.length === 0) return alert('열화상 사진(.jpg) 파일을 선택해 주세요.');

        DOM.trainingProgress.style.display = 'block';
        DOM.trainingProgress.textContent = `학습 분석 시작 (0 / ${valid.length})...`;

        const learned = await state.spotModel.trainFromFiles(valid, (curr, total, name) => {
            DOM.trainingProgress.textContent = `학습 분석 중 (${curr} / ${total}): ${name}...`;
        });

        if (state.bridge && state.bridge.saveModel) {
            await state.bridge.saveModel(state.spotModel.export());
        }

        DOM.trainingProgress.textContent = `학습 완료: ${valid.length}장 중 스팟이 포함된 ${learned}장의 위치 데이터를 누적 학습했습니다.`;
        renderPatternsTable();
        alert(`학습 완료!\n총 ${valid.length}개 파일 중 스팟 좌표가 있는 ${learned}개 사진의 위치 패턴을 성공적으로 반영하여 고도화했습니다.`);
    }

    /**
     * 학습된 패턴 목록 테이블 렌더링
     */
    function renderPatternsTable() {
        const list = state.spotModel.getPatternsList();
        DOM.patternCount.textContent = list.length;

        if (list.length === 0) {
            DOM.patternsTableBody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--text-sub); padding: 12px;">
                        등록된 학습 패턴이 없습니다. 예제 사진을 추가하거나 현재 위치를 등록해 주세요.
                    </td>
                </tr>
            `;
            return;
        }

        DOM.patternsTableBody.innerHTML = list.map(item => `
            <tr>
                <td><b>${escapeHtml(item.label)}</b></td>
                <td>${item.count}회</td>
                <td>(${item.spots[0].x}, ${item.spots[0].y})</td>
                <td>(${item.spots[1].x}, ${item.spots[1].y})</td>
                <td>(${item.spots[2].x}, ${item.spots[2].y})</td>
            </tr>
        `).join('');
    }

    /**
     * 파일 목록 처리 (사진별 개별 위치명 초기화)
     */
    async function handleFiles(files) {
        const validFiles = files.filter(f => /\.(jpe?g)$/i.test(f.name));
        if (validFiles.length === 0) {
            return alert('열화상 JPEG 사진 파일(.jpg, .jpeg)만 지원합니다.');
        }

        if (state.pages.length + validFiles.length > 8) {
            alert('열화상 리포트는 한 번에 최대 8장까지만 작성할 수 있습니다. 8장까지만 추가됩니다.');
        }
        const availableSlots = 8 - state.pages.length;
        const toProcess = validFiles.slice(0, availableSlots);

        DOM.dropZone.style.display = 'none';
        DOM.reportLayout.style.display = 'grid';

        for (const file of toProcess) {
            try {
                const parsed = await FlirParser.parse(file);
                let circuitName = file.name.replace(/\.[^/.]+$/, "");
                if (circuitName.includes('_')) {
                    const parts = circuitName.split('_');
                    circuitName = parts[parts.length - 1];
                }

                // 학습된 스팟 모델 패턴이 있고 원본에 스팟이 없었다면 예측 위치 적용
                if (!parsed.hasNativeSpots) {
                    const predicted = state.spotModel.predict(circuitName, file.name);
                    for (let i = 0; i < 3; i++) {
                        parsed.spots[i].x = predicted[i].x;
                        parsed.spots[i].y = predicted[i].y;
                        parsed.spots[i].temp = parsed.calculator.getTempAt(predicted[i].x, predicted[i].y);
                    }
                }

                parsed.circuit_name = circuitName;
                state.pages.push(parsed);
            } catch (err) {
                console.error('File parse error for', file.name, err);
                alert(`파일(${file.name}) 처리 중 오류: ${err.message}`);
            }
        }

        if (state.pages.length > 0) {
            DOM.btnGenerateAtr.disabled = false;
            selectPage(state.pages.length - 1);
        }
    }

    /**
     * 특정 쪽 선택 및 화면 표시
     */
    function selectPage(index) {
        if (index < 0 || index >= state.pages.length) return;
        state.currentIndex = index;
        const page = state.pages[index];

        DOM.inpCircuitName.value = page.circuit_name;
        DOM.imgVisual.src = page.visualUrl || page.thermalUrl;
        DOM.imgThermal.src = page.thermalUrl;

        updateMarkerPositions(page);
        updateTempTable(page);
        renderSidebar();

        if (state.guideline.active) {
            renderGuidelines();
            runMaxSpotSearch(page);
        }
    }

    /**
     * 사이드바 목록 렌더링
     */
    function renderSidebar() {
        DOM.sidebarList.innerHTML = '';
        DOM.pageCountBadge.textContent = `${state.pages.length} / 8`;

        state.pages.forEach((page, idx) => {
            const item = document.createElement('div');
            item.className = `sidebar-item ${idx === state.currentIndex ? 'active' : ''}`;
            item.addEventListener('click', () => selectPage(idx));

            const maxT = Math.max(page.spots[0].temp, page.spots[1].temp, page.spots[2].temp);
            const minT = Math.min(page.spots[0].temp, page.spots[1].temp, page.spots[2].temp);
            const deltaT = Math.round((maxT - minT) * 10) / 10;
            const isWarn = deltaT >= 5.0;

            item.innerHTML = `
                <img class="sidebar-thumb" src="${page.thermalUrl}" alt="썸네일">
                <div class="sidebar-info">
                    <span class="sidebar-name">#${idx + 1} ${escapeHtml(page.circuit_name)}</span>
                    <span class="sidebar-status">ΔT ${deltaT.toFixed(1)}°C (${isWarn ? '요주의' : '정상'})</span>
                </div>
            `;
            DOM.sidebarList.appendChild(item);
        });
    }

    /**
     * 스팟 마커 위치 업데이트
     */
    function updateMarkerPositions(page) {
        page.spots.forEach((sp, idx) => {
            const pctX = (sp.x / 320) * 100;
            const pctY = (sp.y / 240) * 100;
            const marker = DOM.markers[idx];
            marker.style.left = `${pctX}%`;
            marker.style.top = `${pctY}%`;

            if (idx === state.selectedSpotIndex) marker.classList.add('selected');
            else marker.classList.remove('selected');

            DOM.labels[idx].textContent = `Sp${idx + 1}: ${sp.temp.toFixed(1)}°C`;
        });
    }

    /**
     * 온도 요약 표 업데이트
     */
    function updateTempTable(page) {
        const t1 = page.spots[0].temp;
        const t2 = page.spots[1].temp;
        const t3 = page.spots[2].temp;

        DOM.tblSp1.textContent = `${t1.toFixed(1)} °C`;
        DOM.tblSp2.textContent = `${t2.toFixed(1)} °C`;
        DOM.tblSp3.textContent = `${t3.toFixed(1)} °C`;

        const maxT = Math.max(t1, t2, t3);
        const minT = Math.min(t1, t2, t3);
        const deltaT = Math.round((maxT - minT) * 10) / 10;

        DOM.tblDeltaT.textContent = `${deltaT.toFixed(1)} °C`;

        if (deltaT >= 5.0) {
            DOM.tblStatus.className = 'state-badge state-warn';
            DOM.tblStatus.textContent = '요주의';
        } else {
            DOM.tblStatus.className = 'state-badge state-normal';
            DOM.tblStatus.textContent = '정상';
        }
    }

    /**
     * [개선안 2 - 옵션 2] 최고온도(Max Spot) 상·하 가이드라인 토글
     */
    function toggleMaxSpotGuideline() {
        state.guideline.active = !state.guideline.active;

        if (state.guideline.active) {
            DOM.guidelineNotice.style.display = 'inline';
            DOM.guidelineTop.classList.add('active');
            DOM.guidelineBottom.classList.add('active');
            DOM.guidelineMaskTop.classList.add('active');
            DOM.guidelineMaskBottom.classList.add('active');
            renderGuidelines();

            const page = state.pages[state.currentIndex];
            if (page) runMaxSpotSearch(page);
        } else {
            DOM.guidelineNotice.style.display = 'none';
            DOM.guidelineTop.classList.remove('active');
            DOM.guidelineBottom.classList.remove('active');
            DOM.guidelineMaskTop.classList.remove('active');
            DOM.guidelineMaskBottom.classList.remove('active');
        }
    }

    /**
     * 가이드라인 위치 렌더링
     */
    function renderGuidelines() {
        const topPct = (state.guideline.topY / 240) * 100;
        const botPct = (state.guideline.bottomY / 240) * 100;

        DOM.guidelineTop.style.top = `${topPct}%`;
        DOM.guidelineBottom.style.top = `${botPct}%`;

        DOM.guidelineMaskTop.style.top = '0';
        DOM.guidelineMaskTop.style.height = `${topPct}%`;

        DOM.guidelineMaskBottom.style.top = `${botPct}%`;
        DOM.guidelineMaskBottom.style.height = `${100 - botPct}%`;

        DOM.handleTop.textContent = `상단 가이드 (Y: ${Math.round(state.guideline.topY)}px)`;
        DOM.handleBottom.textContent = `하단 가이드 (Y: ${Math.round(state.guideline.bottomY)}px)`;
    }

    /**
     * 가이드라인 내 최고온도 탐색 실행
     */
    function runMaxSpotSearch(page) {
        if (!page || !page.calculator) return;

        const maxSpot = page.calculator.findMaxSpot(state.guideline.topY, state.guideline.bottomY);

        const targetSpot = page.spots[state.selectedSpotIndex];
        targetSpot.x = maxSpot.x;
        targetSpot.y = maxSpot.y;
        targetSpot.temp = maxSpot.temp;

        updateMarkerPositions(page);
        updateTempTable(page);
        renderSidebar();
    }

    /**
     * 가이드라인 상·하 드래그 이벤트
     */
    function setupGuidelineDrag() {
        const onPointerDown = (e, which) => {
            e.preventDefault();
            e.stopPropagation();
            state.draggingGuideline = which;
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        };

        const onPointerMove = (e) => {
            if (!state.draggingGuideline) return;
            const rect = DOM.thermalFrame.getBoundingClientRect();
            let clickY = e.clientY - rect.top;
            clickY = Math.max(0, Math.min(rect.height, clickY));

            const imgY = (clickY / rect.height) * 240;

            if (state.draggingGuideline === 'top') {
                state.guideline.topY = Math.min(imgY, state.guideline.bottomY - 10);
            } else if (state.draggingGuideline === 'bottom') {
                state.guideline.bottomY = Math.max(imgY, state.guideline.topY + 10);
            }

            renderGuidelines();

            const page = state.pages[state.currentIndex];
            if (page) runMaxSpotSearch(page);
        };

        const onPointerUp = () => {
            state.draggingGuideline = null;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };

        DOM.guidelineTop.addEventListener('pointerdown', (e) => onPointerDown(e, 'top'));
        DOM.guidelineBottom.addEventListener('pointerdown', (e) => onPointerDown(e, 'bottom'));
    }

    /**
     * [개선안 2 - 옵션 3] 3상(R·S·T) 수평 자동 정렬
     */
    function alignSpotsHorizontal() {
        const page = state.pages[state.currentIndex];
        if (!page) return;

        const avgY = (page.spots[0].y + page.spots[1].y + page.spots[2].y) / 3;

        const minX = Math.min(page.spots[0].x, page.spots[2].x);
        const maxX = Math.max(page.spots[0].x, page.spots[2].x);
        const midX = (minX + maxX) / 2;

        page.spots[0].x = minX;
        page.spots[0].y = avgY;
        page.spots[0].temp = page.calculator.getTempAt(minX, avgY);

        page.spots[1].x = midX;
        page.spots[1].y = avgY;
        page.spots[1].temp = page.calculator.getTempAt(midX, avgY);

        page.spots[2].x = maxX;
        page.spots[2].y = avgY;
        page.spots[2].temp = page.calculator.getTempAt(maxX, avgY);

        updateMarkerPositions(page);
        updateTempTable(page);
        renderSidebar();
    }

    /**
     * 마커 드래그 (마우스 및 모바일 터치)
     */
    function setupMarkerDrag() {
        let draggingSpotIndex = -1;

        const onPointerDown = (e) => {
            const marker = e.target.closest('.spot-marker');
            if (!marker) return;
            e.preventDefault();

            draggingSpotIndex = parseInt(marker.dataset.spot, 10);
            state.selectedSpotIndex = draggingSpotIndex;

            const page = state.pages[state.currentIndex];
            if (page) updateMarkerPositions(page);

            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
        };

        const onPointerMove = (e) => {
            if (draggingSpotIndex < 0) return;
            const page = state.pages[state.currentIndex];
            if (!page) return;

            const rect = DOM.thermalFrame.getBoundingClientRect();
            let clickX = e.clientX - rect.left;
            let clickY = e.clientY - rect.top;

            clickX = Math.max(0, Math.min(rect.width, clickX));
            clickY = Math.max(0, Math.min(rect.height, clickY));

            const imgX = (clickX / rect.width) * 320;
            const imgY = (clickY / rect.height) * 240;

            const spot = page.spots[draggingSpotIndex];
            spot.x = imgX;
            spot.y = imgY;
            spot.temp = page.calculator.getTempAt(imgX, imgY);

            updateMarkerPositions(page);
            updateTempTable(page);
        };

        const onPointerUp = () => {
            draggingSpotIndex = -1;
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            renderSidebar();
        };

        DOM.thermalFrame.addEventListener('pointerdown', onPointerDown);
    }

    /**
     * 키보드 방향키 정밀 이동 (1px / Shift 5px)
     */
    function setupKeyboardMove() {
        window.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

                const page = state.pages[state.currentIndex];
                if (!page) return;

                e.preventDefault();
                const step = e.shiftKey ? 5 : 1;
                const spot = page.spots[state.selectedSpotIndex];

                if (e.key === 'ArrowUp') spot.y = Math.max(0, spot.y - step);
                else if (e.key === 'ArrowDown') spot.y = Math.min(239, spot.y + step);
                else if (e.key === 'ArrowLeft') spot.x = Math.max(0, spot.x - step);
                else if (e.key === 'ArrowRight') spot.x = Math.min(319, spot.x + step);

                spot.temp = page.calculator.getTempAt(spot.x, spot.y);
                updateMarkerPositions(page);
                updateTempTable(page);
                renderSidebar();
            }
        });
    }

    /**
     * 리포트(.atr) 생성 및 다운로드
     */
    async function generateAtrReport() {
        if (state.pages.length === 0) return alert('작성할 열화상 사진이 없습니다.');

        const title = DOM.inpTitle.value.trim() || '열화상점검리포트';
        const inspector = DOM.inpInspector.value.trim() || '측정자';
        const date = DOM.inpDate.value.trim();

        DOM.btnGenerateAtr.disabled = true;
        DOM.btnGenerateAtr.textContent = '리포트(.atr) 생성 중...';

        try {
            for (const page of state.pages) {
                page.patchedBlob = page.patchSpots(page.spots);
            }

            const result = await AtrGenerator.build({
                reportTitle: title,
                inspectorName: inspector,
                inspectDate: date,
                circuitItems: state.pages,
                templateUrl: state.templateUrl,
                templateBuffer: state.templateBuffer
            });

            // 1. 브라우저 PC 다운로드
            const downloadUrl = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = result.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // 2. 업무지원 상위 앱에 통로를 통해 보고서 기록 남김
            if (state.bridge) {
                try {
                    let uploadRes = { path: `local://${result.fileName}` };
                    if (state.bridge.upload) {
                        uploadRes = await state.bridge.upload(result.blob, result.fileName);
                    }

                    let maxDt = 0;
                    for (const p of state.pages) {
                        const dt = Math.max(p.spots[0].temp, p.spots[1].temp, p.spots[2].temp) -
                                   Math.min(p.spots[0].temp, p.spots[1].temp, p.spots[2].temp);
                        if (dt > maxDt) maxDt = dt;
                    }

                    if (state.bridge.saveReport) {
                        await state.bridge.saveReport({
                            title: title,
                            inspector: inspector,
                            date: date,
                            path: uploadRes.path || '',
                            pages: result.pages,
                            max_dt: Math.round(maxDt * 10) / 10
                        });
                    }
                } catch (bridgeErr) {
                    console.warn('Bridge report logging error:', bridgeErr);
                }
            }

            alert(`리포트(${result.fileName})가 성공적으로 생성되어 PC로 다운로드되었습니다! (${result.pages}쪽)`);
        } catch (err) {
            console.error('Report build error:', err);
            alert(`리포트 생성 중 오류: ${err.message}`);
        } finally {
            DOM.btnGenerateAtr.disabled = false;
            DOM.btnGenerateAtr.textContent = '리포트(.atr) 생성 및 다운로드';
        }
    }

    function resetApp() {
        state.pages = [];
        state.currentIndex = 0;
        state.selectedSpotIndex = 0;
        DOM.fileInput.value = '';
        DOM.dropZone.style.display = 'block';
        DOM.reportLayout.style.display = 'none';
        DOM.btnGenerateAtr.disabled = true;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
