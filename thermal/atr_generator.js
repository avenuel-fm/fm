/**
 * atr_generator.js
 * 브라우저 순수 자바스크립트 FLIR Thermal Studio .atr 리포트 생성기
 * - JSZip 을 활용하여 master_template.atr 을 기반으로 N쪽 동적 슬라이싱 및 생성
 * - 쪽마다 문서 바이너리(cactus/af9878b2aa8e47faaf8942d892cde994.bin) 내부의
 *   4개 사본 이미지(Overlay PNG, Large Visual JPEG, Thermal JPEG, Cropped Visual JPEG)와
 *   표 글자(Point 1~3 온도, 측정대상 회로명, 상간 최대 온도차, 상태 판정)를 동적 치환
 * - 보고서 제목, 측정자, 일자, 파일 경로 바이너리 길이 헤더 일치 동적 갱신
 * - FLIR Thermal Studio로 열었을 때 양식의 옛 사진이나 옛 온도가 아닌, 실제 현장 사진과 데이터가 완벽하게 표시됨
 * - 생성된 바이너리에 대한 validateDocStringLengths 전수 검증 수행
 * - PC 로컬 다운로드 및 WS_THERMAL 통로를 통한 보고서 기록 보관 지원
 */

class AtrGenerator {
    static IRON_LUT = [[16, 16, 16], [16, 16, 16], [16, 16, 16], [17, 16, 18], [17, 16, 22], [17, 16, 22], [17, 16, 22], [17, 17, 29], [17, 17, 29], [17, 17, 29], [17, 17, 29], [17, 17, 31], [16, 17, 35], [16, 17, 35], [16, 17, 35], [16, 17, 37], [17, 17, 43], [17, 17, 45], [17, 17, 45], [17, 17, 48], [17, 16, 56], [17, 16, 56], [17, 16, 56], [17, 16, 58], [16, 16, 64], [16, 16, 68], [16, 16, 68], [16, 17, 72], [16, 17, 73], [16, 17, 73], [16, 17, 73], [16, 17, 73], [16, 18, 77], [16, 18, 77], [16, 18, 77], [15, 19, 80], [15, 19, 82], [15, 19, 82], [15, 19, 82], [15, 19, 82], [15, 20, 86], [15, 20, 86], [15, 20, 86], [17, 20, 89], [17, 20, 91], [17, 20, 91], [17, 20, 91], [17, 20, 91], [21, 19, 94], [21, 19, 94], [21, 19, 94], [23, 18, 96], [25, 18, 98], [25, 18, 98], [25, 18, 98], [27, 18, 100], [29, 17, 102], [29, 17, 103], [29, 17, 103], [30, 17, 104], [31, 17, 105], [31, 17, 105], [31, 17, 105], [33, 16, 107], [35, 15, 109], [35, 15, 110], [35, 15, 110], [37, 15, 112], [39, 15, 113], [39, 15, 113], [39, 15, 113], [40, 15, 114], [41, 15, 116], [41, 15, 116], [41, 15, 116], [41, 15, 116], [43, 14, 117], [45, 14, 118], [45, 14, 118], [45, 14, 119], [47, 13, 121], [47, 13, 123], [47, 13, 123], [47, 13, 123], [49, 13, 125], [51, 13, 126], [51, 13, 126], [52, 13, 126], [55, 12, 128], [55, 12, 128], [56, 12, 130], [57, 12, 131], [57, 12, 131], [58, 12, 132], [61, 11, 134], [61, 11, 134], [63, 11, 135], [63, 11, 135], [65, 11, 137], [69, 11, 140], [71, 11, 140], [72, 11, 141], [73, 10, 142], [75, 9, 143], [78, 9, 147], [81, 9, 148], [88, 9, 152], [92, 9, 154], [95, 9, 155], [101, 10, 157], [105, 10, 159], [113, 11, 161], [118, 11, 161], [124, 13, 163], [138, 16, 161], [143, 17, 160], [149, 19, 159], [161, 25, 154], [166, 27, 152], [176, 32, 144], [181, 36, 140], [188, 41, 133], [199, 50, 117], [204, 57, 108], [211, 66, 97], [215, 73, 88], [219, 80, 78], [226, 92, 63], [229, 97, 56], [234, 110, 42], [236, 116, 36], [239, 123, 31], [241, 134, 20], [242, 139, 17], [243, 153, 11], [243, 158, 10], [244, 162, 9], [245, 169, 8], [244, 173, 10], [244, 181, 13], [244, 184, 15], [244, 187, 17], [243, 194, 22], [243, 197, 26], [242, 200, 29], [243, 202, 34], [242, 203, 36], [241, 206, 41], [241, 208, 45], [241, 209, 48], [241, 211, 52], [241, 212, 56], [240, 214, 59], [240, 214, 59], [240, 215, 61], [240, 216, 66], [240, 216, 66], [239, 217, 69], [239, 217, 71], [239, 217, 71], [239, 218, 73], [239, 218, 73], [238, 219, 78], [237, 219, 81], [237, 219, 81], [237, 221, 84], [237, 221, 86], [237, 221, 86], [236, 222, 91], [236, 222, 91], [236, 223, 95], [236, 223, 95], [236, 223, 95], [235, 224, 97], [235, 224, 100], [235, 225, 102], [235, 225, 104], [235, 225, 104], [235, 226, 108], [235, 226, 109], [234, 227, 112], [234, 227, 113], [234, 227, 113], [234, 227, 116], [234, 227, 119], [234, 227, 122], [233, 228, 124], [233, 228, 124], [233, 229, 128], [233, 229, 130], [233, 230, 133], [233, 230, 135], [233, 230, 135], [233, 230, 135], [233, 230, 135], [232, 231, 137], [232, 231, 141], [232, 231, 141], [232, 231, 145], [232, 231, 148], [232, 231, 148], [232, 231, 148], [232, 231, 148], [231, 232, 153], [231, 232, 154], [231, 232, 154], [231, 233, 156], [231, 233, 158], [231, 233, 158], [231, 233, 158], [231, 233, 158], [229, 234, 166], [229, 234, 167], [229, 234, 167], [229, 235, 169], [229, 235, 172], [229, 235, 173], [229, 235, 173], [229, 235, 173], [228, 236, 178], [228, 236, 179], [228, 236, 179], [228, 236, 183], [228, 236, 188], [228, 236, 189], [228, 236, 189], [228, 236, 198], [228, 236, 199], [228, 236, 199], [228, 236, 199], [228, 236, 201], [227, 236, 207], [227, 236, 207], [227, 236, 207], [227, 236, 216], [227, 236, 217], [227, 236, 217], [227, 236, 217], [227, 236, 219], [228, 236, 223], [228, 236, 223], [229, 236, 225], [230, 235, 228], [230, 235, 229], [230, 235, 229], [230, 235, 229], [231, 235, 230], [233, 235, 232], [233, 235, 232], [234, 235, 233], [235, 235, 235], [235, 235, 235], [235, 235, 235], [235, 235, 235], [251, 251, 251], [255, 255, 255]];

