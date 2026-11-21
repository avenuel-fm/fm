/* ==========================================================================
   storeBook.js - 매장 대장 규칙 (결정 154, docs/설계/WS_지도_매장대장.md)
   고유번호는 도형에 묶임: 이름을 바꾸거나 지워도 번호·상세내역은 그대로, 도형을 지우면 함께 지움.
   화면·저장소를 건드리지 않는 계산만 둠 (apps/ws/test/store_book_test.js 로 시험).
   ========================================================================== */

var StoreBook = (function () {
    const DEFAULT_ITEMS = [
        { g: '차단기', l: '일반' }, { g: '차단기', l: '일반 from' }, { g: '차단기', l: '비상' }, { g: '차단기', l: '비상 from' },
        { g: '', l: '급수' }, { g: '', l: '배수' }, { g: '', l: '가스' }
    ];
    const PREFIX = { avenuel: 'AV', dept: 'DP', castle: 'CS' };
    const PIPES = ['급수', '배수', '가스'];
    const MOVE_LIMIT = 30, SIZE_LIMIT = 0.2;   // 업체가 도면 파일을 바꿔도 같은 도형으로 볼 거리·크기 차이

    const keyOf = d => (d.g ? `${d.g}|${d.l}` : d.l);
    const labelOf = d => (d.g ? `${d.g} ${d.l}` : d.l);
    const baseOf = shape => String(shape).split('#')[0];
    const show = name => name || '이름 없음';
    const clean = v => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
    const emptyBook = () => ({ next: 1, items: {}, deleted: [] });

    function parseBook(raw) {
        try {
            const b = raw ? JSON.parse(raw) : null;
            if (b && b.items) {
                // 예전 「차단기 from」 한 칸 → 「일반 from」으로 옮김 (결정 172)
                Object.values(b.items).forEach(it => {
                    const d = it.details;
                    if (!d || d['차단기|from'] === undefined) return;
                    if (d['차단기|from'] && !d['차단기|일반 from']) d['차단기|일반 from'] = d['차단기|from'];
                    delete d['차단기|from'];
                });
                return { next: b.next || 1, items: b.items, deleted: b.deleted || [] };
            }
        } catch (e) { /* 망가진 칸은 빈 대장으로 */ }
        return emptyBook();
    }

    /** 저장돼 있던 예전 항목 목록의 「차단기 from」을 「일반 from」·「비상 from」으로 바꿔 줌 */
    function fixItems(items) {
        const i = items.findIndex(d => d.g === '차단기' && d.l === 'from');
        if (i < 0) return items;
        const out = items.filter((_, k) => k !== i);
        const put = (base, l) => {
            if (out.some(d => d.g === '차단기' && d.l === l)) return;
            const k = out.findIndex(d => d.g === '차단기' && d.l === base);
            out.splice(k < 0 ? out.length : k + 1, 0, { g: '차단기', l });
        };
        put('일반', '일반 from'); put('비상', '비상 from');
        return out;
    }

    /** 예전 상세 창에 적어 둔 값을 새 항목으로 옮김 */
    function legacyDetails(fields) {
        const out = {};
        (fields || []).forEach(f => {
            const label = clean(f.label), value = clean(f.value);
            if (!label || !value || value === '-') return;
            const key = label.includes('차단기') ? '차단기|일반' : (label.includes('수도') || label.includes('급수')) ? '급수'
                : label.includes('배수') ? '배수' : label.includes('가스') ? '가스' : label;
            out[key] = value;
        });
        return out;
    }

    function findMoved(book, here, s) {
        let best = null, bestD = Infinity;
        Object.keys(book.items).forEach(id => {
            const it = book.items[id];
            if (here.has(it.shape) || it.x === undefined) return;
            const dx = Math.abs(it.x - s.x), dy = Math.abs(it.y - s.y);
            if (dx > MOVE_LIMIT || dy > MOVE_LIMIT) return;
            if (it.w && s.w && Math.abs(it.w - s.w) / it.w > SIZE_LIMIT) return;
            if (it.h && s.h && Math.abs(it.h - s.h) / it.h > SIZE_LIMIT) return;
            if (dx + dy < bestD) { best = id; bestD = dx + dy; }
        });
        return best;
    }

    /**
     * 도면의 도형과 대장을 맞춤. write=false(보기 전용)면 대장을 바꾸지 않음.
     * 도면에서 못 찾은 번호는 지우지 않고 lost 표시만 함 (지우는 건 사람이 [도형 삭제]를 눌렀을 때뿐).
     */
    function reconcile(book, shapes, buildingId, floorCode, write) {
        const byShape = {};
        Object.keys(book.items).forEach(id => { byShape[book.items[id].shape] = id; });
        if (!write) return { book, byShape, changed: false };
        const here = new Set(shapes.map(s => s.shape));
        let changed = false;
        shapes.forEach(s => {
            let id = byShape[s.shape];
            if (!id) {
                id = findMoved(book, here, s);
                if (id) { delete byShape[book.items[id].shape]; book.items[id].shape = s.shape; byShape[s.shape] = id; changed = true; }
            }
            if (!id) {
                id = `${PREFIX[buildingId] || 'XX'}-${floorCode}-${String(book.next++).padStart(4, '0')}`;
                book.items[id] = { shape: s.shape, name: s.name, type: s.type || 'store', color: s.color || '', details: legacyDetails(s.fields), x: s.x, y: s.y, w: s.w, h: s.h };
                byShape[s.shape] = id;
                changed = true;
            }
        });
        Object.keys(book.items).forEach(id => {
            const it = book.items[id], lost = !here.has(it.shape);
            if (lost !== !!it.lost) { if (lost) it.lost = true; else delete it.lost; changed = true; }
        });
        return { book, byShape, changed };
    }

    /** 도형 삭제: 그 도형의 번호·이름·상세내역을 지우고, 번호는 다시 쓰지 않음 */
    function removeShape(book, shape, remember) {
        const base = baseOf(shape);
        Object.keys(book.items).forEach(id => { if (baseOf(book.items[id].shape) === base) delete book.items[id]; });
        if (remember && !book.deleted.includes(base)) book.deleted.push(base);
        return book;
    }

    function addItems(items, more) {
        const out = items.slice(), have = new Set(out.map(keyOf)), added = [];
        more.forEach(d => { if (!have.has(keyOf(d))) { have.add(keyOf(d)); out.push(d); added.push(d); } });
        return { items: out, added };
    }

    /** 대장에 있는 항목까지 합친 항목 목록 (예전 값에서 넘어온 항목 포함) */
    function itemsWith(items, book) {
        const more = [];
        Object.values(book.items).forEach(it => Object.keys(it.details || {}).forEach(k => {
            const i = k.indexOf('|');
            more.push(i > 0 ? { g: k.slice(0, i), l: k.slice(i + 1) } : { g: '', l: k });
        }));
        return addItems(items, more).items;
    }

    const fields = (items, it) => items.map(d => ({ key: keyOf(d), label: labelOf(d), value: (it.details || {})[keyOf(d)] || '' }));

    /** 상세·수정 창의 묶음: 차단기 / 배관 / 엑셀에서 더한 묶음 */
    function groups(items, it) {
        const out = [];
        items.forEach(d => {
            const title = d.g || (PIPES.includes(d.l) ? '배관' : '추가 항목');
            let g = out.find(x => x.title === title);
            if (!g) { g = { title, rows: [] }; out.push(g); }
            g.rows.push({ key: keyOf(d), label: d.l, value: (it.details || {})[keyOf(d)] || '' });
        });
        return out;
    }

    /** 층 시트 이름 → 층 ('B1층', '1층', '1F' 모두 같은 층) */
    const floorWord = s => clean(s).toUpperCase().replace(/\s/g, '').replace(/(층|F)$/, '').replace(/^0+(?=\d)/, '');
    const sheetName = floor => floorWord(floor.name) + '층';

    /** 시트 한 장 읽기: 머리글 2줄(묶음·세부), 병합 칸은 왼쪽 값을 이어받음. 항목은 열을 더하면 늘어남 */
    function parseSheet(rows, merges) {
        const top = (rows[0] || []).map(clean), sub = (rows[1] || []).map(clean);
        const nameCol = top.indexOf('매장명');
        if (nameCol < 0) return { error: '「매장명」 칸이 없습니다' };
        const twoRows = !sub[nameCol];
        const groupAt = c => {
            if (top[c]) return top[c];
            const m = (merges || []).find(x => x.s.r === 0 && x.s.c <= c && x.e.c >= c);
            return m ? top[m.s.c] : '';
        };
        const columns = [];
        const width = Math.max(top.length, twoRows ? sub.length : 0);
        for (let c = 0; c < width; c++) {
            if (c === nameCol || top[c] === '순번') continue;
            const g = groupAt(c);
            let l = twoRows ? sub[c] : '';
            if (g && /^from$/i.test(l)) {   // 아래 칸의 「from」은 바로 왼쪽 칸(일반·비상)에 붙여 구분
                const prev = columns.slice().reverse().find(x => x.g === g && !/ from$/.test(x.l));
                if (prev) l = prev.l + ' from';
            }
            if (l) columns.push({ c, g, l });
            else if (g) columns.push({ c, g: '', l: g });
        }
        const data = [];
        rows.slice(twoRows ? 2 : 1).forEach(r => {
            const name = clean(r[nameCol]);
            if (!name) return;
            const cells = {};
            columns.forEach(col => { cells[keyOf(col)] = clean(r[col.c]); });
            data.push({ name, cells });
        });
        return { columns: columns.map(x => ({ g: x.g, l: x.l })), rows: data };
    }

    /**
     * 엑셀 올리기 계산 (아직 저장 안 함). 규칙:
     * 도면에 없는 이름 = 저장 안 함 · 같은 이름 도형이 여럿이면 1줄은 모두에, 여러 줄은 번호 순서대로 ·
     * 빈 칸 = 그 값을 지움 · 엑셀에 없는 매장·없는 열 = 그대로
     */
    function planUpload(sheets, floors, books, items) {
        const plan = { changes: [], changed: 0, same: 0, added: [], missing: [], badSheets: [], books: {}, items, rows: 0, matched: 0, floors: [] };
        const byWord = {};
        floors.forEach(f => { byWord[floorWord(f.name)] = f; });
        sheets.forEach(sh => {
            const floor = byWord[floorWord(sh.name)];
            if (!floor) { plan.badSheets.push(`${sh.name}: 이 건물에 없는 층입니다`); return; }
            const parsed = parseSheet(sh.rows, sh.merges);
            if (parsed.error) { plan.badSheets.push(`${sh.name}: ${parsed.error}`); return; }
            const merged = addItems(plan.items, parsed.columns);
            plan.items = merged.items; plan.added.push(...merged.added);
            const book = JSON.parse(JSON.stringify(books[floor.code] || emptyBook()));
            const lines = {};
            parsed.rows.forEach(r => { (lines[r.name] = lines[r.name] || []).push(r); });
            let floorChanged = false;
            Object.keys(lines).forEach(name => {
                const list = lines[name];
                plan.rows += list.length;
                const ids = Object.keys(book.items).filter(id => book.items[id].name === name && !book.items[id].lost).sort();
                if (!ids.length) { list.forEach(() => plan.missing.push({ floor: floor.name, name })); return; }
                if (list.length > ids.length && list.length > 1) {
                    for (let i = ids.length; i < list.length; i++) plan.missing.push({ floor: floor.name, name: `${name} (${i + 1}번째 줄)` });
                }
                plan.matched += Math.min(list.length, ids.length);
                ids.forEach((id, i) => {
                    const row = list.length === 1 ? list[0] : list[i];
                    if (!row) return;
                    const it = book.items[id];
                    it.details = it.details || {};
                    let touched = false;
                    Object.keys(row.cells).forEach(key => {
                        const from = it.details[key] || '', to = row.cells[key];
                        if (from === to) return;
                        const d = parsed.columns.find(c => keyOf(c) === key);
                        plan.changes.push({ floor: floor.name, id, name, shapes: ids.length, label: labelOf(d), from, to });
                        if (to) it.details[key] = to; else delete it.details[key];
                        touched = true;
                    });
                    if (touched) { plan.changed++; floorChanged = true; } else plan.same++;
                });
            });
            plan.floors.push(floor.code);
            if (floorChanged) plan.books[floor.code] = book;
        });
        return plan;
    }

    /** 엑셀 받기: 올려 주신 양식과 같은 모양의 한 시트 (이름 없는 도형·못 찾은 도형은 뺌) */
    function buildSheet(items, book) {
        const top = ['순번', '매장명'], sub = ['', ''], merges = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }];
        items.forEach((d, i) => {
            const c = i + 2;
            if (!d.g) { top.push(d.l); sub.push(''); merges.push({ s: { r: 0, c }, e: { r: 1, c } }); return; }
            const same = i > 0 && items[i - 1].g === d.g;
            top.push(same ? '' : d.g); sub.push(/ from$/.test(d.l) ? 'from' : d.l);
            if (same) {
                const m = merges.find(x => x.s.r === 0 && x.e.r === 0 && x.e.c === c - 1);
                if (m) m.e.c = c; else merges.push({ s: { r: 0, c: c - 1 }, e: { r: 0, c } });
            }
        });
        const ids = Object.keys(book.items).filter(id => book.items[id].name && !book.items[id].lost).sort();
        const rows = ids.map((id, i) => [i + 1, book.items[id].name].concat(items.map(d => (book.items[id].details || {})[keyOf(d)] || '')));
        return { aoa: [top, sub].concat(rows), merges };
    }

    return { DEFAULT_ITEMS, keyOf, labelOf, baseOf, show, clean, parseBook, fixItems, emptyBook, reconcile, removeShape, addItems, itemsWith, fields, groups, floorWord, sheetName, parseSheet, planUpload, buildSheet };
})();

if (typeof module !== 'undefined') module.exports = StoreBook;
