/**
 * spot_model.js
 * 스팟 위치 학습 모델 관리자 (다중 샘플 누적 평균 & 정밀 학습)
 * - 파일명/회로명 패턴별 스팟 좌표 누적 학습 및 고도화
 * - 여러 예제 사진(.jpg) 및 기존 Thermal Studio 보고서(.atr) 일괄 분석을 통한 최적 좌표 산출
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
     * 여러 예제 FLIR 파일(.jpg, .atr)로부터 일괄 학습 및 고도화
     */
    async trainFromFiles(files, progressCb = null) {
        let learnedCount = 0;
        let totalCount = 0;
        const failedFiles = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const isAtr = /\.atr$/i.test(file.name);
            const isJpg = /\.(jpe?g)$/i.test(file.name);

            if (!isAtr && !isJpg) continue;

            if (isAtr) {
                if (progressCb) progressCb(i + 1, files.length, `${file.name} (.atr 보고서 해제 중)`);
                try {
                    const data = (file instanceof Blob || typeof file.arrayBuffer === 'function') ? await file.arrayBuffer() : file;
                    const zip = await JSZip.loadAsync(data);
                    const binEntries = [];
                    zip.forEach((relPath, entry) => {
                        if (relPath.startsWith('cactus/') && !relPath.endsWith('_MT.bin') && !entry.dir) {
                            binEntries.push(entry);
                        }
                    });

                    let atrLearned = 0;
                    for (const entry of binEntries) {
                        try {
                            const bytes = await entry.async('uint8array');
                            if (bytes.length > 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
                                totalCount++;
                                const blob = new Blob([bytes], { type: 'image/jpeg' });
                                const parsed = await FlirParser.parse(blob);

                                if (parsed.hasNativeSpots) {
                                    let circuitName = entry.name.replace(/^cactus\//, '').replace(/\.bin$/i, '');
                                    const mtEntry = zip.file(`${entry.name.replace(/\.bin$/i, '')}_MT.bin`);
                                    if (mtEntry) {
                                        try {
                                            const mt = JSON.parse(await mtEntry.async('string'));
                                            if (mt.Title) circuitName = mt.Title;
                                            else if (mt.Name) circuitName = mt.Name;
                                        } catch (_) {}
                                    }
                                    if (circuitName.includes('_')) {
                                        const parts = circuitName.split('_');
                                        circuitName = parts[parts.length - 1];
                                    }
                                    this.learn(circuitName, parsed.spots);
                                    learnedCount++;
                                    atrLearned++;
                                } else {
                                    failedFiles.push(`${file.name}:${entry.name}`);
                                }
                            }
                        } catch (e) {
                            console.warn('ATR entry parse failed:', entry.name, e);
                        }
                    }

                    if (atrLearned === 0) {
                        failedFiles.push(`${file.name} (스팟 미발견)`);
                    }
                } catch (err) {
                    console.warn('ATR processing error:', file.name, err);
                    failedFiles.push(`${file.name} (압축 해제 실패: ${err.message})`);
                }
            } else {
                totalCount++;
                if (progressCb) progressCb(i + 1, files.length, file.name);
                try {
                    const parsed = await FlirParser.parse(file);
                    if (parsed.hasNativeSpots) {
                        let circuitName = file.name.replace(/\.[^/.]+$/, "");
                        if (circuitName.includes('_')) {
                            const parts = circuitName.split('_');
                            circuitName = parts[parts.length - 1];
                        }
                        this.learn(circuitName, parsed.spots);
                        learnedCount++;
                    } else {
                        failedFiles.push(file.name);
                    }
                } catch (e) {
                    console.warn('Skipping unparsable training file:', file.name, e);
                    failedFiles.push(`${file.name} (파싱 오류)`);
                }
            }
        }

        return {
            ok: learnedCount > 0,
            totalCount,
            learnedCount,
            failedFiles
        };
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
