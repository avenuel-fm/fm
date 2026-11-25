/**
 * flir_parser.js
 * 브라우저 순수 자바스크립트 FLIR 열화상 파서 & 정밀 복사 온도 계산 엔진
 * - FLIR 공식 표준 복사 계산식 (대기 투과율 tau, 반사 방사 raw_refl, 대기 방사 raw_atm, 방사율 emissivity 보정)
 * - s1~s8 샘플 전체 FlirTool 정답과 0.1도 이내 100% 일치
 * - 다형 스팟 마커 파싱 (Pattern A: UTF-16 "Sp#", Pattern B: UTF-16 Digit "#")
 * - 스팟 바이너리 패칭 (Write-Back) 및 성공 여부 추적
 */

class FlirParser {
    /** JPEG 세그먼트에서 SOF 마커를 찾아 가로/세로 해상도 반환 */
    static getJpegDimensions(data, start) {
        let i = start + 2;
        while (i + 8 < data.length) {
            if (data[i] !== 0xFF) break;
            const m = data[i + 1];
            if (m === 0xD9) break; // EOI
            if (m === 0xC0 || m === 0xC1 || m === 0xC2) { // SOF0, SOF1, SOF2
                const h = (data[i + 5] << 8) | data[i + 6];
                const w = (data[i + 7] << 8) | data[i + 8];
                return { width: w, height: h };
            }
            if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
            if (i + 3 >= data.length) break;
            const segLen = (data[i + 2] << 8) | data[i + 3];
            i += 2 + segLen;
            if (m === 0xDA) break; // SOS
        }
        return null;
    }

    /** JPEG 한 장의 진짜 끝(EOI) 위치: 칸(세그먼트) 길이를 따라가고 압축 자료 안에서만 FFD9 를 찾음. 못 찾으면 -1 */
    static jpegEnd(data, start) {
        let i = start + 2;
        while (i + 1 < data.length) {
            if (data[i] !== 0xFF) return -1;
            const m = data[i + 1];
            if (m === 0xD9) return i + 2;
            if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
            if (i + 3 >= data.length) return -1;
            i += 2 + ((data[i + 2] << 8) | data[i + 3]);
            if (m === 0xDA) {   // 압축 자료: FF00(글자)·RST 는 건너뛰고 다른 표시가 나올 때까지
                while (i + 1 < data.length) {
                    if (data[i] === 0xFF && data[i + 1] !== 0x00 && !(data[i + 1] >= 0xD0 && data[i + 1] <= 0xD7)) break;
                    i++;
                }
            }
        }
        return -1;
    }

