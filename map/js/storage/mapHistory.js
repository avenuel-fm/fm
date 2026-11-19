/* ==========================================================================
   mapHistory.js - 지도 기록: 날짜별 모습 보기 · 소장 「이 날로 되돌리기」 (업무지원 결정 132)
   [기록] 버튼 → 달력(바뀐 날 점) → 고른 날 모습을 보기 전용으로. 소장·부소장·파트장 말고는 늘 보기 전용 (결정 134·136)
   시안: docs/시안/WS-지도기록/
   ========================================================================== */
(function () {
    const CSS = `
.hist-wrap{position:relative}
.hist-pop{position:absolute;top:44px;right:0;z-index:999;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.18);padding:14px;width:300px;max-width:calc(100vw - 24px);font-size:13px;color:#0f172a}
.hist-pop h4{margin:0 0 10px;display:flex;justify-content:space-between;align-items:center;font-size:15px}
.hist-pop h4 button{border:1px solid #e2e8f0;background:#fff;border-radius:8px;width:32px;height:32px;cursor:pointer;font-size:16px}
.hist-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;text-align:center}
.hist-cal .w{color:#94a3b8;font-size:11px;padding:2px 0}
.hist-cal .d{height:36px;border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#cbd5e1;border:0;background:none;font:inherit}
.hist-cal .d.on{color:#0f172a;font-weight:600;cursor:pointer}
.hist-cal .d.on:hover{background:#f1f5f9}
.hist-cal .d.chg::after{content:'';width:5px;height:5px;border-radius:50%;background:#1d4ed8;margin-top:2px}
.hist-cal .d.sel{background:#1d4ed8;color:#fff}.hist-cal .d.sel::after{background:#fff}
.hist-cal .d.today{outline:1.5px solid #1d4ed8}
.hist-list{margin-top:12px;border-top:1px solid #f1f5f9;padding-top:10px;display:flex;flex-direction:column;gap:6px;color:#475569;max-height:180px;overflow:auto;line-height:1.5}
.hist-list b{color:#0f172a}.hist-list button{border:0;background:none;color:#1d4ed8;font:inherit;font-weight:600;cursor:pointer;padding:0}
.hist-bar{position:absolute;left:0;right:0;top:0;z-index:30;background:#fffbeb;border-bottom:1px solid #fcd34d;display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;padding:8px 16px;font-size:14px;color:#78350f}
.hist-bar b{font-size:15px}.hist-bar .sp{flex:1}
.hist-bar button{min-height:36px;padding:0 14px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px}
.hist-bar .back{background:#fff;border:1px solid #d6d3d1;color:#1c1917}
.hist-bar .rest{background:#b91c1c;border:1px solid #b91c1c;color:#fff}
body.hist-view .map-top-left-group,body.hist-view .map-top-right-group{margin-top:56px}
.btn.hist-on{background:#eff6ff;border-color:#1d4ed8;color:#1d4ed8}
.ro-chip{display:inline-flex;align-items:center;height:28px;padding:0 10px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:12px;font-weight:600;white-space:nowrap}
body.map-ro #btn-edit-menu,body.map-ro #btn-undo,body.map-ro #btn-status-edit,body.map-ro #btn-popover-delete{opacity:.4!important;cursor:not-allowed}
.hist-dlg{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}
.hist-dlg>div{background:#fff;border-radius:14px;padding:22px;width:380px;max-width:100%;font-size:14px;line-height:1.6;box-shadow:0 20px 40px rgba(0,0,0,.25);color:#0f172a}
.hist-dlg p{margin:10px 0;color:#475569}.hist-dlg .row{display:flex;gap:8px;justify-content:flex-end}
.hist-dlg button{min-height:40px;padding:0 16px;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px}
.hist-dlg .no{border:1px solid #d6d3d1;background:#fff}.hist-dlg .yes{border:0;background:#b91c1c;color:#fff}`;

    const KIND = { facility_specs: '매장', deleted_stores: '매장', renamed_stores: '매장', custom_stores: '매장', vacant_polygons: '매장', store_book: '매장',
        floor_zones: '구역', symbols: '심벌', util_lines: '연결선', saved_svg: '외벽·도면', base_svg: '업체 도면' };
    const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const md = d => Number(d.slice(5, 7)) + '월 ' + Number(d.slice(8, 10)) + '일';
    const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let H = null, ym = kst().slice(0, 7), pop = null, busy = false;

    /** 칸 이름 → 「1F 매장」. 지금 건물 칸만 (다른 건물은 null) */
    function label(k) {
        if (k === 'lotte_scale_settings' + suffix()) return '축척';
        if (k === 'lotte_store_items' + suffix()) return '상세 항목';
        const m = /^lotte_([a-z_]+?)_([A-Za-z0-9]+)(_(dept|castle))?$/.exec(k);
        if (!m || (m[4] || '') !== suffix().slice(1) || !KIND[m[1]]) return null;
        return m[2] + ' ' + KIND[m[1]];
    }
    function suffix() { return (typeof currentBuildingId !== 'undefined' && currentBuildingId !== 'avenuel') ? '_' + currentBuildingId : ''; }

    const EDIT_BTNS = ['btn-edit-menu', 'btn-undo', 'btn-status-edit', 'btn-popover-delete'];
    function setMode() {
        const ro = mapStore.readOnly();
        document.body.classList.toggle('map-ro', ro);
        EDIT_BTNS.forEach(id => { const b = document.getElementById(id); if (!b) return;   // 보기 전용이면 편집 버튼 꺼 둠 (결정 136)
            b.disabled = ro;
            if (ro) { if (!b.dataset.t) b.dataset.t = b.title || ''; b.title = mapStore.viewAt ? '지난 기록은 고칠 수 없습니다' : '지도는 소장·부소장·파트장·옵저버만 고칠 수 있습니다'; }
            else if (b.dataset.t !== undefined) { b.title = b.dataset.t; delete b.dataset.t; } });
        document.body.classList.toggle('hist-view', !!mapStore.viewAt);
        const btn = document.getElementById('btn-hist');
        if (btn) btn.classList.toggle('hist-on', !!mapStore.viewAt || !!pop);
        let bar = document.querySelector('.hist-bar');
        if (!mapStore.viewAt) { if (bar) bar.remove(); return; }
        if (!bar) { bar = document.createElement('div'); bar.className = 'hist-bar'; document.getElementById('viewport').appendChild(bar); }
        const at = mapStore.viewAt, isDay = /^\d{4}-\d{2}-\d{2}$/.test(at);
        const r = !isDay && H && H.restores.find(x => x.before === at);
        bar.innerHTML = '<b>' + (isDay ? md(at) + ' 기준' : md(r ? r.day : at.slice(0, 10)) + ' ' + (r ? r.time : '') + ' 되돌리기 전 모습') + '</b>' +
            '<span>· 보기 전용 (고칠 수 없음)</span><span class="sp"></span><button class="back" id="hist-back">오늘로 돌아가기</button>' +
            (mapStore.isBoss && isDay && at < kst() ? '<button class="rest" id="hist-rest">이 날로 되돌리기</button>' : '');
        bar.querySelector('#hist-back').onclick = () => go('');
        const rb = bar.querySelector('#hist-rest'); if (rb) rb.onclick = () => askRestore(at);
    }

    async function go(at) {
        if (busy) return; busy = true;
        try {
            await mapStore.view(at);
            if (typeof svgCache !== 'undefined') svgCache.clear();
            closePop(); setMode();
            selectFloor(currentFloorIdx, true);
        } catch (e) { alert(e && e.message ? e.message : e); }
        finally { busy = false; }
    }

    function askRestore(day) {
        const d = document.createElement('div'); d.className = 'hist-dlg';
        d.innerHTML = '<div role="dialog" aria-modal="true"><b style="font-size:17px">' + md(day) + ' 모습으로 되돌릴까요?</b>' +
            '<p>지금 도면(매장·구역·심벌·연결선·축척)이 <b>' + md(day) + ' 모습으로 바뀝니다.</b><br>지금 모습도 기록에 남아 「되돌리기 전 보기」로 다시 볼 수 있습니다.<br><small style="color:#94a3b8">소장만 할 수 있습니다</small></p>' +
            '<div class="row"><button class="no">취소</button><button class="yes">되돌리기</button></div></div>';
        document.body.appendChild(d);
        d.querySelector('.no').onclick = () => d.remove();
        d.querySelector('.yes').onclick = async () => {
            d.querySelector('.yes').disabled = true;
            try {
                const r = await mapStore.restore(day);
                if (!r || !r.ok) throw new Error((r && r.error) || '되돌리지 못했습니다');
                location.reload();   // 새 모습·새 판으로 처음부터
            } catch (e) { d.remove(); alert(e && e.message ? e.message : e); }
        };
    }

    function closePop() { if (pop) { pop.remove(); pop = null; } setModeBtn(); }
    function setModeBtn() { const b = document.getElementById('btn-hist'); if (b) b.classList.toggle('hist-on', !!mapStore.viewAt || !!pop); }

    function drawPop() {
        if (!pop) return;
        const today = kst(), first = H.days.length ? H.days[0].day : today;
        const chg = {}; H.days.forEach(d => { const ls = [...new Set(d.keys.map(label).filter(Boolean))]; if (ls.length) chg[d.day] = { ls, by: d.by }; });
        const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)), start = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
        let cal = ['일', '월', '화', '수', '목', '금', '토'].map(x => '<div class="w">' + x + '</div>').join('');
        for (let i = 0; i < start; i++) cal += '<div></div>';
        for (let i = 1; i <= n; i++) {
            const d = ym + '-' + String(i).padStart(2, '0'), on = d >= first && d <= today;
            cal += (on ? '<button type="button" data-d="' + d + '" class="d on' : '<div class="d') + (chg[d] ? ' chg' : '') + (d === today ? ' today' : '') +
                ((mapStore.viewAt === d || (!mapStore.viewAt && d === today)) ? ' sel' : '') + '">' + i + (on ? '</button>' : '</div>');
        }
        const items = [];
        Object.keys(chg).filter(d => d.startsWith(ym)).forEach(d => items.push({ k: d + ' 0', h: '<span><b>' + md(d) + '</b> · ' + esc(chg[d].ls.join(' · ')) + (chg[d].by.length ? ' · ' + esc(chg[d].by.join(', ')) : '') + '</span>' }));
        H.restores.filter(r => r.day.startsWith(ym)).forEach(r => items.push({ k: r.day + ' 1' + r.time, h: '<span><b>' + md(r.day) + ' ' + r.time + '</b> · ' + md(r.to) + '로 되돌림 · ' + esc(r.by) + ' <button type="button" data-at="' + esc(r.before) + '">되돌리기 전 보기</button></span>' }));
        items.sort((a, b) => a.k < b.k ? 1 : -1);
        pop.innerHTML = '<h4><button type="button" data-m="-1" aria-label="이전 달">‹</button>' + y + '년 ' + m + '월<button type="button" data-m="1" aria-label="다음 달">›</button></h4>' +
            '<div class="hist-cal">' + cal + '</div><div class="hist-list"><span>● 점 = 도면이 바뀐 날 · 날짜를 누르면 그날 모습</span>' +
            (items.length ? items.map(x => x.h).join('') : '<span>이 달은 바뀐 기록이 없습니다.</span>') + '</div>';
    }

    async function openPop() {
        if (pop) return closePop();
        pop = document.createElement('div'); pop.className = 'hist-pop'; pop.innerHTML = '<span>불러오는 중…</span>';
        document.getElementById('btn-hist').parentElement.appendChild(pop); setModeBtn();
        pop.addEventListener('click', e => {
            const t = e.target.closest('button'); if (!t) return;
            e.stopPropagation();
            if (t.dataset.m) { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + Number(t.dataset.m), 1)); ym = d.toISOString().slice(0, 7); drawPop(); }
            else if (t.dataset.d) go(t.dataset.d === kst() ? '' : t.dataset.d);
            else if (t.dataset.at) go(t.dataset.at);
        });
        try {
            const r = await mapStore.days();
            if (!r || !r.ok) throw new Error((r && r.error) || '기록을 불러오지 못했습니다');
            H = r; drawPop();
        } catch (e) { if (pop) pop.innerHTML = '<span>' + esc(e && e.message ? e.message : e) + '</span>'; }
    }

    mapStore.ready.then(() => {
        const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
        const acts = document.querySelector('.header-actions'); if (!acts) return;
        const w = document.createElement('div'); w.className = 'dropdown-wrapper hist-wrap';
        w.innerHTML = '<button class="btn" id="btn-hist" type="button" title="날짜별 도면 기록 보기"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg><span>기록</span></button>';
        acts.insertBefore(w, acts.firstChild);
        if (!mapStore.canEdit) { const c = document.createElement('span'); c.className = 'ro-chip'; c.textContent = '보기 전용'; c.title = '지도는 소장·부소장·파트장·옵저버만 고칠 수 있습니다'; acts.insertBefore(c, w); }
        w.querySelector('#btn-hist').onclick = e => { e.stopPropagation(); openPop(); };
        document.addEventListener('click', e => { if (pop && !e.target.closest('.hist-wrap')) closePop(); });
        // 보기 전용일 때 고치는 단축키 막기 (Ctrl+Z · Delete · Backspace)
        window.addEventListener('keydown', e => {
            if (!mapStore.readOnly() || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopImmediatePropagation(); }
        }, true);
        setMode();
    });
})();
