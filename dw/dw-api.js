// 도면협의(DW) Supabase 통로 — 화면(App.html)의 api('apiXxx', …)를 구글 서버 대신 Supabase 로 보냄
// 화면 코드는 거의 그대로 두고, 이 파일이 Code.gs 와 같은 이름 · 같은 답 모양을 돌려줌 (docs/설계/DW_Supabase이관.md)
//  · 자료: supabase/03_api.sql 의 DB 함수 (PIN 확인 뒤)
//  · 파일(사진·협의서·PDF·지침): 버킷 dw-files 에 먼저 올리고 DB 함수에 주소만. 드라이브로 옮긴 옛 파일은 구글 웹앱 통로로 받음
//  · 메일(서명 요청·서류 요청·시방서): 계속 구글(Gmail) — 도면협의 웹앱에 POST
// 필요: config.js(window.DW_CONFIG), ../apps.js(window.FM_APPS), @supabase/supabase-js v2 (window.supabase)
(function () {
  const C = window.DW_CONFIG || {};
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dw_sb_auth' }   // 기기 등록을 기억 (한 번만)
  });
  const BUCKET = C.SUPABASE_BUCKET_NAME || 'dw-files';
  const GAS = () => ((window.FM_APPS || {}).dw || {}).exec || '';
  const HERE = () => new URL('./', location.href).href;   // …/fm/dw/

  /* ── 파일 ── */
  function dataUrlToBlob(d) {
    const m = /^data:([^;,]+)([^,]*),(.*)$/.exec(String(d || ''));   // PDF 도구는 ';filename=…;base64' 처럼 덧붙임
    if (!m) throw new Error('파일 내용이 올바르지 않습니다.');
    const bin = /;base64$/.test(m[2]) ? atob(m[3]) : decodeURIComponent(m[3]), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] });
  }
  const blobToDataUrl = b => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(new Error('파일을 읽지 못했습니다.')); r.readAsDataURL(b); });
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
  const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '');
  const ym = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  /** 버킷에 올리고 { path, url, size, mime } — 경로는 영문·숫자만 (한글 이름은 DB 가 따로 기억). 사진은 화면이 이미 줄여 보냄 */
  async function upload(dir, blob) {
    const path = dir + '/' + rid() + '.' + (EXT[blob.type] || 'bin');
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error('파일을 올리지 못했습니다: ' + error.message);
    return { path, url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl, size: blob.size, mime: blob.type };
  }
  function imageBlob(d, max) {
    const m = /^data:image\/(jpeg|png);base64,/.exec(String(d || ''));
    if (!m) throw new Error('사진 형식이 올바르지 않습니다.');
    const b = dataUrlToBlob(d);
    if (b.size > max) throw new Error('사진이 너무 큽니다.');
    return b;
  }
  function pdfBlob(uri) {
    if (!/^data:application\/pdf[^,]*;base64,/.test(String(uri || ''))) throw new Error('PDF 내용이 올바르지 않습니다.');
    const b = dataUrlToBlob(uri);
    if (b.size > 40 * 1024 * 1024) throw new Error('PDF가 너무 큽니다.');
    return new Blob([b], { type: 'application/pdf' });
  }

  /* ── DB 함수 부르기: 오류 글을 그대로 넘겨 화면 안내가 됨 ── */
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message || String(error));
    if (data && data.__err) throw new Error(data.__err);   // 로그인 실패 (틀린 횟수를 저장하려고 오류 대신 글로 옴)
    return data;
  }
  /* ── 구글 웹앱 (메일 · 드라이브 파일). 쿠키 없이 POST → 여러 구글 계정이어도 됨 ── */
  async function gas(fn, a, args) {
    const u = GAS();
    if (!u) throw new Error('apps.js 에 도면협의 웹앱 주소가 없습니다.');
    let j;
    try {
      const r = await fetch(u, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ api: 'dw', fn, a, args: args || [] }) });
      j = await r.json();
    } catch (e) { throw new Error('구글 웹앱에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요.'); }
    if (!j || !j.ok) throw new Error((j && j.error) || '구글 웹앱 오류');
    return j.data;
  }
  /** dw_file 정보 → Blob (버킷 주소, 또는 드라이브로 옮긴 것은 웹앱이 5MB씩) */
  async function fileBlob(a, f) {
    if (f.url) {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error('파일을 받지 못했습니다 (' + r.status + ')');
      return r.blob();
    }
    const parts = []; let got = 0, size = 0, mime = f.mime || '';
    do {
      const c = await gas('file', a, [f.drive_id, got]);
      const bin = atob(c.data), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      parts.push(arr); got += arr.length; size = c.size; mime = c.mime || mime;
      if (!arr.length) break;
    } while (got < size);
    return new Blob(parts, { type: mime || 'application/octet-stream' });
  }
  const fileDataUrl = async (a, f) => f ? blobToDataUrl(await fileBlob(a, f)) : null;
  function fillBoot(b) {
    if (!b) return b;
    b.version = window.DW_VERSION || b.version;
    if (!b.publicUrl) b.publicUrl = HERE();   // QR(?store=)·서명 링크 기준 = 바로가기 페이지 (…/fm/dw/)
    b.appUrl = b.appUrl || HERE();
    if (!b.guide || !b.guide.mp4) b.guide = { mp4: HERE() + 'sign_guide.mp4', gif: HERE() + 'sign_guide.gif' };
    b.sb = true;
    return b;
  }
  /** 메일 뒤: 웹앱 답(fromOk 등) + 최신 매장 */
  async function withStore(a, sid, extra) {
    const out = await rpc('dw_get_store', { p_a: a, p_store: sid });
    return Object.assign(out, extra || {});
  }
  const PDF_CACHE = {};

  /* ── 서버 함수 (Code.gs 와 같은 이름 · 같은 답) ── */
  const API = {
    apiLogin: a => rpc('dw_login', { p_a: a }),
    async apiStart(a) { const r = await rpc('dw_start', { p_a: a }); fillBoot(r.boot); return r; },
    async apiBootstrap(a) { return fillBoot(await rpc('dw_bootstrap', { p_a: a })); },
    apiCompanies: a => rpc('dw_companies', { p_a: a }),
    apiListStores: a => rpc('dw_list_stores', { p_a: a }),
    apiGetStore: (a, sid) => rpc('dw_get_store', { p_a: a, p_store: sid }),
    apiSaveReview: (a, review, finalize) => rpc('dw_save_review', { p_a: a, p_review: review || {}, p_finalize: !!finalize }),
    apiNextRound: (a, sid) => rpc('dw_next_round', { p_a: a, p_store: sid }),
    apiDeleteStore: (a, sid) => rpc('dw_delete_store', { p_a: a, p_store: sid }),
    apiDeleteLastRound: (a, sid) => rpc('dw_delete_last_round', { p_a: a, p_store: sid }),
    apiSetChiefOk: (a, sid, round, on) => rpc('dw_set_chief_ok', { p_a: a, p_store: sid, p_round: Number(round) || 0, p_on: !!on }),
    apiSetConfirmed: (a, sid, c) => rpc('dw_set_confirmed', { p_a: a, p_store: sid, p_confirmed: !!c }),
    apiSavePhrases: (a, list) => rpc('dw_save_phrases', { p_a: a, p_list: list }),

    /* 사진 · 협의서 · PDF */
    async apiUploadPhoto(a, sid, round, dataUrl) {
      const f = await upload('photo/' + ym(), imageBlob(dataUrl, 8 * 1024 * 1024));
      return rpc('dw_photo_added', { p_a: a, p_store: sid, p_round: Number(round) || 1, p_file: f });
    },
    async apiPhoto(a, id) { return fileDataUrl(a, await rpc('dw_file', { p_a: a, p_id: String(id || ''), p_kind: 'photo' })); },
    async apiFireDocUpload(a, sid, dataUrl) {
      const f = await upload('firedoc/' + ym(), imageBlob(dataUrl, 10 * 1024 * 1024));
      return rpc('dw_firedoc_set', { p_a: a, p_store: sid, p_file: f });
    },
    async apiFireDoc(a, sid) {
      const d = await rpc('dw_firedoc', { p_a: a, p_store: sid });
      let url; try { url = await fileDataUrl(a, d.file); } catch (e) { throw new Error('협의서 파일을 찾을 수 없습니다. 다시 올려 주세요.'); }
      return { url, r: d.r, f: d.f };
    },
    apiFireDocRotate: (a, sid, r) => rpc('dw_firedoc_rotate', { p_a: a, p_store: sid, p_r: Number(r) }),
    apiFireDocDelete: (a, sid) => rpc('dw_firedoc_delete', { p_a: a, p_store: sid }),
    async apiSavePdf(a, sid, round, name, uri, auto) {
      const f = await upload('pdf/' + ym(), pdfBlob(uri));
      return rpc('dw_pdf_saved', { p_a: a, p_store: sid, p_round: Number(round) || 1, p_name: name || '', p_file: f, p_auto: !!auto });
    },

    /* 원격 서명 (링크의 표만으로, 로그인 없이도 됨) */
    async apiSignInfo(token) {
      const r = await rpc('dw_sign_info', { p_token: String(token || '') });
      if (!r.guide || !r.guide.mp4) r.guide = { mp4: HERE() + 'sign_guide.mp4', gif: HERE() + 'sign_guide.gif' };
      return r;
    },
    apiSignSubmit: (token, data) => rpc('dw_sign_submit', { p_token: String(token || ''), p_data: data || {} }),

    /* 메일 — 구글 웹앱(Gmail)이 보내고 DB 에 기록 */
    async apiSigRequest(a, sid, round, reqs, pdfUri, pdfName) {
      const f = await upload('pdf/' + ym(), pdfBlob(pdfUri));
      const p = await rpc('dw_pdf_saved', { p_a: a, p_store: sid, p_round: Number(round) || 1, p_name: pdfName || '', p_file: f, p_auto: null });
      const r = await gas('apiSigRequest', a, [sid, Number(round), reqs || [], { fileId: p.fileId, url: p.url, name: p.name }]);
      return withStore(a, sid, r);
    },
    async apiSendDocReq(a, sid, round, keys, extra) { return withStore(a, sid, await gas('apiSendDocReq', a, [sid, Number(round), keys || [], extra || ''])); },
    async apiSendSpec(a, sid, round, keys, extra) { return withStore(a, sid, await gas('apiSendSpec', a, [sid, Number(round), keys || [], extra || ''])); },
    apiSpecInfo: a => gas('apiSpecInfo', a, []),

    /* 지침 */
    apiGuideIndex: a => rpc('dw_guide_index', { p_a: a }),
    async apiGuidePage(a, d, p) { return fileDataUrl(a, await rpc('dw_guide_page', { p_a: a, p_guide: String(d || ''), p_page: Number(p) || 0 })); },
    apiGuideAdmin: a => rpc('dw_guide_admin', { p_a: a }),
    async apiGuidePdfAdd(a, file) {
      if (!file || !/\.pdf$/i.test(file.name || '')) throw new Error('PDF 파일만 올릴 수 있습니다.');
      if (file.size > 100 * 1024 * 1024) throw new Error('PDF가 너무 큽니다 (100MB까지).');
      const f = await upload('guide/pdf', new Blob([file], { type: 'application/pdf' }));
      return rpc('dw_guide_pdf_add', { p_a: a, p_file: f, p_name: file.name });
    },
    apiGuidePdfRemove: (a, id) => rpc('dw_guide_pdf_remove', { p_a: a, p_id: String(id || '') }),
    /** 화면은 5MB 조각(base64)을 이어 붙임 — 같은 모양으로 (PDF 는 한 번만 받아 둠) */
    async apiGuidePdfChunk(a, fileId, offset) {
      let buf = PDF_CACHE[fileId];
      if (!buf) {
        const f = await rpc('dw_file', { p_a: a, p_id: String(fileId || ''), p_kind: 'guide_pdf' });
        if (!f) throw new Error('지침 폴더에 있는 PDF만 색인할 수 있습니다.');
        buf = PDF_CACHE[fileId] = new Uint8Array(await (await fileBlob(a, f)).arrayBuffer());
      }
      const start = Math.max(0, Number(offset) || 0), part = buf.subarray(start, Math.min(buf.length, start + 5 * 1024 * 1024));
      let s = ''; for (let i = 0; i < part.length; i += 0x8000) s += String.fromCharCode.apply(null, part.subarray(i, i + 0x8000));
      if (start + part.length >= buf.length) delete PDF_CACHE[fileId];
      return { size: buf.length, offset: start, data: btoa(s) };
    },
    apiGuideBegin: (a, info) => rpc('dw_guide_begin', { p_a: a, p_info: info || {} }),
    /** 쪽 그림 [{p, data}] → 버킷 guide/{지침ID}/ 에 올리고 주소만 */
    async apiGuideSavePages(a, id, pages) {
      const items = [];
      for (const pg of pages || []) {
        if (!(Number(pg.p) >= 1) || !/^data:image\/jpeg;base64,/.test(pg.data || '')) continue;
        items.push(Object.assign({ p: Number(pg.p) }, await upload('guide/' + id, dataUrlToBlob(pg.data))));
      }
      return rpc('dw_guide_save_pages', { p_a: a, p_id: id, p_pages: items });
    },
    apiGuideFinish: (a, id, meta, entries) => rpc('dw_guide_finish', { p_a: a, p_id: id, p_meta: meta || {}, p_entries: entries || [] }),
    apiGuideRemove: (a, id) => rpc('dw_guide_remove', { p_a: a, p_id: id }),
    apiGuideRemoveArchived: (a, id) => rpc('dw_guide_remove_archived', { p_a: a, p_id: id }),
    apiGuideRename: (a, id, info) => rpc('dw_guide_rename', { p_a: a, p_id: id, p_info: info || {} }),
    apiGuideCancel: a => rpc('dw_guide_cancel', { p_a: a })
  };

  window.DW_API = {
    sb, upload, dataUrlToBlob,
    /** 앱 안 PDF 보기: 주소 또는 { fileId } → Blob (드라이브로 옮긴 것도) */
    async pdfBlob(a, src) {
      if (src && src.fileId) {
        const f = await rpc('dw_file', { p_a: a, p_id: String(src.fileId), p_kind: 'pdf,guide_pdf' });
        if (f) return fileBlob(a, f);
      }
      const u = String((src && src.url) || src || '');
      const m = /drive\.google\.com\/file\/d\/([-\w]{20,})/.exec(u) || /[?&]id=([-\w]{20,})/.exec(u);
      if (m) return fileBlob(a, { drive_id: m[1], mime: 'application/pdf' });   // 옮긴 PDF (예전 드라이브 주소)
      const r = await fetch(u);
      if (!r.ok) throw new Error('PDF를 받지 못했습니다 (' + r.status + ')');
      return r.blob();
    },
    /** 기기 등록 상태: 등록됐으면 { email, at }, 아니면 null */
    async device() {
      const { data } = await sb.auth.getSession();
      const s = data && data.session;
      let at = ''; try { at = localStorage.getItem('dw_dev_at') || ''; } catch (e) { /* 막힘 */ }
      return s ? { email: s.user.email || '', at } : null;
    },
    async register(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
      if (error) throw new Error(/invalid/i.test(error.message) ? '이메일 또는 비밀번호가 맞지 않습니다. 관리자에게 확인해 주세요.' : '등록하지 못했습니다: ' + error.message);
      try { localStorage.setItem('dw_dev_at', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)); } catch (e) { /* 막힘 */ }
    },
    async unregister() { await sb.auth.signOut(); },
    run(fn, ...args) {
      if (!API[fn]) return Promise.reject(new Error('아직 옮기지 않은 기능입니다 (Supabase 이관 중): ' + fn));
      return API[fn](...args);
    }
  };
})();
