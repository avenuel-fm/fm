/**
 * spot_model.js
 * 스팟 위치 학습 모델 관리자 (다중 샘플 누적 평균 & 정밀 학습)
 * - 파일명/회로명 패턴별 스팟 좌표 누적 학습 및 고도화
 * - 여러 예제 사진 일괄 분석을 통한 스팟 최적 위치 산출
 * - WS_THERMAL 통로 및 브라우저 스토리지 동기화
 */

class SpotModelManager {
    constructor() {
        this.model = {
            version: "2.0",
            default: [
                { x: 102, y: 126 },
                { x: 163, y: 132 },
                { x: 227, y: 130 }
            ],
            patterns: {} // key -> { count: N, spots: [{x, y}, {x, y}, {x, y}], label: string }
        };
    }

    load(modelData) {
        if (!modelData || typeof modelData !== 'object') return;

        if (modelData.default) this.model.default = modelData.default;

        if (modelData.patterns) {
            // 하위 호환성 (배열 형태 vs 객체 형태)
            for (const [k, v] of Object.entries(modelData.patterns)) {
                if (Array.isArray(v)) {
                    this.model.patterns[k] = {
                        count: 1,
                        spots: v,
                        label: k
                    };
                } else if (v && v.spots) {
                    this.model.patterns[k] = v;
                }
            }
        }
    }

    /**
     * 특정 회로명 또는 파일명에 대한 최적 스팟 좌표 예측
     */
    predict(circuitName, fileName) {
        const key = this.normalizeKey(circuitName) || this.normalizeKey(fileName);
        if (key && this.model.patterns && this.model.patterns[key]) {
            const entry = this.model.patterns[key];
            return JSON.parse(JSON.stringify(entry.spots));
        }

        // 유사 키 검색 (부분 일치)
        if (key && this.model.patterns) {
            for (const [k, entry] of Object.entries(this.model.patterns)) {
                if (key.includes(k) || k.includes(key)) {
                    return JSON.parse(JSON.stringify(entry.spots));
                }
            }
        }

        return JSON.parse(JSON.stringify(this.model.default));
    }

    /**
     * 단일 샘플 학습 (기존 데이터와 누적 가중 평균)
     */
    learn(circuitName, spots) {
        const key = this.normalizeKey(circuitName);
        if (!key || !spots || spots.length < 3) return;

        if (!this.model.patterns) this.model.patterns = {};

        const existing = this.model.patterns[key];
        if (existing && existing.count) {
            const n = existing.count;
            const newSpots = [];
            for (let i = 0; i < 3; i++) {
                // 누적 가중 평균 산출
                const avgX = (existing.spots[i].x * n + spots[i].x) / (n + 1);
                const avgY = (existing.spots[i].y * n + spots[i].y) / (n + 1);
                newSpots.push({ x: Math.round(avgX), y: Math.round(avgY) });
            }
            this.model.patterns[key] = {
                count: n + 1,
                spots: newSpots,
                label: circuitName.trim(),
                updatedAt: new Date().toISOString()
            };
        } else {
            this.model.patterns[key] = {
                count: 1,
                spots: [
                    { x: Math.round(spots[0].x), y: Math.round(spots[0].y) },
                    { x: Math.round(spots[1].x), y: Math.round(spots[1].y) },
                    { x: Math.round(spots[2].x), y: Math.round(spots[2].y) }
                ],
                label: circuitName.trim(),
                updatedAt: new Date().toISOString()
            };
        }
    }

    /**
     * 여러 예제 FLIR 파일로부터 일괄 학습 및 고도화
     */
    async trainFromFiles(files, progressCb = null) {
        let learnedCount = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            if (progressCb) progressCb(i + 1, files.length, file.name);

            try {
                const parsed = await FlirParser.parse(file);
                // 원본에 스팟이 있는 경우에만 학습에 반영
                if (parsed.hasNativeSpots) {
                    let circuitName = file.name.replace(/\.[^/.]+$/, "");
                    if (circuitName.includes('_')) {
                        const parts = circuitName.split('_');
                        circuitName = parts[parts.length - 1];
                    }
                    this.learn(circuitName, parsed.spots);
                    learnedCount++;
                }
            } catch (e) {
                console.warn('Skipping unparsable training file:', file.name, e);
            }
        }
        return learnedCount;
    }

    normalizeKey(name) {
        if (!name) return "";
        let clean = name.replace(/\.[^/.]+$/, "");
        clean = clean.replace(/_\d{8}_\d{6}/, "");
        clean = clean.replace(/\s+/g, "").toLowerCase();
        return clean;
    }

    getPatternsList() {
        const list = [];
        if (!this.model.patterns) return list;
        for (const [key, val] of Object.entries(this.model.patterns)) {
            list.push({
                key,
                label: val.label || key,
                count: val.count || 1,
                spots: val.spots,
                updatedAt: val.updatedAt || ''
            });
        }
        return list;
    }

    export() {
        return this.model;
    }
}

window.SpotModelManager = SpotModelManager;
