/* ==========================================================================
   storeExcel.js - 매장 상세내역 엑셀 받기·올리기 (결정 154)
   건물마다 파일 1개, 층마다 시트 1개. 올리기는 확인 창에서 [저장]을 눌러야 들어감.
   ========================================================================== */

var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
var EXCEL_MAX_BYTES = 5 * 1024 * 1024;

function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, no) => {
        const sc = document.createElement('script');
        sc.src = XLSX_URL; sc.onload = ok;
        sc.onerror = () => no(new Error('엑셀 도구를 불러오지 못했습니다. 인터넷을 확인해 주세요.'));
        document.head.appendChild(sc);
    });
}

/** 번호가 아직 없는 층을 차례로 열어 번호를 만듦 (고칠 수 있는 사람만, 건물마다 처음 한 번) */
async function prepareStoreBooks() {
    if (mapStore.readOnly()) return;
    const back = currentFloorIdx;
    const todo = FLOORS.map((f, i) => i).filter(i => !mapStore.getItem(getStoreBookKey(FLOORS[i].code)));
    if (!todo.length) return;
    showToast('층별 매장 번호를 처음 한 번 만듭니다.', 1800);
    for (const i of todo) await selectFloor(i, true);
    await selectFloor(back, true);
}

async function downloadStoreExcel() {
    try {
        await loadXlsx();
        await prepareStoreBooks();
        const wb = XLSX.utils.book_new();
        FLOORS.slice().reverse().forEach(f => {
            const book = getStoreBook(f.code);
            const sheet = StoreBook.buildSheet(StoreBook.itemsWith(getStoreItems(), book), book);
            const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
            ws['!merges'] = sheet.merges;
            ws['!cols'] = sheet.aoa[0].map((x, i) => ({ wch: i === 1 ? 24 : 10 }));
            XLSX.utils.book_append_sheet(wb, ws, StoreBook.sheetName(f));
        });
        XLSX.writeFile(wb, `${currentBuilding.name} 매장.xlsx`);
    } catch (e) {
        showToast(e && e.message ? e.message : '엑셀을 만들지 못했습니다.', 2600);
    }
}

function pickStoreExcel() {
    if (mapStore.readOnly()) return showToast('지도는 소장·부소장·파트장·옵저버만 고칠 수 있습니다.', 1800);
    const inp = document.getElementById('store-excel-file');
    inp.value = '';
    inp.click();
}

async function onStoreExcelPicked(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > EXCEL_MAX_BYTES) return showToast('엑셀 파일이 너무 큽니다 (5MB 넘음).', 2600);
    try {
        await loadXlsx();
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const sheets = wb.SheetNames.map(name => ({
            name, merges: wb.Sheets[name]['!merges'] || [],
            rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false })
        }));
        await prepareStoreBooks();
        const books = {};
        FLOORS.forEach(f => { books[f.code] = getStoreBook(f.code); });
        showStoreExcelPlan(StoreBook.planUpload(sheets, FLOORS, books, getStoreItems()));
    } catch (e) {
        showToast('엑셀 파일을 읽지 못했습니다. 양식을 확인해 주세요.', 2600);
    }
}