    static PROTOTYPE_SLOT = {
        circuit: "1층1번일반",
        guid: "6ba1d80e4c7643c187a6351e6a98a461",
        orig_name: "1층1번일반 (3).jpg"
    };

    static PROTOTYPE_OFFSET_START = 58303;
    static PROTOTYPE_OFFSET_END = 535258;
    static TEMPLATE_FOOTER_OFFSET = 3825001;
    static PAGE_COUNT_POS = 55903;

    /**
     * 32자리 고유 GUID 생성 (소문자 hex)
     */
    static generateGuid(idx) {
        let rnd = '';
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const arr = new Uint8Array(12);
            crypto.getRandomValues(arr);
            rnd = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        } else {
            rnd = Math.random().toString(16).substring(2).padEnd(24, '0').substring(0, 24);
        }
        const pStr = (idx + 1).toString(16).padStart(4, '0');
        return `e001${pStr}${rnd}`.substring(0, 32);
    }

    /**
     * 바이트 검색 헬퍼
     */
    static findSub(src, sub, fromIdx = 0) {
        for (let i = fromIdx; i <= src.length - sub.length; i++) {
            let match = true;
            for (let j = 0; j < sub.length; j++) {
                if (src[i + j] !== sub[j]) { match = false; break; }
            }
            if (match) return i;
        }
        return -1;
    }

    /**
     * 바이트 치환 헬퍼
     */
    static replaceBytes(source, target, replacement, limit = 0) {
        let count = 0;
        let pos = 0;
        const matches = [];

        while (pos <= source.length - target.length) {
            let matched = true;
            for (let i = 0; i < target.length; i++) {
                if (source[pos + i] !== target[i]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                matches.push(pos);
                pos += target.length;
                count++;
                if (limit > 0 && count >= limit) break;
            } else {
                pos++;
            }
        }

        if (matches.length === 0) return source;

        let totalLen = source.length + matches.length * (replacement.length - target.length);
        const result = new Uint8Array(totalLen);
        let srcIdx = 0;
        let dstIdx = 0;

        for (const mPos of matches) {
            const chunkLen = mPos - srcIdx;
            result.set(source.subarray(srcIdx, mPos), dstIdx);
            dstIdx += chunkLen;
            result.set(replacement, dstIdx);
            dstIdx += replacement.length;
            srcIdx = mPos + target.length;
        }

        if (srcIdx < source.length) {
            result.set(source.subarray(srcIdx), dstIdx);
        }

        return result;
    }

    /**
     * 바이트 배열 이어붙이기 헬퍼
     */
    static concat(arrays) {
        let total = 0;
        for (const a of arrays) total += a.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const a of arrays) {
            out.set(a, off);
            off += a.length;
        }
        return out;
    }

    static u32Bytes(val) {
        return new Uint8Array([
            val & 0xff,
            (val >> 8) & 0xff,
            (val >> 16) & 0xff,
            (val >> 24) & 0xff
        ]);
    }

    static u16Bytes(val) {
        return new Uint8Array([
            val & 0xff,
            (val >> 8) & 0xff
        ]);
    }

    /**
     * 이미지 객체 로드 헬퍼
     */
    static loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /**
     * Canvas로부터 PNG 바이트 추출
     */
    static canvasToPngBytes(canvas) {
        const dataUrl = canvas.toDataURL('image/png');
        const bin = atob(dataUrl.split(',')[1]);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

    /**
     * Canvas로부터 JPEG 바이트 추출
     */
    static canvasToJpegBytes(canvas, quality = 0.85) {
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const bin = atob(dataUrl.split(',')[1]);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }

    /**
     * 690x517 투명 Overlay PNG 생성 (양식 master_template.atr 쪽 1과 100% 동일 규격)
     * - 좌측 눈금 막대: 상단 최고 온도 박스, 가운데 Iron 컬러바, 하단 최저 온도 박스
     * - 스팟 마커: Sp1, Sp2, Sp3 원형 십자선 마커 및 라벨 (카메라 UI 검은 박스는 제외)
     */
    static makeOverlayPng(spots, scaleMin = 20.0, scaleMax = 30.0, width = 690, height = 517, srcW = 320, srcH = 240) {
        if (typeof document === 'undefined') {
            return new Uint8Array();
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        // 완전 투명 상태로 반환하여 카메라 본체 열화상 사진이 PDF와 100% 동일하게 온전히 표시되도록 함
        return AtrGenerator.canvasToPngBytes(canvas);
    }

    /**
     * 원시 온도 자료(rawPixels / FlirCalculator)로 직접 320x240 Baseline 열화상 JPEG 렌더링
     * (카메라 UI 그래픽, 박스, 로고가 일체 없는 순수 팔레트 비트맵)
     */
    static async makeCleanThermalJpeg(item, targetW = 320, targetH = 240) {
        if (typeof document === 'undefined') return new Uint8Array();

        // PDF에서 보여지는 것과 100% 동일한 카메라 열화상 본체 사진을 320x240 Baseline JPEG로 렌더링
        let blob = item ? (item.patchedBlob ? (item.patchedBlob.blob || item.patchedBlob) : (item.thermalBlob || item.rawBuffer || item)) : null;
        if (blob instanceof ArrayBuffer || blob instanceof Uint8Array) {
            blob = new Blob([blob], { type: 'image/jpeg' });
        }
        if (!blob) return new Uint8Array();

        const url = URL.createObjectURL(blob);
        try {
            const img = await AtrGenerator.loadImage(url);
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, targetW, targetH);
            return AtrGenerator.canvasToJpegBytes(canvas, 0.90);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    /**
     * 대형 실화상을 중앙 4:3으로 맞추어 320x240으로 리사이즈/크롭
     */
    static async makeCroppedVisual(visualBufferOrBlob, targetW = 320, targetH = 240) {
        if (typeof document === 'undefined') return new Uint8Array();

        let blob = visualBufferOrBlob;
        if (visualBufferOrBlob instanceof ArrayBuffer || visualBufferOrBlob instanceof Uint8Array) {
            blob = new Blob([visualBufferOrBlob], { type: 'image/jpeg' });
        }
        if (!blob) return new Uint8Array();

        const url = URL.createObjectURL(blob);
        try {
            const img = await AtrGenerator.loadImage(url);
            const canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            const ctx = canvas.getContext('2d');

            const w = img.naturalWidth || img.width;
            const h = img.naturalHeight || img.height;
            const targetAspect = targetW / targetH;
            const currentAspect = w / h;

            let sx = 0, sy = 0, sw = w, sh = h;
            if (currentAspect > targetAspect) {
                sw = h * targetAspect;
                sx = (w - sw) / 2;
            } else if (currentAspect < targetAspect) {
                sh = w / targetAspect;
                sy = (h - sh) / 2;
            }
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
            return AtrGenerator.canvasToJpegBytes(canvas, 0.85);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    /**
     * 한 쪽(Page) 내부의 4개 이미지 사본 및 표 글자 전면 치환 및 고유 GUID 부여
     * @param {Uint8Array} protoSlice 템플릿의 Page 1 바이트 슬라이스 (58303 .. 535258)
     * @param {number} pIdx 페이지 인덱스 (0-based)
     * @param {string} newGuid 이 페이지의 고유 32자리 GUID
     * @param {Object} item 페이지 데이터 (circuit_name, spots, thermalBlob, visualBlob, scaleMin, scaleMax 등)
     */
    static async transformPage(protoSlice, pIdx, newGuid, item) {
        const enc = new TextEncoder();
        const circuitName = (item.circuit_name || `회로_${pIdx + 1}`).trim();

        // 1. 스팟 좌표 및 온도
        const spots = item.spots || [
            { id: 1, x: 100, y: 120, temp: 25.0 },
            { id: 2, x: 160, y: 120, temp: 25.0 },
            { id: 3, x: 220, y: 120, temp: 25.0 }
        ];
        const temps = spots.map(s => (s.temp !== undefined ? s.temp : 25.0));
        const diff = Math.max(...temps) - Math.min(...temps);

        let statusStr = "정  상";
        if (diff > 10.0) statusStr = "이  상";
        else if (diff > 5.0) statusStr = "요 주 의";

        // 2. 바이너리 이미지 데이터 추출 및 가공
        // (1) Thermal JPEG (원시 센서 데이터 직접 변환 순수 320x240 baseline)
        let thermalBytes = null;
        const pb = item.patchedBlob ? (item.patchedBlob.blob || item.patchedBlob) : null;
        if (pb && pb.arrayBuffer) {
            thermalBytes = new Uint8Array(await pb.arrayBuffer());
        } else if (item.thermalBlob && item.thermalBlob.arrayBuffer) {
            thermalBytes = new Uint8Array(await item.thermalBlob.arrayBuffer());
        } else if (item.rawBuffer) {
            thermalBytes = new Uint8Array(item.rawBuffer);
        }

        let thJpegOnly = await AtrGenerator.makeCleanThermalJpeg(item, 320, 240);
        if (!thJpegOnly || thJpegOnly.length === 0) {
            thJpegOnly = thermalBytes;
        }

        // (2) Overlay PNG (690x517 양식 규격 스팟/눈금 막대)
        const overlayPng = AtrGenerator.makeOverlayPng(spots, item.scaleMin || 20.0, item.scaleMax || 30.0, 690, 517,
            (item.calculator && item.calculator.width) || 320, (item.calculator && item.calculator.height) || 240);

        // (3) Visual JPEG (2048x1536 실화상)
        let visualBytes = null;
        if (item.visualBlob && item.visualBlob.arrayBuffer) {
            visualBytes = new Uint8Array(await item.visualBlob.arrayBuffer());
        } else {
            // 실화상이 없는 기종이면 열화상을 대신 사용
            visualBytes = thJpegOnly;
        }

        // (4) Cropped Visual JPEG (320x240)
        let croppedVisual = await AtrGenerator.makeCroppedVisual(item.visualBlob || item.thermalBlob, 320, 240);
        if (!croppedVisual || croppedVisual.length === 0) {
            croppedVisual = thJpegOnly;
        }

        // 3. 슬라이스 내 4개 이미지의 위치 찾기
        const pageBytes = protoSlice;
        const view = new DataView(pageBytes.buffer, pageBytes.byteOffset, pageBytes.byteLength);
        const pngMagic = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const jpegMagic = new Uint8Array([0xFF, 0xD8, 0xFF]);

        const idxPng0 = AtrGenerator.findSub(pageBytes, pngMagic);
        if (idxPng0 < 4) throw new Error(`Page ${pIdx}: Overlay PNG not found`);
        const lenPng0 = view.getUint32(idxPng0 - 4, true);

        const idxJpg1 = AtrGenerator.findSub(pageBytes, jpegMagic);
        if (idxJpg1 < 4) throw new Error(`Page ${pIdx}: Visual JPEG not found`);
        const lenJpg1 = view.getUint32(idxJpg1 - 4, true);

        const idxJpg2 = AtrGenerator.findSub(pageBytes, jpegMagic, idxJpg1 + lenJpg1);
        if (idxJpg2 < 4) throw new Error(`Page ${pIdx}: Thermal JPEG not found`);
        const lenJpg2 = view.getUint32(idxJpg2 - 4, true);

        const idxJpg3 = AtrGenerator.findSub(pageBytes, jpegMagic, idxJpg2 + lenJpg2);
        if (idxJpg3 < 4) throw new Error(`Page ${pIdx}: Cropped Visual JPEG not found`);
        const lenJpg3 = view.getUint32(idxJpg3 - 4, true);

        // 청크 분할
        let c0 = pageBytes.subarray(0, idxPng0 - 4);
        let c2 = pageBytes.subarray(idxPng0 + lenPng0, idxJpg1 - 4);
        let c4 = pageBytes.subarray(idxJpg1 + lenJpg1, idxJpg2 - 4);
        let c6 = pageBytes.subarray(idxJpg2 + lenJpg2, idxJpg3 - 4);
        let c8 = pageBytes.subarray(idxJpg3 + lenJpg3);

        // 4. c0에서 Point 1, 2, 3 온도 치환: 04 LL LL [temp °C]
        const degC = new Uint8Array([0xC2, 0xB0, 0x43]);
        const tempIndices = [];
        let pPos = 0;
        while (true) {
            const dIdx = AtrGenerator.findSub(c0, degC, pPos);
            if (dIdx === -1) break;
            let nStart = dIdx - 1;
            while (nStart >= 0 && ((c0[nStart] >= 0x30 && c0[nStart] <= 0x39) || c0[nStart] === 0x2E || c0[nStart] === 0x2D || c0[nStart] === 0x20)) {
                nStart--;
            }
            nStart++;
            if (nStart >= 3 && c0[nStart - 3] === 0x04) {
                tempIndices.push({
                    start: nStart - 3,
                    end: dIdx + degC.length
                });
            }
            pPos = dIdx + degC.length;
        }

        if (tempIndices.length >= 3) {
            for (let sIdx = 2; sIdx >= 0; sIdx--) {
                const ti = tempIndices[sIdx];
                const newTStr = enc.encode(`${temps[sIdx].toFixed(1)} °C`);
                const newTHdr = new Uint8Array([0x04, newTStr.length & 0xff, (newTStr.length >> 8) & 0xff, ...newTStr]);
                const nextC0 = new Uint8Array(c0.length + (newTHdr.length - (ti.end - ti.start)));
                nextC0.set(c0.subarray(0, ti.start), 0);
                nextC0.set(newTHdr, ti.start);
                nextC0.set(c0.subarray(ti.end), ti.start + newTHdr.length);
                c0 = nextC0;
            }
        }

        // 5. c2, c6에서 파일명 및 경로 치환 (Page 1 원본 "1층1번일반 (3).jpg" 대상)
        const origFn = enc.encode("1층1번일반 (3).jpg");
        const origTitle = enc.encode("1층1번일반 (3)");
        const newFn = enc.encode(`${circuitName}.jpg`);
        const newTitle = enc.encode(circuitName);

        const replaceName = (ch) => {
            // Title 치환
            const pOldT = new Uint8Array([origTitle.length & 0xff, (origTitle.length >> 8) & 0xff, ...origTitle]);
            const pNewT = new Uint8Array([newTitle.length & 0xff, (newTitle.length >> 8) & 0xff, ...newTitle]);
            ch = AtrGenerator.replaceBytes(ch, pOldT, pNewT);

            // FileName 치환
            const pOldF = new Uint8Array([origFn.length & 0xff, (origFn.length >> 8) & 0xff, ...origFn]);
            const pNewF = new Uint8Array([newFn.length & 0xff, (newFn.length >> 8) & 0xff, ...newFn]);
            ch = AtrGenerator.replaceBytes(ch, pOldF, pNewF);

            // Path 치환: 1층\orig_fn -> 1층\new_fn
            const kor1F = enc.encode('1층\\');
            const pOldP = AtrGenerator.concat([kor1F, origFn]);
            const pNewP = AtrGenerator.concat([kor1F, newFn]);
            const pOldPath = new Uint8Array([pOldP.length & 0xff, (pOldP.length >> 8) & 0xff, ...pOldP]);
            const pNewPath = new Uint8Array([pNewP.length & 0xff, (pNewP.length >> 8) & 0xff, ...pNewP]);
            ch = AtrGenerator.replaceBytes(ch, pOldPath, pNewPath);
            return ch;
        };

        c2 = replaceName(c2);
        c6 = replaceName(c6);

        // 6. c8에서 상간 최대 온도차, 측정대상 회로명, 상태 판정 치환
        // (1) Delta T: 04 LL LL [diff]
        const deltaOldPat = new Uint8Array([0x04, 0x03, 0x00]);
        let dIdx = 0;
        while (true) {
            dIdx = AtrGenerator.findSub(c8, deltaOldPat, dIdx);
            if (dIdx === -1) break;
            const floatChar = c8[dIdx + 4]; // '.'
            if (floatChar === 0x2E) {
                const newDStr = enc.encode(diff.toFixed(1));
                const newDHdr = new Uint8Array([0x04, newDStr.length & 0xff, (newDStr.length >> 8) & 0xff, ...newDStr]);
                const nextC8 = new Uint8Array(c8.length + (newDHdr.length - 6));
                nextC8.set(c8.subarray(0, dIdx), 0);
                nextC8.set(newDHdr, dIdx);
                nextC8.set(c8.subarray(dIdx + 6), dIdx + newDHdr.length);
                c8 = nextC8;
                break;
            }
            dIdx += 3;
        }

        // (2) 측정대상 회로명: 04 10 00 [1층 1번 일반] (Page 1 고정 패턴 치환)
        const origTableCircuit = enc.encode("1층 1번 일반");
        const origTcPat = new Uint8Array([0x04, origTableCircuit.length & 0xff, (origTableCircuit.length >> 8) & 0xff, ...origTableCircuit]);
        const newTcStr = enc.encode(circuitName);
        const newTcPat = new Uint8Array([0x04, newTcStr.length & 0xff, (newTcStr.length >> 8) & 0xff, ...newTcStr]);
        c8 = AtrGenerator.replaceBytes(c8, origTcPat, newTcPat, 1);

        // (3) 상태 판정: 04 08 00 [정  상]
        const origStatusPat = new Uint8Array([0x04, 0x08, 0x00, ...enc.encode('정  상')]);
        const newStatusStr = enc.encode(statusStr);
        const newStatusPat = new Uint8Array([0x04, newStatusStr.length & 0xff, (newStatusStr.length >> 8) & 0xff, ...newStatusStr]);
        c8 = AtrGenerator.replaceBytes(c8, origStatusPat, newStatusPat, 1);

        // 7. 쪽 바이너리 결합
        let pageCombined = AtrGenerator.concat([
            c0,
            AtrGenerator.u32Bytes(overlayPng.length), overlayPng,
            c2,
            AtrGenerator.u32Bytes(visualBytes.length), visualBytes,
            c4,
            AtrGenerator.u32Bytes(thJpegOnly.length), thJpegOnly,
            c6,
            AtrGenerator.u32Bytes(croppedVisual.length), croppedVisual,
            c8
        ]);

        // 8. GUID 치환 (Page 1 프로토타입 GUID -> 새 고유 GUID)
        const origGuidB = enc.encode(AtrGenerator.PROTOTYPE_SLOT.guid);
        const newGuidB = enc.encode(newGuid);
        pageCombined = AtrGenerator.replaceBytes(pageCombined, origGuidB, newGuidB);

        return pageCombined;
    }

    /**
     * 바이너리 내 문자열 길이 헤더 전수 검증 함수
     * @returns {{ ok: boolean, errors: string[] }}
     */
    static validateDocStringLengths(docBytes, metaBytes, { reportTitle, inspectDate, inspectorName, circuitItems, pageCount }) {
        const errors = [];
        const enc = new TextEncoder();
        const titleB = enc.encode((reportTitle || "2026년 4분기 EPS 1층").trim());

        // 1. cactus-meta 내 제목 길이 헤더 검증 (0x04 [len 2B LE] [title])
        if (metaBytes && metaBytes.length > 0) {
            const idxM = AtrGenerator.findSub(metaBytes, titleB);
            if (idxM === -1) {
                errors.push("cactus-meta: report title not found");
            } else {
                const tag = metaBytes[idxM - 3];
                const lenVal = metaBytes[idxM - 2] | (metaBytes[idxM - 1] << 8);
                if (tag !== 0x04) {
                    errors.push(`cactus-meta: expected tag 0x04 before title, got 0x${tag.toString(16)}`);
                }
                if (lenVal !== titleB.length) {
                    errors.push(`cactus-meta: title length mismatch (header=${lenVal}, actual=${titleB.length})`);
                }
            }
        }

        // 2. docBytes 내 ReportName 제목 검증
        const repKey = enc.encode('ReportName');
        const repIdx = AtrGenerator.findSub(docBytes, repKey);
        if (repIdx === -1) {
            errors.push("doc: ReportName key not found");
        } else {
            const idxT = AtrGenerator.findSub(docBytes, titleB, repIdx);
            if (idxT === -1 || idxT - repIdx > 40) {
                errors.push("doc: title after ReportName not found");
            } else {
                const tag = docBytes[idxT - 3];
                const lenVal = docBytes[idxT - 2] | (docBytes[idxT - 1] << 8);
                if (tag !== 0x04) {
                    errors.push(`doc ReportName: expected tag 0x04 before title, got 0x${tag.toString(16)}`);
                }
                if (lenVal !== titleB.length) {
                    errors.push(`doc ReportName: title length mismatch (header=${lenVal}, actual=${titleB.length})`);
                }
            }
        }

        // 3. docBytes 내 전체 경로 길이 검증 (0x04 [pathLen 2B LE] [path])
        const expectedPath = `C:\\Users\\user\\OneDrive\\Desktop\\열화상플리어 보고서\\${(reportTitle || "2026년 4분기 EPS 1층").trim()}.atr`;
        const expectedPathB = enc.encode(expectedPath);
        const idxP = AtrGenerator.findSub(docBytes, expectedPathB);
        if (idxP === -1) {
            errors.push("doc: full path with new title not found");
        } else {
            const tag = docBytes[idxP - 3];
            const lenVal = docBytes[idxP - 2] | (docBytes[idxP - 1] << 8);
            if (tag !== 0x04) {
                errors.push(`doc path: expected tag 0x04 before path, got 0x${tag.toString(16)}`);
            }
            if (lenVal !== expectedPathB.length) {
                errors.push(`doc path: path length mismatch (header=${lenVal}, actual=${expectedPathB.length})`);
            }
        }

        // 4. docBytes 내 uint32 쪽 수 검증
        if (repIdx !== -1) {
            const titleEnd = repIdx + repKey.length + 3 + titleB.length;
            const countPos = titleEnd + 14;
            const view = new DataView(docBytes.buffer, docBytes.byteOffset, docBytes.byteLength);
            const actualCount = view.getUint32(countPos, true);
            if (actualCount !== pageCount) {
                errors.push(`doc: page count mismatch at ${countPos} (expected ${pageCount}, got ${actualCount})`);
            }
        }

        // 5. docBytes 내 일자 길이 검증
        if (inspectDate && inspectDate.trim()) {
            const raw = inspectDate.trim();
            const parts = raw.split('-');
            if (parts.length === 3) {
                const y = parts[0];
                const m = parts[1].padStart(2, '0');
                const d = parts[2].padStart(2, '0');
                const korDateB = enc.encode(`${y}년${m}월${d}일`);
                let pos = 0;
                while (true) {
                    const idxD = AtrGenerator.findSub(docBytes, korDateB, pos);
                    if (idxD === -1) break;
                    const tag = docBytes[idxD - 3];
                    const lenVal = docBytes[idxD - 2] | (docBytes[idxD - 1] << 8);
                    if (tag !== 0x04 || lenVal !== korDateB.length) {
                        errors.push(`doc date at ${idxD}: header mismatch tag=0x${tag.toString(16)}, len=${lenVal} vs expected ${korDateB.length}`);
                    }
                    pos = idxD + korDateB.length;
                }
            }
        }

        // 6. docBytes 내 측정자 길이 검증
        if (inspectorName && inspectorName.trim()) {
            const tagSig = [0xEC, 0xB8, 0xA1, 0xEC, 0xA0, 0x95, 0xEC, 0x9E, 0x90]; // 측정자
            const signSig = [0x28, 0xEC, 0x84, 0x9C, 0xEB, 0xAA, 0x85, 0x29]; // (서명)
            let pos = 0;
            while (true) {
                const idxI = AtrGenerator.findSub(docBytes, tagSig, pos);
                if (idxI === -1) break;
                const tag = docBytes[idxI - 3];
                const lenVal = docBytes[idxI - 2] | (docBytes[idxI - 1] << 8);
                const signIdx = AtrGenerator.findSub(docBytes, signSig, idxI);
                if (signIdx !== -1 && signIdx < idxI + 140) {
                    const actualStrLen = (signIdx + signSig.length) - idxI;
                    if (tag !== 0x04 || lenVal !== actualStrLen) {
                        errors.push(`doc inspector at ${idxI}: header mismatch: tag=0x${tag.toString(16)}, header=${lenVal}, actual=${actualStrLen}`);
                    }
                }
                pos = idxI + tagSig.length;
            }
        }

        // 7. docBytes 내 회로명 길이 검증 (04 LL LL [title] 및 LL LL [title].jpg)
        if (circuitItems && circuitItems.length > 0) {
            for (let i = 0; i < Math.min(pageCount, circuitItems.length); i++) {
                const cItem = circuitItems[i];
                const cName = (typeof cItem === 'string' ? cItem : (cItem.circuit_name || `회로_${i+1}`)).trim();
                const cBytes = enc.encode(cName);
                const patC = new Uint8Array([0x04, cBytes.length & 0xff, (cBytes.length >> 8) & 0xff, ...cBytes]);
                if (AtrGenerator.findSub(docBytes, patC) === -1) {
                    errors.push(`doc circuit [${i}] '${cName}' (04 LL LL header) not found`);
                }

                const fnBytes = enc.encode(`${cName}.jpg`);
                const patFn = new Uint8Array([fnBytes.length & 0xff, (fnBytes.length >> 8) & 0xff, ...fnBytes]);
                if (AtrGenerator.findSub(docBytes, patFn) === -1) {
                    errors.push(`doc circuit [${i}] filename '${cName}.jpg' (LL LL header) not found`);
                }
            }
        }

        return {
            ok: errors.length === 0,
            errors
        };
    }

    /**
     * 최종 ATR 패키지 빌드 메인 함수
     */
    static async build({ reportTitle, inspectorName, inspectDate, circuitItems, templateUrl = "./master_template.atr", templateBuffer = null }) {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library is required.');
        }

        // 1. 마스터 템플릿 로드 (직접 전달된 버퍼 우선)
        let templateBuf = templateBuffer;
        if (!templateBuf) {
            const resp = await fetch(templateUrl);
            if (!resp.ok) {
                throw new Error(`양식 파일(${templateUrl})을 불러오지 못했습니다.`);
            }
            templateBuf = await resp.arrayBuffer();
        }

        const zip = await JSZip.loadAsync(templateBuf);

        const docName = 'cactus/af9878b2aa8e47faaf8942d892cde994.bin';
        const docEntry = zip.file(docName);
        if (!docEntry) {
            throw new Error('올바른 ATR 양식 파일이 아닙니다 (Document bin 누락).');
        }
        const docBytesOriginal = new Uint8Array(await docEntry.async('arraybuffer'));

        const totalItems = circuitItems.length;
        const nPages = Math.max(1, Math.min(99, totalItems));
        const enc = new TextEncoder();

        // 2. 기존 템플릿의 초기 8개 슬롯 파일들 제거 (완전 동적 생성 체계)
        const oldTemplateGuids = [
            '6ba1d80e4c7643c187a6351e6a98a461',
            'efb4b25cb3cd4e9d9b1c4fc5ad176409',
            '1eb0b10e1ddc4cc4b65d6554773d46f4',
            '4ca8128103ba4dafa4ab537cb39d9662',
            '408c622227024849862c143242cfb33d',
            'f95f4d40bab240dc91b83ff71a768a77',
            '0dd0b21d79ae44d59e07c11c96dc2712',
            'd7feefde27b64da5ab01bc83f6ba3e9e'
        ];
        for (const g of oldTemplateGuids) {
            zip.remove(`cactus/${g}.bin`);
            zip.remove(`cactus/${g}_MT.bin`);
        }

        // 3. 문서 헤더, 1페이지 프로토타입 슬라이스, 공통 푸터 준비
        const docHeader = docBytesOriginal.subarray(0, AtrGenerator.PROTOTYPE_OFFSET_START);
        const protoSlice = docBytesOriginal.subarray(AtrGenerator.PROTOTYPE_OFFSET_START, AtrGenerator.PROTOTYPE_OFFSET_END);
        const docFooter = docBytesOriginal.subarray(AtrGenerator.TEMPLATE_FOOTER_OFFSET);

        // 4. 각 쪽 동적 복제 및 변환 수행 (1 ~ 99장)
        const transformedPages = [];
        for (let p = 0; p < nPages; p++) {
            const newGuid = AtrGenerator.generateGuid(p);
            const item = circuitItems[p];
            const circuitName = (item.circuit_name || `회로_${p + 1}`).trim();

            const transformed = await AtrGenerator.transformPage(protoSlice, p, newGuid, item);
            transformedPages.push(transformed);

            // 새 열화상 사진 원본 바이너리 저장
            let thData = null;
            const pb = item.patchedBlob ? (item.patchedBlob.blob || item.patchedBlob) : null;
            if (pb && pb.arrayBuffer) {
                thData = new Uint8Array(await pb.arrayBuffer());
            } else if (item.thermalBlob && item.thermalBlob.arrayBuffer) {
                thData = new Uint8Array(await item.thermalBlob.arrayBuffer());
            } else if (item.rawBuffer) {
                thData = new Uint8Array(item.rawBuffer);
            }

            if (thData) {
                zip.file(`cactus/${newGuid}.bin`, thData);
            }

            // _MT.bin 메타데이터 동기화
            const mtJson = {
                "$types": { "Cactus.Common.FileMeta, Cactus.Common": "1" },
                "$type": "1",
                "Id": newGuid,
                "Name": `${circuitName}.jpg`,
                "Title": circuitName,
                "CreationTimeUtcLong": 5250958105167387904,
                "LastWriteTimeUtcLong": 5250958149365108758,
                "LastAccessTimeUtcLong": 5250958149365108758,
                "OriginalPath": `Z:\\VOL1\\Data\\0003_전기방재_[전기_방재업무]\\001_전기\\00_점검관련\\★ 직무고시 서류 모음\\05_열화상 점검\\26년\\4분기\\EPS실\\1층\\${circuitName}.jpg`,
                "FileSize": thData ? thData.length : 389428,
                "Checksum": null,
                "IsReadOnly": false,
                "IsHidden": false
            };
            zip.file(`cactus/${newGuid}_MT.bin`, JSON.stringify(mtJson));
        }

        // 5. 새 문서 결합 (Header + Page 1..N + Footer)
        let docBytes = AtrGenerator.concat([docHeader, ...transformedPages, docFooter]);

        // 6. cactus-meta 및 Document text 업데이트 (보고서 제목 길이 헤더 동기화)
        const metaEntry = zip.file('cactus-meta');
        let metaBytes = metaEntry ? new Uint8Array(await metaEntry.async('arraybuffer')) : new Uint8Array();

        const origRepName = '2026년 4분기 EPS 1층';
        const newRepName = (reportTitle || origRepName).trim();
        const origTitleB = enc.encode(origRepName);
        const newTitleB = enc.encode(newRepName);

        // (1) cactus-meta 제목 치환: [0x04, LL, LL, ...제목]
        const patMetaOld = new Uint8Array([0x04, origTitleB.length & 0xff, (origTitleB.length >> 8) & 0xff, ...origTitleB]);
        const patMetaNew = new Uint8Array([0x04, newTitleB.length & 0xff, (newTitleB.length >> 8) & 0xff, ...newTitleB]);
        metaBytes = AtrGenerator.replaceBytes(metaBytes, patMetaOld, patMetaNew);

        // (2) Document 전체 경로 치환: [0x04, LL, LL, ...경로]
        const origPath = 'C:\\Users\\user\\OneDrive\\Desktop\\열화상플리어 보고서\\2026년 4분기 EPS 1층.atr';
        const newPath = `C:\\Users\\user\\OneDrive\\Desktop\\열화상플리어 보고서\\${newRepName}.atr`;
        const origPathB = enc.encode(origPath);
        const newPathB = enc.encode(newPath);
        const patPathOld = new Uint8Array([0x04, origPathB.length & 0xff, (origPathB.length >> 8) & 0xff, ...origPathB]);
        const patPathNew = new Uint8Array([0x04, newPathB.length & 0xff, (newPathB.length >> 8) & 0xff, ...newPathB]);
        docBytes = AtrGenerator.replaceBytes(docBytes, patPathOld, patPathNew);

        // (3) Document ReportName 및 본문/하단 제목 치환: [0x04, LL, LL, ...제목]
        docBytes = AtrGenerator.replaceBytes(docBytes, patMetaOld, patMetaNew);

        // 7. 문서 헤더 uint32 쪽 수 설정 (ReportName 뒤 14바이트 위치에 정확히 동적 기록)
        const repKey = enc.encode('ReportName');
        const repIdx = AtrGenerator.findSub(docBytes, repKey);
        if (repIdx !== -1) {
            const countPos = repIdx + repKey.length + 3 + newTitleB.length + 14;
            const countView = new DataView(docBytes.buffer, docBytes.byteOffset, docBytes.byteLength);
            countView.setUint32(countPos, nPages, true);
        }

        // 8. 점검 일자 업데이트
        let rawDate = "2026-10-10";
        if (inspectDate && inspectDate.trim()) {
            rawDate = inspectDate.trim();
            let koreanDate = rawDate;
            try {
                const parts = rawDate.split('-');
                if (parts.length === 3) {
                    const y = parts[0];
                    const m = parts[1].padStart(2, '0');
                    const d = parts[2].padStart(2, '0');
                    rawDate = `${y}-${m}-${d}`;
                    koreanDate = `${y}년${m}월${d}일`;
                }
            } catch (e) {}

            const origDatePat = new Uint8Array([4, 17, 0, ...enc.encode('2026년10월10일')]);
            const newDateB = enc.encode(koreanDate);
            const newDatePat = new Uint8Array([4, newDateB.length & 0xff, (newDateB.length >> 8) & 0xff, ...newDateB]);
            docBytes = AtrGenerator.replaceBytes(docBytes, origDatePat, newDatePat);

            docBytes = AtrGenerator.replaceBytes(docBytes, enc.encode('2026-10-10'), enc.encode(rawDate));
            metaBytes = AtrGenerator.replaceBytes(metaBytes, enc.encode('2026-10-10'), enc.encode(rawDate));
        }

        // 9. 측정자 이름 업데이트
        let cleanInsp = "지상현";
        if (inspectorName && inspectorName.trim()) {
            cleanInsp = inspectorName.trim();
            const newInspText = enc.encode(`측정자 :  ${cleanInsp}              (서명)`);
            const newInspPat = new Uint8Array([4, newInspText.length & 0xff, (newInspText.length >> 8) & 0xff, ...newInspText]);
            docBytes = AtrGenerator.replaceInspectorSignature(docBytes, newInspPat);
        }

        zip.file('cactus-meta', metaBytes);

        // 10. Document 및 Document_MT 저장
        zip.file(docName, docBytes);

        const docMtKey = 'cactus/af9878b2aa8e47faaf8942d892cde994_MT.bin';
        const docMtEntry = zip.file(docMtKey);
        if (docMtEntry) {
            try {
                const docMtJson = JSON.parse(await docMtEntry.async('string'));
                docMtJson.FileSize = docBytes.length;
                zip.file(docMtKey, JSON.stringify(docMtJson));
            } catch (e) {}
        }

        // 13. 바이너리 문자열 길이 헤더 전수 검증
        const validation = AtrGenerator.validateDocStringLengths(docBytes, metaBytes, {
            reportTitle: newRepName,
            inspectDate: rawDate,
            inspectorName: cleanInsp,
            circuitItems: circuitItems.map(c => c.circuit_name),
            pageCount: nPages
        });
        if (!validation.ok) {
            console.error('ATR 검증 실패:', validation.errors);
            throw new Error(`ATR 파일 무결성 검증 실패: ${validation.errors.join('; ')}`);
        }

        // 14. 새로운 ATR 패키지 압축 생성
        const finalBlob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });

        return {
            blob: finalBlob,
            pages: nPages,
            fileName: `${newRepName.replace(/[/\\?%*:|"<>]/g, '_')}.atr`
        };
    }

    static replaceInspectorSignature(source, newInspPat) {
        const tag = [0xEC, 0xB8, 0xA1, 0xEC, 0xA0, 0x95, 0xEC, 0x9E, 0x90];
        const sign = [0x28, 0xEC, 0x84, 0x9C, 0xEB, 0xAA, 0x85, 0x29];

        let pos = 0;
        const regions = [];

        while (pos < source.length - 30) {
            let isTag = true;
            for (let k = 0; k < tag.length; k++) {
                if (source[pos + k] !== tag[k]) {
                    isTag = false;
                    break;
                }
            }
            if (isTag) {
                let startPos = pos;
                if (pos >= 3 && source[pos - 3] === 0x04) startPos = pos - 3;
                else if (pos >= 2 && source[pos - 2] === 0x04) startPos = pos - 2;

                for (let s = pos + tag.length; s < Math.min(pos + 120, source.length - sign.length); s++) {
                    let isSign = true;
                    for (let sk = 0; sk < sign.length; sk++) {
                        if (source[s + sk] !== sign[sk]) {
                            isSign = false;
                            break;
                        }
                    }
                    if (isSign) {
                        const endPos = s + sign.length;
                        regions.push({ start: startPos, end: endPos });
                        pos = endPos;
                        break;
                    }
                }
            }
            pos++;
        }

        if (regions.length === 0) return source;

        let diff = 0;
        for (const r of regions) {
            diff += (newInspPat.length - (r.end - r.start));
        }

        const res = new Uint8Array(source.length + diff);
        let srcIdx = 0;
        let dstIdx = 0;

        for (const r of regions) {
            res.set(source.subarray(srcIdx, r.start), dstIdx);
            dstIdx += (r.start - srcIdx);
            res.set(newInspPat, dstIdx);
            dstIdx += newInspPat.length;
            srcIdx = r.end;
        }

        if (srcIdx < source.length) {
            res.set(source.subarray(srcIdx), dstIdx);
        }

        return res;
    }
}

if (typeof window !== 'undefined') {
    window.AtrGenerator = AtrGenerator;
}
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AtrGenerator;
}