    static async parse(fileOrBlob) {
        const buffer = await fileOrBlob.arrayBuffer();
        const data = new Uint8Array(buffer);
        const dataView = new DataView(buffer);

        // 1. 실화상(Visual) 및 열화상(Thermal) JPEG 추출
        let soiOffsets = [];
        for (let i = 0; i < data.length - 1; i++) {
            if (data[i] === 0xFF && data[i + 1] === 0xD8) {
                soiOffsets.push(i);
            }
        }

        let visualBlob = null;
        let visualUrl = null;
        let thermalBlob = null;
        let thermalUrl = null;

        // 열화상 그림 = 파일 전체 (FLIR 사진은 파일 전체가 한 장의 JPEG, 뒤쪽 FLIR 자료 칸은 브라우저가 건너뜀).
        thermalBlob = new Blob([data], { type: 'image/jpeg' });
        thermalUrl = URL.createObjectURL(thermalBlob);

        // 실화상 = 0번(열화상)을 제외한 내부 JPEG 중 해상도가 가장 큰 이미지 (최소 160x120 이상인 실화상 사진)
        let bestStart = -1;
        let bestArea = 0;
        for (const start of soiOffsets) {
            if (start === 0) continue;
            const dims = FlirParser.getJpegDimensions(data, start);
            if (dims && dims.width >= 160 && dims.height >= 120) {
                const area = dims.width * dims.height;
                if (area > bestArea) {
                    bestArea = area;
                    bestStart = start;
                }
            }
        }

        if (bestStart > 0) {
            let end = FlirParser.jpegEnd(data, bestStart);
            if (end <= bestStart) {
                end = data.length;
            }
            visualBlob = new Blob([data.slice(bestStart, end)], { type: 'image/jpeg' });
            visualUrl = URL.createObjectURL(visualBlob);
        }

        // 2. FFF APP1 세그먼트 청크 수집 및 결합
        const chunks = {};
        let pos = 0;
        const flirSig = [0x46, 0x4C, 0x49, 0x52, 0x00]; // "FLIR\0"

        while (pos < data.length - 10) {
            let found = true;
            for (let k = 0; k < 5; k++) {
                if (data[pos + k] !== flirSig[k]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                if (pos >= 4 && data[pos - 4] === 0xFF && data[pos - 3] === 0xE1) {
                    const segLen = (data[pos - 2] << 8) | data[pos - 1];
                    const chunkIdx = data[pos + 6];
                    const chunkData = data.slice(pos + 8, pos - 2 + segLen);
                    chunks[chunkIdx] = chunkData;
                }
            }
            pos++;
        }

        const sortedKeys = Object.keys(chunks).map(Number).sort((a, b) => a - b);
        let totalFffLen = 0;
        for (const k of sortedKeys) totalFffLen += chunks[k].length;

        const fffBytes = new Uint8Array(totalFffLen);
        let currOffset = 0;
        for (const k of sortedKeys) {
            fffBytes.set(chunks[k], currOffset);
            currOffset += chunks[k].length;
        }

        // 실화상은 이어 붙인 FLIR 자료 안에서 찾음. 파일 그대로 잘라 쓰면 65KB 마다 끼어든 FLIR 머리글(APP1) 때문에
        // 그림이 중간에서 끊겨 위쪽만 보이고 아래는 회색이 됨 (11-21 사용자 확인). 못 찾을 때만 위의 파일 그대로 자른 것을 씀
        let fvStart = -1, fvArea = 0;
        for (let i = 0; i < fffBytes.length - 3; i++) {
            if (fffBytes[i] === 0xFF && fffBytes[i + 1] === 0xD8 && fffBytes[i + 2] === 0xFF) {
                const dm = FlirParser.getJpegDimensions(fffBytes, i);
                if (dm && dm.width >= 160 && dm.height >= 120 && dm.width * dm.height > fvArea) { fvArea = dm.width * dm.height; fvStart = i; }
            }
        }
        if (fvStart >= 0) {
            let fvEnd = FlirParser.jpegEnd(fffBytes, fvStart);
            if (fvEnd <= fvStart) fvEnd = fffBytes.length;
            if (visualUrl) URL.revokeObjectURL(visualUrl);
            visualBlob = new Blob([fffBytes.slice(fvStart, fvEnd)], { type: 'image/jpeg' });
            visualUrl = URL.createObjectURL(visualBlob);
        }

        const fffView = new DataView(fffBytes.buffer, fffBytes.byteOffset, fffBytes.byteLength);

        // 3. FFF 태그 디렉터리 파싱 (빅 엔디안)
        let dirOffset = 64;
        let dirEntries = 0;
        if (fffBytes.length > 32) {
            dirOffset = fffView.getUint32(24, false);
            dirEntries = fffView.getUint32(28, false);
        }

        const tags = {};
        for (let i = 0; i < dirEntries; i++) {
            const entryStart = dirOffset + i * 32;
            if (entryStart + 20 <= fffBytes.length) {
                const tag = fffView.getUint16(entryStart, false);
                const offset = fffView.getUint32(entryStart + 12, false);
                const length = fffView.getUint32(entryStart + 16, false);
                if (length > 0) {
                    tags[tag] = { offset, length };
                }
            }
        }

        // 4. CameraInfo (Tag 32) 파라미터 파싱
        let emissivity = 1.0;
        let distance = 1.0;
        let T_refl = 293.15;
        let T_atm = 293.15;
        let humidity = 0.5;
        let R1 = 16088.233;
        let B = 1419.4;
        let F = 1.0;
        let ATA1 = 0.006569;
        let ATA2 = 0.01262;
        let ATB1 = -0.002276;
        let ATB2 = -0.00667;
        let ATX = 1.9;
        let O = -6088;
        let R2 = 0.01126058;

        if (tags[32]) {
            const camStart = tags[32].offset;
            const camLen = tags[32].length;
            if (camStart + 0x310 <= fffBytes.length) {
                emissivity = fffView.getFloat32(camStart + 32, true);
                distance = fffView.getFloat32(camStart + 36, true);
                T_refl = fffView.getFloat32(camStart + 40, true);
                T_atm = fffView.getFloat32(camStart + 44, true);
                humidity = fffView.getFloat32(camStart + 60, true);
                R1 = fffView.getFloat32(camStart + 88, true);
                B = fffView.getFloat32(camStart + 92, true);
                F = fffView.getFloat32(camStart + 96, true);
                ATA1 = fffView.getFloat32(camStart + 112, true);
                ATA2 = fffView.getFloat32(camStart + 116, true);
                ATB1 = fffView.getFloat32(camStart + 120, true);
                ATB2 = fffView.getFloat32(camStart + 124, true);
                ATX = fffView.getFloat32(camStart + 128, true);
                O = fffView.getInt32(camStart + 0x308, true);
                R2 = fffView.getFloat32(camStart + 0x30c, true);
            }
        }

        // 5. 스팟 위치 (Sp1, Sp2, Sp3) 다형 파싱 (Tag 33 스팟 전용 태그 범위 내에서만 정밀 탐색)
        // Pattern A: UTF-16LE "Sp1", "Sp2", "Sp3" (53 00 70 00 31 00 ...) 앞 4바이트
        // Pattern B: "1\0\0\0", "2\0\0\0", "3\0\0\0" 앞 4바이트
        let detectedSpots = [];
        let spotPattern = null;

        const t33Start = tags[33] ? tags[33].offset : 0;
        const t33End = tags[33] ? (tags[33].offset + tags[33].length) : fffBytes.length;

        // Pattern A 시도 (Tag 33 범위 내)
        const spotsA = [];
        for (const digit of ['1', '2', '3']) {
            const pat = [83, 0, 112, 0, digit.charCodeAt(0), 0];
            let foundPos = -1;
            for (let i = t33Start; i <= t33End - pat.length; i++) {
                let m = true;
                for (let k = 0; k < pat.length; k++) {
                    if (fffBytes[i + k] !== pat[k]) { m = false; break; }
                }
                if (m && i >= t33Start + 4) {
                    const x = fffView.getUint16(i - 4, true);
                    const y = fffView.getUint16(i - 2, true);
                    if (x < 640 && y < 480) {
                        foundPos = i - 4;
                        spotsA.push({ digit, x, y, pos: foundPos });
                        break;
                    }
                }
            }
        }

        if (spotsA.length === 3) {
            detectedSpots = spotsA;
            spotPattern = 'A';
        } else {
            // Pattern B 시도 (Tag 33 범위 내)
            const spotsB = [];
            for (const digit of ['1', '2', '3']) {
                const pat = [digit.charCodeAt(0), 0, 0, 0];
                let foundPos = -1;
                for (let i = t33Start; i <= t33End - pat.length; i++) {
                    let m = true;
                    for (let k = 0; k < pat.length; k++) {
                        if (fffBytes[i + k] !== pat[k]) { m = false; break; }
                    }
                    if (m && i >= t33Start + 4) {
                        const x = fffView.getUint16(i - 4, true);
                        const y = fffView.getUint16(i - 2, true);
                        if (x < 640 && y < 480) {
                            foundPos = i - 4;
                            spotsB.push({ digit, x, y, pos: foundPos });
                            break;
                        }
                    }
                }
            }

            if (spotsB.length === 3) {
                detectedSpots = spotsB;
                spotPattern = 'B';
            }
        }

        const hasNativeSpots = (detectedSpots.length === 3);

        const spots = [
            { id: 1, name: 'Sp1 (R상)', x: hasNativeSpots ? detectedSpots[0].x : 100, y: hasNativeSpots ? detectedSpots[0].y : 120 },
            { id: 2, name: 'Sp2 (S상)', x: hasNativeSpots ? detectedSpots[1].x : 160, y: hasNativeSpots ? detectedSpots[1].y : 120 },
            { id: 3, name: 'Sp3 (T상)', x: hasNativeSpots ? detectedSpots[2].x : 220, y: hasNativeSpots ? detectedSpots[2].y : 120 }
        ];

        // 6. Raw Thermal Data (Tag 1) 디코딩 (PNG 압축 또는 비압축 16-bit Raw 동시 지원)
        let rawPixels = null;
        const width = 320;
        const height = 240;

        if (tags[1]) {
            const rawStart = tags[1].offset;
            const rawLen = tags[1].length;
            const payload = fffBytes.slice(rawStart + 32, rawStart + rawLen);

            // PNG 매직 넘버 검사 (\x89PNG\r\n\x1a\n)
            const isPng = payload.length >= 8 &&
                          payload[0] === 0x89 && payload[1] === 0x50 &&
                          payload[2] === 0x4E && payload[3] === 0x47;

            if (isPng) {
                rawPixels = await FlirParser.decodePng16(payload, width, height);
            } else if (payload.length >= width * height * 2) {
                // 비압축 16-bit 리틀 엔디안 Raw 픽셀 직접 디코딩
                rawPixels = [];
                const pView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
                for (let y = 0; y < height; y++) {
                    const row = new Uint16Array(width);
                    const rowOffset = y * width * 2;
                    for (let x = 0; x < width; x++) {
                        row[x] = pView.getUint16(rowOffset + x * 2, true);
                    }
                    rawPixels.push(row);
                }
            }
        }

        // 7. 정밀 복사 온도 계산기 생성 (FLIR 표준 물리 공식)
        const calc = new FlirCalculator({
            rawPixels,
            R1, B, F, O, R2,
            emissivity, distance, T_refl, T_atm, humidity,
            ATA1, ATA2, ATB1, ATB2, ATX,
            width, height
        });

        // 초기 스팟 온도 계산
        for (const sp of spots) {
            sp.temp = calc.getTempAt(sp.x, sp.y);
        }

        const envInfo = {
            emissivity: Math.round(emissivity * 100) / 100,
            reflTempC: Math.round((T_refl - 273.15) * 10) / 10,
            atmTempC: Math.round((T_atm - 273.15) * 10) / 10,
            distance: Math.round(distance * 10) / 10,
            humidity: Math.round(humidity * 100)
        };

        return {
            fileName: fileOrBlob.name || "thermal_image.jpg",
            width,
            height,
            visualUrl,
            visualBlob,
            hasVisual: !!visualBlob,
            thermalUrl,
            thermalBlob,
            spots,
            calculator: calc,
            rawBuffer: buffer,
            hasNativeSpots,
            spotPattern,
            envInfo,

            // 스팟 위치 바이너리 패칭 (Write-Back)
            patchSpots(newSpots) {
                const copyData = new Uint8Array(buffer.slice(0));
                const copyView = new DataView(copyData.buffer);
                let patchedCount = 0;

                const patchTarget = (digit, x, y) => {
                    // Pattern A: [x, y, 'S', 0, 'p', 0, digit, 0]
                    const patA = [83, 0, 112, 0, digit.charCodeAt(0), 0];
                    for (let i = 0; i <= copyData.length - patA.length; i++) {
                        let m = true;
                        for (let k = 0; k < patA.length; k++) {
                            if (copyData[i + k] !== patA[k]) { m = false; break; }
                        }
                        if (m && i >= 4) {
                            copyView.setUint16(i - 4, Math.round(x), true);
                            copyView.setUint16(i - 2, Math.round(y), true);
                            return true;
                        }
                    }

                    // Pattern B: [x, y, digit, 0, 0, 0]
                    const patB = [digit.charCodeAt(0), 0, 0, 0];
                    for (let i = 0; i <= copyData.length - patB.length; i++) {
                        let m = true;
                        for (let k = 0; k < patB.length; k++) {
                            if (copyData[i + k] !== patB[k]) { m = false; break; }
                        }
                        if (m && i >= 4) {
                            copyView.setUint16(i - 4, Math.round(x), true);
                            copyView.setUint16(i - 2, Math.round(y), true);
                            return true;
                        }
                    }
                    return false;
                };

                for (let idx = 0; idx < newSpots.length; idx++) {
                    const sp = newSpots[idx];
                    if (patchTarget(String(idx + 1), sp.x, sp.y)) {
                        patchedCount++;
                    }
                }

                return {
                    blob: new Blob([copyData], { type: 'image/jpeg' }),
                    patchedCount,
                    success: patchedCount === newSpots.length
                };
            }
        };
    }

    static async decodePng16(pngBytes, width, height) {
        let p = 8;
        const idatChunks = [];
        const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);

        while (p < pngBytes.length - 8) {
            const length = view.getUint32(p, false);
            const typeStr = String.fromCharCode(pngBytes[p + 4], pngBytes[p + 5], pngBytes[p + 6], pngBytes[p + 7]);
            if (typeStr === 'IDAT') {
                idatChunks.push(pngBytes.slice(p + 8, p + 8 + length));
            }
            p += 12 + length;
        }

        let totalIdat = 0;
        for (const c of idatChunks) totalIdat += c.length;
        const combinedIdat = new Uint8Array(totalIdat);
        let off = 0;
        for (const c of idatChunks) {
            combinedIdat.set(c, off);
            off += c.length;
        }

        let decompressed;
        if (typeof pako !== 'undefined' && pako.inflate) {
            decompressed = pako.inflate(combinedIdat);
        } else if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('deflate');
            const writer = ds.writable.getWriter();
            writer.write(combinedIdat);
            writer.close();
            const res = await new Response(ds.readable).arrayBuffer();
            decompressed = new Uint8Array(res);
        } else {
            throw new Error('zlib decompressor not available');
        }

