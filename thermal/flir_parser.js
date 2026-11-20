/**
 * flir_parser.js
 * 브라우저 순수 자바스크립트 FLIR 열화상 파서 & 온도 계산 엔진
 * - 외부 서버, Python, C# DLL 없이 브라우저 메모리 상에서 동작
 * - 16-bit Raw Grayscale PNG 디코딩 및 Planck 역방정식을 통한 정밀 온도 계산
 * - 실화상 사진(Visual JPEG) 및 열화상 사진(Thermal JPEG) 추출
 * - 스팟 좌표 읽기 및 JPEG FFF 바이너리 좌표 패칭(Write-Back)
 * - 상·하 가이드라인 ROI 내 최고온도(Max Spot) 자동 탐색 알고리즘 탑재
 */

class FlirParser {
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

        if (soiOffsets.length >= 2) {
            const visualStart = soiOffsets[1];
            let visualEnd = data.length;
            for (let i = visualStart + 2; i < data.length - 1; i++) {
                if (data[i] === 0xFF && data[i + 1] === 0xD9) {
                    visualEnd = i + 2;
                    break;
                }
            }
            const visualSlice = data.slice(visualStart, visualEnd);
            visualBlob = new Blob([visualSlice], { type: 'image/jpeg' });
            visualUrl = URL.createObjectURL(visualBlob);

            const thermalSlice = data.slice(0, visualStart);
            thermalBlob = new Blob([thermalSlice], { type: 'image/jpeg' });
            thermalUrl = URL.createObjectURL(thermalBlob);
        } else {
            thermalBlob = new Blob([data], { type: 'image/jpeg' });
            thermalUrl = URL.createObjectURL(thermalBlob);
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

        // 4. CameraInfo (Tag 32) Planck 파라미터 파싱
        let R1 = 16088.233;
        let B = 1419.4;
        let F = 1.0;
        let O = -6088;
        let R2 = 0.01126058;
        let emissivity = 1.0;

        if (tags[32]) {
            const camStart = tags[32].offset;
            const camLen = tags[32].length;
            if (camStart + 0x310 <= fffBytes.length) {
                emissivity = fffView.getFloat32(camStart + 32, true);
                R1 = fffView.getFloat32(camStart + 88, true);
                B = fffView.getFloat32(camStart + 92, true);
                F = fffView.getFloat32(camStart + 96, true);
                O = fffView.getInt32(camStart + 0x308, true);
                R2 = fffView.getFloat32(camStart + 0x30c, true);
            }
        }

        // 5. 스팟 위치 (Sp1, Sp2, Sp3) 읽기
        const findSpot = (nameDigit) => {
            const pattern = [83, 0, 112, 0, nameDigit.charCodeAt(0), 0];
            for (let i = 0; i < fffBytes.length - 6; i++) {
                let match = true;
                for (let k = 0; k < 6; k++) {
                    if (fffBytes[i + k] !== pattern[k]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    const x = fffView.getUint16(i - 4, true);
                    const y = fffView.getUint16(i - 2, true);
                    return { x, y, fffPos: i - 4 };
                }
            }
            return null;
        };

        const spot1Info = findSpot('1');
        const spot2Info = findSpot('2');
        const spot3Info = findSpot('3');

        // 기본 좌표
        const spots = [
            { id: 1, name: 'Sp1 (R상)', x: spot1Info ? spot1Info.x : 102, y: spot1Info ? spot1Info.y : 126 },
            { id: 2, name: 'Sp2 (S상)', x: spot2Info ? spot2Info.x : 163, y: spot2Info ? spot2Info.y : 132 },
            { id: 3, name: 'Sp3 (T상)', x: spot3Info ? spot3Info.x : 227, y: spot3Info ? spot3Info.y : 130 }
        ];

        // 6. Raw Thermal Data (Tag 1) PNG 디코딩
        let rawPixels = null;
        const width = 320;
        const height = 240;

        if (tags[1]) {
            const rawStart = tags[1].offset;
            const rawLen = tags[1].length;
            const pngBytes = fffBytes.slice(rawStart + 32, rawStart + rawLen);

            rawPixels = await FlirParser.decodePng16(pngBytes, width, height);
        }

        // 7. 온도 계산기 인스턴스 생성
        const calc = new FlirCalculator({
            rawPixels,
            R1, B, F, O, R2,
            width, height
        });

        // 초기 스팟 온도 계산
        for (const sp of spots) {
            sp.temp = calc.getTempAt(sp.x, sp.y);
        }

        return {
            fileName: fileOrBlob.name || "thermal_image.jpg",
            width,
            height,
            visualUrl,
            visualBlob,
            thermalUrl,
            thermalBlob,
            spots,
            calculator: calc,
            rawBuffer: buffer,
            hasNativeSpots: Boolean(spot1Info && spot2Info && spot3Info),

            patchSpots(newSpots) {
                const copyData = new Uint8Array(buffer.slice(0));
                const copyView = new DataView(copyData.buffer);

                const patchTarget = (digit, x, y) => {
                    const pat = [83, 0, 112, 0, digit.charCodeAt(0), 0];
                    for (let i = 0; i < copyData.length - 6; i++) {
                        let m = true;
                        for (let k = 0; k < 6; k++) {
                            if (copyData[i + k] !== pat[k]) {
                                m = false;
                                break;
                            }
                        }
                        if (m) {
                            copyView.setUint16(i - 4, x, true);
                            copyView.setUint16(i - 2, y, true);
                            return true;
                        }
                    }
                    return false;
                };

                for (let idx = 0; idx < newSpots.length; idx++) {
                    const sp = newSpots[idx];
                    patchTarget(String(idx + 1), Math.round(sp.x), Math.round(sp.y));
                }

                return new Blob([copyData], { type: 'image/jpeg' });
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
 * Planck 역방정식을 통한 온도 계산기 & 최고온도 자동 탐색기
 */
class FlirCalculator {
    constructor({ rawPixels, R1, B, F, O, R2, width, height }) {
        this.rawPixels = rawPixels;
        this.R1 = R1;
        this.B = B;
        this.F = F;
        this.O = O;
        this.R2 = R2;
        this.width = width;
        this.height = height;
    }

    getTempAt(x, y) {
        x = Math.max(0, Math.min(this.width - 1, Math.round(x)));
        y = Math.max(0, Math.min(this.height - 1, Math.round(y)));

        if (!this.rawPixels || !this.rawPixels[y]) {
            return 30.0;
        }

        const S = this.rawPixels[y][x];
        const val = this.R1 / (this.R2 * (S + this.O)) + this.F;
        if (val <= 0) return 30.0;

        const Tk = this.B / Math.log(val);
        const Tc = Tk - 273.15;
        return Math.round(Tc * 10) / 10;
    }

    /**
     * 상·하 가이드라인 범위 (yMin ~ yMax) 내에서 최고온도(Max Spot) 자동 탐색
     */
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

        // 제한구역(yMin ~ yMax) 내 모든 픽셀 고속 스캔
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

window.FlirParser = FlirParser;