function showStoreExcelPlan(plan) {
    const e = escapeHtml;
    const MAX_ROWS = 200;
    const change = c => (c.from && c.to) ? `<span class="xl-old">${e(c.from)}</span><b>${e(c.to)}</b>`
        : c.to ? `<span class="xl-mark">새로 입력</span>${e(c.to)}` : `<span class="xl-mark">지움</span><span class="xl-old">${e(c.from)}</span>`;
    const rows = plan.changes.slice(0, MAX_ROWS).map(c => `<tr><td>${e(c.floor)}</td><td>${e(c.name)}${c.shapes > 1 ? ` (도형 ${c.shapes}개)` : ''}</td><td>${e(c.label)}</td><td>${change(c)}</td></tr>`).join('')
        + plan.added.map(d => `<tr><td>전체</td><td colspan="2">새 항목 「${e(StoreBook.labelOf(d))}」</td><td><span class="xl-mark">항목 추가</span></td></tr>`).join('');
    const notes = [];
    if (plan.missing.length) notes.push(`<b class="xl-err">저장하지 않는 줄 ${plan.missing.length}개: 도면에 이 이름의 매장 도형이 없습니다.</b><br>${plan.missing.slice(0, 30).map(m => `${e(m.floor)} 「${e(m.name)}」`).join(' · ')}${plan.missing.length > 30 ? ' …' : ''}<br>이름을 도면과 맞춰 다시 올려 주세요.`);
    if (plan.badSheets.length) notes.push(`<b class="xl-err">읽지 않은 시트 ${plan.badSheets.length}개</b><br>${plan.badSheets.map(e).join('<br>')}`);
    if (plan.rows >= 5 && plan.matched / plan.rows < 0.5) notes.push(`<b class="xl-err">이름이 맞는 줄이 절반도 안 됩니다. ${e(currentBuilding.name)} 파일이 맞는지 확인해 주세요.</b>`);
    const can = plan.changed > 0 || plan.added.length > 0;

    const box = document.createElement('div');
    box.className = 'xl-shade';
    box.innerHTML = `<div class="xl-box" role="dialog" aria-modal="true" aria-label="엑셀 올리기 확인">
        <div class="xl-head"><h3>엑셀 올리기 확인</h3><span class="xl-tag">${e(currentBuilding.name)} · ${plan.floors.length}개 층</span></div>
        <div class="xl-body">
            <div class="xl-sum">
                <div><b>${plan.changed}</b><span>바뀌는 매장</span></div><div><b>${plan.same}</b><span>그대로</span></div>
                <div><b>${plan.added.length}</b><span>새 항목</span></div><div><b>${plan.missing.length}</b><span>도면에 없는 매장</span></div>
            </div>
            ${rows ? `<div class="xl-scroll"><table><thead><tr><th>층</th><th>매장</th><th>항목</th><th>바뀌는 내용</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="xl-none">바뀌는 내용이 없습니다.</p>'}
            ${plan.changes.length > MAX_ROWS ? `<p class="xl-none">앞의 ${MAX_ROWS}줄만 보여 줍니다 (모두 ${plan.changes.length}줄).</p>` : ''}
            ${notes.map(n => `<div class="xl-warn">${n}</div>`).join('')}
        </div>
        <div class="xl-foot"><span>저장 전 모습은 날짜별 기록에 남습니다</span><i></i>
            <button type="button" class="btn-sm" id="xl-cancel">취소</button>
            <button type="button" class="btn-sm btn-sm-primary" id="xl-save" ${can ? '' : 'disabled'}>${plan.changed}곳 저장</button>
        </div></div>`;
    document.body.appendChild(box);
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = ev => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    box.querySelector('#xl-cancel').onclick = close;
    box.querySelector('#xl-save').onclick = async ev => {
        ev.target.disabled = true;
        const failed = await saveStoreExcelPlan(plan);
        close();
        showToast(failed ? '일부 층을 저장하지 못했습니다. 다시 올려 주세요.' : `${plan.changed}곳을 저장했습니다.`, 2200);
    };
    box.querySelector('#xl-cancel').focus();
}

async function saveStoreExcelPlan(plan) {
    if (plan.added.length) saveStoreItems(plan.items);
    Object.keys(plan.books).forEach(code => saveStoreBook(code, plan.books[code]));
    const failed = await mapStore.flush();
    undoStack.length = 0;   // 올리기 전 되돌리기 내역이 올린 값을 덮지 않게 (올리기 전 모습은 날짜별 기록에 있음)
    updateUndoButtonState();
    await selectFloor(currentFloorIdx, true);
    return failed;
}