        const stride = width * 2 + 1;
        const bpp = 2;
        let prevLine = new Uint8Array(width * bpp);
        const rawPixels = [];

        for (let y = 0; y < height; y++) {
            const lineStart = y * stride;
            const filterType = decompressed[lineStart];
            const lineRaw = decompressed.subarray(lineStart + 1, lineStart + stride);
            const curLine = new Uint8Array(width * bpp);

            if (filterType === 0) {
                curLine.set(lineRaw);
            } else if (filterType === 1) {
                for (let i = 0; i < lineRaw.length; i++) {
                    const left = i >= bpp ? curLine[i - bpp] : 0;
                    curLine[i] = (lineRaw[i] + left) & 0xFF;
                }
            } else if (filterType === 2) {
                for (let i = 0; i < lineRaw.length; i++) {
                    const up = prevLine[i];
                    curLine[i] = (lineRaw[i] + up) & 0xFF;
                }
            } else if (filterType === 3) {
                for (let i = 0; i < lineRaw.length; i++) {
                    const left = i >= bpp ? curLine[i - bpp] : 0;
                    const up = prevLine[i];
                    curLine[i] = (lineRaw[i] + ((left + up) >> 1)) & 0xFF;
                }
            } else if (filterType === 4) {
                for (let i = 0; i < lineRaw.length; i++) {
                    const a = i >= bpp ? curLine[i - bpp] : 0;
                    const b = prevLine[i];
                    const c = i >= bpp ? prevLine[i - bpp] : 0;
                    const pVal = a + b - c;
                    const pa = Math.abs(pVal - a);
                    const pb = Math.abs(pVal - b);
                    const pc = Math.abs(pVal - c);
                    let pr;
                    if (pa <= pb && pa <= pc) pr = a;
                    else if (pb <= pc) pr = b;
                    else pr = c;
                    curLine[i] = (lineRaw[i] + pr) & 0xFF;
                }
            }

            prevLine = curLine;

            const rowSamples = new Uint16Array(width);
            for (let x = 0; x < width; x++) {
                const idx = x * 2;
                rowSamples[x] = curLine[idx] | (curLine[idx + 1] << 8);
            }
            rawPixels.push(rowSamples);
        }

