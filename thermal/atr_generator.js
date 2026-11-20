/**
 * atr_generator.js
 * 브라우저 순수 자바스크립트 FLIR Thermal Studio .atr 리포트 생성기
 * - JSZip 을 활용하여 master_template.atr 을 기반으로 N쪽 동적 슬라이싱 및 생성
 * - 회로명, 측정자, 점검일자 바이너리 치환
 * - 열화상 원본 사진 및 스팟 메타데이터 패키징
 * - PC 로컬 다운로드 및 WS_THERMAL 통로를 통한 보고서 기록 보관
 * - ArrayBuffer 직접 주입 지원 (file:// 환경 및 IndexedDB 캐시 대응)
 */

class AtrGenerator {
    static TEMPLATE_SLOTS = [
        { circuit: "1층1번일반", guid: "6ba1d80e4c7643c187a6351e6a98a461", orig_name: "1층1번일반 (3).jpg" },
        { circuit: "1층1번비상", guid: "1eb0b10e1ddc4cc4b65d6554773d46f4", orig_name: "1층1번비상 (3).jpg" },
        { circuit: "1층2번일반", guid: "efb4b25cb3cd4e9d9b1c4fc5ad176409", orig_name: "1층2번일반 (3).jpg" },
        { circuit: "1층2번비상", guid: "408c622227024849862c143242cfb33d", orig_name: "1층2번비상 (3).jpg" },
        { circuit: "1층3번일반", guid: "f95f4d40bab240dc91b83ff71a768a77", orig_name: "1층3번일반 (3).jpg" },
        { circuit: "1층3번비상", guid: "d7feefde27b64da5ab01bc83f6ba3e9e", orig_name: "1층3번비상 (3).jpg" },
        { circuit: "1층4번일반", guid: "4ca8128103ba4dafa4ab537cb39d9662", orig_name: "1층4번일반 (3).jpg" },
        { circuit: "1층4번비상", guid: "0dd0b21d79ae44d59e07c11c96dc2712", orig_name: "1층4번비상 (3).jpg" }
    ];

    static PAGE_OFFSETS = [58303, 535258, 985745, 1460417, 1933996, 2421127, 2885227, 3351111, 3825001];
    static PAGE_COUNT_POS = 55903;

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
        let docBytes = new Uint8Array(await docEntry.async('arraybuffer'));

        const totalItems = circuitItems.length;
        const nPages = Math.max(1, Math.min(AtrGenerator.TEMPLATE_SLOTS.length, totalItems));

        const enc = new TextEncoder();

        // 2. cactus-meta 업데이트
        const metaEntry = zip.file('cactus-meta');
        let metaBytes = metaEntry ? new Uint8Array(await metaEntry.async('arraybuffer')) : new Uint8Array();

        const origRepName = '2026년 4분기 EPS 1층';
        const newRepName = (reportTitle || origRepName).trim();
        const origB = enc.encode(origRepName);
        const newB = enc.encode(newRepName);

        metaBytes = AtrGenerator.replaceBytes(metaBytes, origB, newB);
        docBytes = AtrGenerator.replaceBytes(docBytes, origB, newB);

        // 3. 점검 일자 업데이트
        if (inspectDate && inspectDate.trim()) {
            const rawDate = inspectDate.trim();
            let koreanDate = rawDate;
            try {
                const parts = rawDate.split('-');
                if (parts.length === 3) {
                    koreanDate = `${parts[0]}년${parts[1]}월${parts[2]}일`;
                }
            } catch (e) {}

            const origDatePat = new Uint8Array([4, 17, 0, ...enc.encode('2026년10월10일')]);
            const newDateB = enc.encode(koreanDate);
            const newDatePat = new Uint8Array([4, newDateB.length & 0xff, (newDateB.length >> 8) & 0xff, ...newDateB]);
            docBytes = AtrGenerator.replaceBytes(docBytes, origDatePat, newDatePat);

            docBytes = AtrGenerator.replaceBytes(docBytes, enc.encode('2026-10-10'), enc.encode(rawDate));
            metaBytes = AtrGenerator.replaceBytes(metaBytes, enc.encode('2026-10-10'), enc.encode(rawDate));
        }

        // 4. 측정자 이름 업데이트
        if (inspectorName && inspectorName.trim()) {
            const cleanInsp = inspectorName.trim();
            const newInspText = enc.encode(`측정자 :  ${cleanInsp}              (서명)`);
            const newInspPat = new Uint8Array([4, newInspText.length & 0xff, (newInspText.length >> 8) & 0xff, ...newInspText]);
            docBytes = AtrGenerator.replaceInspectorSignature(docBytes, newInspPat);
        }

        zip.file('cactus-meta', metaBytes);

