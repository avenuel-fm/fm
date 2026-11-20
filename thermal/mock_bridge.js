/**
 * mock_bridge.js
 * 부모 창(업무지원 앱)이 없을 때 단독 실행을 지원하는 로컬 가짜 통로(브라우저 스토리지)
 */
(function() {
    const STORAGE_KEY_MODEL = 'avenuel_thermal_learned_model';
    const STORAGE_KEY_REPORTS = 'avenuel_thermal_saved_reports';

    // 기본 스팟 모델 (3상 기본 위치)
    const DEFAULT_MODEL = {
        "version": "1.0",
        "default": [
            { "x": 102, "y": 126 },
            { "x": 163, "y": 132 },
            { "x": 227, "y": 130 }
        ],
        "patterns": {}
    };

    const MockBridge = {
        isMock: true,

        async me() {
            return {
                name: "김시설",
                role: "admin"
            };
        },

        async boot() {
            let model = DEFAULT_MODEL;
            try {
                const stored = localStorage.getItem(STORAGE_KEY_MODEL);
                if (stored) {
                    model = JSON.parse(stored);
                }
            } catch (e) {
                console.warn('Failed to load model from localStorage:', e);
            }

            let reports = [];
            try {
                const storedReports = localStorage.getItem(STORAGE_KEY_REPORTS);
                if (storedReports) {
                    reports = JSON.parse(storedReports);
                }
            } catch (e) {
                console.warn('Failed to load reports from localStorage:', e);
            }

            return {
                model: model,
                template_url: "./master_template.atr",
                reports: reports
            };
        },

        async saveModel(model) {
            try {
                localStorage.setItem(STORAGE_KEY_MODEL, JSON.stringify(model));
                return { ok: true };
            } catch (e) {
                console.error('saveModel error:', e);
                return { ok: false, error: e.message };
            }
        },

        async upload(blob, name) {
            // 브라우저 로컬 Blob URL 생성
            const url = URL.createObjectURL(blob);
            const path = `local://thermal_reports/${Date.now()}_${name || 'report.pdf'}`;
            return {
                ok: true,
                path: path,
                url: url
            };
        },

        async toDrive(path, name) {
            console.log('[MockBridge] toDrive called for:', path, name);
            return {
                ok: true,
                url: `https://drive.google.com/mock_file_${Date.now()}`
            };
        },

        async saveReport(reportData) {
            // { title, inspector, date, path, pdf_path, pdf_url, drive_url, pages, max_dt }
            try {
                let reports = [];
                const stored = localStorage.getItem(STORAGE_KEY_REPORTS);
                if (stored) {
                    reports = JSON.parse(stored);
                }
                const id = 'rep_' + Date.now();
                const record = {
                    id: id,
                    ...reportData,
                    created_at: new Date().toISOString()
                };
                reports.unshift(record);
                if (reports.length > 50) reports = reports.slice(0, 50);
                localStorage.setItem(STORAGE_KEY_REPORTS, JSON.stringify(reports));
                return { ok: true, id: id };
            } catch (e) {
                console.error('saveReport error:', e);
                return { ok: false, error: e.message };
            }
        },

        async full(on) {
            if (on) {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen().catch(() => {});
                }
            } else {
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                }
            }
        }
    };

    // 부모 창에 WS_THERMAL 이 없거나 단독 실행 모드일 경우 연결
    if (!window.parent || window.parent === window || !window.parent.WS_THERMAL) {
        window.WS_THERMAL = MockBridge;
        if (!window.parent.WS_THERMAL) {
            try {
                window.parent.WS_THERMAL = MockBridge;
            } catch (e) {
                // Cross-origin iframe 등의 경우 무시
            }
        }
    }
})();