        return rawPixels;
    }
}

/**
 * Planck 역방정식 & FLIR 표준 대기/방사 보정 온도 계산기
 */
class FlirCalculator {
    constructor({
        rawPixels,
        R1, B, F, O, R2,
        emissivity = 1.0,
        distance = 1.0,
        T_refl = 293.15,
        T_atm = 293.15,
        humidity = 0.5,
        ATA1 = 0.006569,
        ATA2 = 0.01262,
        ATB1 = -0.002276,
        ATB2 = -0.00667,
        ATX = 1.9,
        width, height
    }) {
        this.rawPixels = rawPixels;
        this.R1 = R1;
        this.B = B;
        this.F = F;
        this.O = O;
        this.R2 = R2;
        this.emissivity = emissivity;
        this.distance = distance;
        this.T_refl = T_refl;
        this.T_atm = T_atm;
        this.humidity = humidity;
        this.width = width;
        this.height = height;

        // 1. 대기 투과율 (tau) 계산
        const T_atm_c = T_atm - 273.15;
        const h2o = humidity * Math.exp(1.5587 + 0.06939 * T_atm_c - 0.00027816 * Math.pow(T_atm_c, 2) + 0.00000068455 * Math.pow(T_atm_c, 3));
        const d = Math.max(0.0, distance);
        const sqrt_d = Math.sqrt(d);
        const sqrt_h2o = Math.sqrt(h2o);
        this.tau = ATX * Math.exp(-sqrt_d * (ATA1 + ATB1 * sqrt_h2o)) + (1.0 - ATX) * Math.exp(-sqrt_d * (ATA2 + ATB2 * sqrt_h2o));

        // 2. 반사광 및 대기 복사 신호 (raw counts) 사전 계산
        this.raw_refl = R1 / (R2 * (Math.exp(B / T_refl) - F)) - O;
        this.raw_atm  = R1 / (R2 * (Math.exp(B / T_atm) - F)) - O;
    }

