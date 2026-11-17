/* ==========================================================================
   mapStore.js - 도면 자료를 Supabase에 두는 저장소 (업무지원 결정 130, docs/설계/WS_지도.md)
   localStorage 와 같은 모양(getItem·setItem·removeItem)이라 저장소 파일은 이름만 바꿔 씀.
   업무지원 앱(fm/ws/app.html) 안에서만 열림: 그 앱의 PIN 로그인 표로 parent.WS_MAP 을 부름.
   ========================================================================== */

var mapStore = (function () {
    const cache = {};
    const queue = {};   // 칸마다 저장을 차례로 (나중 값이 마지막에 도착하게)
    let warned = false;
    const api = (window.parent !== window && window.parent.WS_MAP) || null;

    function send(k, v) {
        queue[k] = (queue[k] || Promise.resolve()).then(() => api.save(k, v)).then(r => {
            if (r && r.ok === false) throw new Error(r.error);
        }).catch(e => {
            if (warned) return;
            warned = true;   // 한 번만 알림 (선 하나 그릴 때마다 뜨지 않게)
            alert('도면을 저장하지 못했습니다. 인터넷을 확인하고 다시 해 주세요.\n' + (e && e.message ? e.message : e));
            setTimeout(() => { warned = false; }, 10000);
        });
    }

    const ready = api ? api.load().then(r => {
        if (!r || !r.ok) throw new Error((r && r.error) || '불러오지 못했습니다');
        Object.assign(cache, r.kv || {});
        Object.keys(BUILDINGS).forEach(b => BUILDINGS[b].floors.forEach(f => { f.svgUrl = (r.urls[b] || {})[f.code] || ''; }));
    }) : Promise.reject(new Error('업무지원 앱에서 [지도]를 눌러 열어 주세요.'));

    return {
        ready,
        getItem: k => (k in cache ? cache[k] : null),
        setItem: (k, v) => { v = String(v); if (cache[k] === v) return; cache[k] = v; send(k, v); },
        removeItem: k => { if (!(k in cache)) return; delete cache[k]; send(k, null); }
    };
})();

// PC 마우스 오른쪽 버튼 막기 (도면 주소·그림 복사 방지). 휴대폰·아이패드 길게 누르기는 그대로
if (window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches) document.addEventListener('contextmenu', e => e.preventDefault());