        // 5. 사진 수만큼 쪽 슬라이싱 (nPages < 8 인 경우)
        if (nPages < 8) {
            const splitStart = AtrGenerator.PAGE_OFFSETS[nPages];
            const splitEnd = AtrGenerator.PAGE_OFFSETS[8];

            const slicedDoc = new Uint8Array(splitStart + (docBytes.length - splitEnd));
            slicedDoc.set(docBytes.subarray(0, splitStart), 0);
            slicedDoc.set(docBytes.subarray(splitEnd), splitStart);

            const countView = new DataView(slicedDoc.buffer, slicedDoc.byteOffset, slicedDoc.byteLength);
            countView.setUint32(AtrGenerator.PAGE_COUNT_POS, nPages, true);

            docBytes = slicedDoc;
        }

        // 6. 각 슬롯의 새 사진 및 회로 이름 반영
        for (let i = 0; i < nPages; i++) {
            const slot = AtrGenerator.TEMPLATE_SLOTS[i];
            const item = circuitItems[i];
            const guid = slot.guid;

            const circuitName = (item.circuit_name || `회로_${i+1}`).trim();
            const mtKey = `cactus/${guid}_MT.bin`;

            let oldName = slot.orig_name || `${slot.circuit} (3).jpg`;
            let oldTitle = `${slot.circuit} (3)`;
            let oldPath = null;

            const mtEntry = zip.file(mtKey);
            let mtJson = null;
            if (mtEntry) {
                try {
                    mtJson = JSON.parse(await mtEntry.async('string'));
                    if (mtJson.Name) oldName = mtJson.Name;
                    if (mtJson.Title) oldTitle = mtJson.Title;
                    if (mtJson.OriginalPath) oldPath = mtJson.OriginalPath;
                } catch (e) {}
            }

            const newTitle = circuitName;
            const newName = `${circuitName}.jpg`;
            let newPath = oldPath;
            if (oldPath && oldPath.includes('\\')) {
                newPath = oldPath.substring(0, oldPath.lastIndexOf('\\') + 1) + newName;
            }

            // (1) Title 치환
            const oldTitleB = enc.encode(oldTitle);
            const newTitleB = enc.encode(newTitle);
            const patTitleOld = new Uint8Array([oldTitleB.length & 0xff, (oldTitleB.length >> 8) & 0xff, ...oldTitleB]);
            const patTitleNew = new Uint8Array([newTitleB.length & 0xff, (newTitleB.length >> 8) & 0xff, ...newTitleB]);
            docBytes = AtrGenerator.replaceBytes(docBytes, patTitleOld, patTitleNew, 1);

            // (2) FileName 치환
            const oldFnB = enc.encode(oldName);
            const newFnB = enc.encode(newName);
            const patFnOld = new Uint8Array([oldFnB.length & 0xff, (oldFnB.length >> 8) & 0xff, ...oldFnB]);
            const patFnNew = new Uint8Array([newFnB.length & 0xff, (newFnB.length >> 8) & 0xff, ...newFnB]);
            docBytes = AtrGenerator.replaceBytes(docBytes, patFnOld, patFnNew, 1);

            // (3) OriginalPath 치환
            if (oldPath && newPath) {
                const oldPathB = enc.encode(oldPath);
                const newPathB = enc.encode(newPath);
                const patPathOld = new Uint8Array([oldPathB.length & 0xff, (oldPathB.length >> 8) & 0xff, ...oldPathB]);
                const patPathNew = new Uint8Array([newPathB.length & 0xff, (newPathB.length >> 8) & 0xff, ...newPathB]);
                docBytes = AtrGenerator.replaceBytes(docBytes, patPathOld, patPathNew);
            }

            // 새 열화상 사진 바이너리 저장
            let thData = null;
            if (item.patchedBlob) {
                thData = new Uint8Array(await item.patchedBlob.arrayBuffer());
            } else if (item.rawBuffer) {
                thData = new Uint8Array(item.rawBuffer);
            }

            if (thData) {
                zip.file(`cactus/${guid}.bin`, thData);
            }

            // _MT.bin 메타데이터 동기화
            if (mtJson) {
                mtJson.Name = newName;
                mtJson.Title = newTitle;
                if (newPath) mtJson.OriginalPath = newPath;
                if (thData) mtJson.FileSize = thData.length;
                zip.file(mtKey, JSON.stringify(mtJson));
            }
        }

        // 7. 미사용 슬롯 제거
        for (let i = nPages; i < AtrGenerator.TEMPLATE_SLOTS.length; i++) {
            const slot = AtrGenerator.TEMPLATE_SLOTS[i];
            zip.remove(`cactus/${slot.guid}.bin`);
            zip.remove(`cactus/${slot.guid}_MT.bin`);
        }

        // 8. Document 및 Document_MT 저장
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

        // 9. 새로운 ATR 패키지 압축 생성
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

window.AtrGenerator = AtrGenerator;
