/* ==========================================================================
   mapStore.js - 도면 자료를 Supabase에 두는 저장소 (업무지원 결정 130 · 132 · 134, docs/설계/WS_지도.md)
   localStorage 와 같은 모양(getItem·setItem·removeItem)이라 저장소 파일은 이름만 바꿔 씀.
   업무지원 앱(fm/ws/app.html) 안에서만 열림: 그 앱의 PIN 로그인 표로 parent.WS_MAP 을 부름.
   - 칸마다 판(ver)을 기억 → 그사이 다른 사람이 고쳤으면 서버가 막고, 알린 뒤 새로 불러옴 (결정 134)
   - 보기 전용(readOnly): 소장·부소장·파트장이 아닌 사람 또는 지난 날짜를 보는 중 → 저장하지 않음 (결정 132·134)
   ========================================================================== */

var mapStore = (function () {
    let cache = {}, live = {};
    const vers = {}, bases = {};
    const queue = {};   // 칸마다 저장을 차례로 (나중 값이 마지막에 도착하게, 판도 이어서)
    let failCount = 0, warned = false, canEdit = false, isBoss = false, canRestore = false, viewAt = '';
    const api = (window.parent !== window && window.parent.WS_MAP) || null;

    function warnOnce(msg) {
        if (warned) return;
        warned = true;   // 한 번만 알림 (선 하나 그릴 때마다 뜨지 않게)
        alert(msg);
        setTimeout(() => { warned = false; }, 10000);
    }
    function send(k, v) {
        queue[k] = (queue[k] || Promise.resolve()).then(() => api.save(k, v, vers[k] || '')).then(r => {
            if (r && r.conflict) { alert(r.error); location.reload(); return; }
            if (!r || r.ok === false) throw new Error(r && r.error);
            vers[k] = r.ver || '';
        }).catch(e => { failCount++; warnOnce('도면을 저장하지 못했습니다. 인터넷을 확인하고 다시 해 주세요.\n' + (e && e.message ? e.message : e)); });
    }
    function readOnly() { return !canEdit || !!viewAt; }

    const ready = api ? api.load().then(r => {
        if (!r || !r.ok) throw new Error((r && r.error) || '불러오지 못했습니다');
        live = Object.assign({}, r.kv || {}); cache = Object.assign({}, live);
        Object.assign(vers, r.vers || {}); Object.assign(bases, r.bases || {});
        canEdit = !!r.canEdit; isBoss = !!r.isBoss;
        canRestore = r.canRestore === undefined ? isBoss : !!r.canRestore;   // 서버가 아직 옛 판이면 소장만 (결정 214)
        Object.keys(BUILDINGS).forEach(b => BUILDINGS[b].floors.forEach(f => { f.svgUrl = (r.urls[b] || {})[f.code] || ''; }));
    }) : Promise.reject(new Error('업무지원 앱에서 [지도]를 눌러 열어 주세요.'));

    async function sha256(text) {
        const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
    }

    return {
        ready,
        getItem: k => (k in cache ? cache[k] : null),
        setItem: (k, v) => {
            v = String(v);
            if (readOnly()) { if (cache[k] !== v && typeof showToast === 'function') showToast(viewAt ? '지난 기록은 고칠 수 없습니다.' : '지도는 소장·부소장·파트장·옵저버만 고칠 수 있습니다.', 1800); return; }
            if (cache[k] === v) return;
            cache[k] = live[k] = v; send(k, v);
        },
        removeItem: k => {
            if (readOnly() || !(k in cache)) return;
            delete cache[k]; delete live[k]; send(k, null);
        },
        get canEdit() { return canEdit; },
        get isBoss() { return isBoss; },
        get canRestore() { return canRestore; },
        get viewAt() { return viewAt; },
        readOnly,
        /** 보낸 저장이 모두 끝날 때까지 기다림. 돌려주는 값 = 실패한 수 */
        async flush() { const before = failCount; await Promise.all(Object.values(queue)); return failCount - before; },
        /** 업체 바탕 도면을 받으면 그림이 바뀌었을 때만 보관 (결정 132). 보기 중엔 안 함 */
        async keepBase(k, raw) {
            if (!api || viewAt || !raw || !(window.crypto && crypto.subtle)) return;
            try {
                const h = await sha256(raw);
                if (bases[k] === h) return;
                const r = await api.base(k, raw);
                if (r && r.ok) bases[k] = r.sha;
            } catch (e) { /* 보관 실패는 도면 보기에 지장 없음 — 다음에 층을 열 때 다시 */ }
        },
        /** 지난 날짜 모습 받기 (at = 'YYYY-MM-DD' 또는 시각). '' = 지금 모습으로 */
        async view(at) {
            if (!at) { viewAt = ''; cache = Object.assign({}, live); return; }
            const r = await api.at(at);
            if (!r || !r.ok) throw new Error((r && r.error) || '기록을 불러오지 못했습니다');
            viewAt = at; cache = r.kv || {};
        },
        days: () => api.days(),
        restore: day => api.restore(day),   // 날짜 또는 저장 차수 시각
        /** 기록 달력 「저장」: 보낸 저장을 다 끝낸 뒤 지금 시각을 차수로 남김 (결정 382). 앱이 옛 판이면 null */
        canMark: () => !!(api && api.mark),
        async mark(b) { await this.flush(); return api.mark(b || ''); }
    };
})();

// PC 마우스 오른쪽 버튼 막기 (도면 주소·그림 복사 방지). 휴대폰·아이패드 길게 누르기는 그대로
if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) document.addEventListener('contextmenu', e => e.preventDefault());