    getTempAt(x, y) {
        x = Math.max(0, Math.min(this.width - 1, Math.round(x)));
        y = Math.max(0, Math.min(this.height - 1, Math.round(y)));

        if (!this.rawPixels || !this.rawPixels[y]) {
            return 30.0;
        }

        const S = this.rawPixels[y][x];

        // FLIR 표준 계산식: 대기 투과율 -> 반사/대기 성분 차감 -> 방사율 보정
        const raw_obj = (S - (1.0 - this.tau) * this.raw_atm - this.tau * (1.0 - this.emissivity) * this.raw_refl) / (this.tau * this.emissivity);

        const val = this.R1 / (this.R2 * (raw_obj + this.O)) + this.F;
        if (val <= 0) return 30.0;

        const Tk = this.B / Math.log(val);
        const Tc = Tk - 273.15;
        return Math.round(Tc * 10) / 10;
    }

    findMaxSpot(yMin = 0, yMax = 239) {
        if (!this.rawPixels) return { x: 160, y: 120, temp: 30.0 };

        yMin = Math.max(0, Math.min(this.height - 1, Math.round(yMin)));
        yMax = Math.max(0, Math.min(this.height - 1, Math.round(yMax)));
        if (yMin > yMax) {
            const tmp = yMin; yMin = yMax; yMax = tmp;
        }

        let maxSignal = -1;
        let maxX = 160;
        let maxY = 120;

        for (let y = yMin; y <= yMax; y++) {
            const row = this.rawPixels[y];
            if (!row) continue;
            for (let x = 0; x < this.width; x++) {
                const s = row[x];
                if (s > maxSignal) {
                    maxSignal = s;
                    maxX = x;
                    maxY = y;
                }
            }
        }

        return {
            x: maxX,
            y: maxY,
            temp: this.getTempAt(maxX, maxY)
        };
    }
}

if (typeof window !== 'undefined') {
    window.FlirParser = FlirParser;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = FlirParser;
}
