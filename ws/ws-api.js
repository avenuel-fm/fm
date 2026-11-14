// 업무지원(WS) Supabase 통로 (이관 3단계) — 화면의 run('이름', …)을 구글 서버 대신 Supabase로 보냄
// 화면 코드는 그대로 두고 이 파일이 서버 함수와 같은 이름·같은 답 모양을 돌려줌 (docs/설계/WS_Supabase이관.md 4.3)
// 필요: config.js(window.WS_CONFIG), @supabase/supabase-js v2 (window.supabase)
(function () {
  const C = window.WS_CONFIG || {};
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ws_sb_auth' }   // 기기 등록을 기억 (한 번만)
  });
  const BUCKET = C.SUPABASE_BUCKET_NAME || 'ws-files';

  /* ── 사진 줄이기: 가로·세로 긴 쪽 1200px 이하, JPEG 80% (요청서 4번). PDF·엑셀·서명 PNG는 그대로 ── */
  function loadImage(src) {
    return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error('사진을 읽지 못했습니다')); im.src = src; });
  }
  async function compressImage(input, max = 1200, quality = 0.8) {
    const url = typeof input === 'string' ? input : URL.createObjectURL(input);
    try {
      const im = await loadImage(url);
      const k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(im, 0, 0, cv.width, cv.height);
      return await new Promise((ok, no) => cv.toBlob(b => b ? ok(b) : no(new Error('사진을 줄이지 못했습니다')), 'image/jpeg', quality));
    } finally { if (typeof input !== 'string') URL.revokeObjectURL(url); }
  }
  function dataUrlToBlob(d) {
    const m = /^data:([^;,]+)([^,]*),(.*)$/.exec(String(d || ''));   // PDF 도구는 ';filename=…;base64' 처럼 덧붙임
    if (!m) throw new Error('파일 내용이 올바르지 않습니다');
    const bin = /;base64$/.test(m[2]) ? atob(m[3]) : decodeURIComponent(m[3]), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: m[1] });
  }
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf', 'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx' };
  function rid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, ''); }
  /** 버킷에 올리고 { path, url } — 경로는 영문·숫자만 (한글 경로는 Supabase가 받지 않음). 사진은 먼저 줄임 */
  async function upload(kind, blob) {
    if (blob.type.startsWith('image/') && blob.type !== 'image/png') blob = await compressImage(blob);
    const k = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
    const path = kind + '/' + k + '/' + rid() + '.' + (EXT[blob.type] || 'bin');
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error('파일을 올리지 못했습니다: ' + error.message);
    return { path, url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  }

  /* ── DB 함수 부르기: 오류 글('LOGIN' 등)을 그대로 넘겨 화면의 call()이 알아듣게 ── */
  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message || String(error));
    return data;
  }

  /* ── 서버 함수 (Code.gs와 같은 이름·같은 답) — 옮긴 것만. 3-2 묶음부터 차례로 더함 ── */
  const API = {
    async login(pin, device, signPng) {
      let f = null;
      if (signPng) f = await upload('sign', dataUrlToBlob(signPng));
      return rpc('ws_login', { p_pin: pin, p_device: device, p_sign_url: f && f.url, p_sign_path: f && f.path });
    },
    async signToday(token, signPng) {
      const f = await upload('sign', dataUrlToBlob(signPng));
      return rpc('ws_sign_today', { p_token: token, p_sign_url: f.url, p_sign_path: f.path });
    },
    async bootstrap(token) {
      const r = await rpc('ws_bootstrap', { p_token: token });
      r.app = { id: 'WS', title: '업무지원', version: window.WS_VERSION || '' };
      return r;
    },

    /* ── 3-2 서류작업 (supabase/03_docs.sql). 사진·PDF는 버킷에 먼저 올리고 주소·경로만 DB 함수에 ── */
    nextWorkGet: (token, date) => rpc('ws_next_work_get', { p_token: token, p_date: date || '' }),
    nextWorkSave: (token, date, rows, ver) => rpc('ws_next_work_save', { p_token: token, p_date: date, p_rows: rows || [], p_ver: ver || '' }),
    tbmGet: (token, want) => rpc('ws_tbm_get', { p_token: token, p_want: want || '' }),
    async tbmSave(token, d) {
      const s = await tbmSplit(d);
      return rpc('ws_tbm_save', { p_token: token, p_d: s.d, p_files: s.files });
    },
    async tbmSavePdf(token, dataUri, signIds, d, want) {
      const pdf = pdfBlob(dataUri); if (pdf.error) return pdf;
      const s = d ? await tbmSplit(d) : { d: null, files: {} };
      s.files.pdf = await upload('tbm_pdf', pdf);
      return rpc('ws_tbm_save_pdf', { p_token: token, p_files: s.files, p_sign_ids: signIds || [], p_d: s.d, p_want: want || '' });
    },
    async logGet(token, day) { return withAc(await rpc('ws_log_get', { p_token: token, p_day: day || '' })); },
    async logSave(token, day, d, ver) {
      const s = await logSplit(d);
      return withAc(await rpc('ws_log_save', { p_token: token, p_day: day, p_d: s.d, p_ver: ver || '', p_files: s.files }));
    },
    async logSavePdf(token, day, dataUri, d, ver) {
      const pdf = pdfBlob(dataUri); if (pdf.error) return pdf;
      const s = d ? await logSplit(d) : { d: null, files: {} };
      s.files.pdf = await upload('log_pdf', pdf);
      return withAc(await rpc('ws_log_save_pdf', { p_token: token, p_day: day, p_files: s.files, p_d: s.d, p_ver: ver || '' }));
    },

    /* ── 3-3 출근현황 (supabase/04_attendance.sql). 엑셀 원본은 버킷 roster_xlsx/ 에 ── */
    attGet: (token, date) => rpc('ws_att_get', { p_token: token, p_date: date || '' }),
    async attPut(token, ym, rows, fileB64) {
      const f = fileB64 ? await upload('roster_xlsx', dataUrlToBlob(fileB64)) : null;
      return rpc('ws_att_put', { p_token: token, p_ym: ym, p_rows: rows || [], p_file: f });
    },
    attFix: (token, date, name, value) => rpc('ws_att_fix', { p_token: token, p_date: date, p_name: name, p_value: value }),
    attHoliday: (token, name, days, date) => rpc('ws_att_holiday', { p_token: token, p_name: name, p_days: days || [], p_date: date || '' }),

    /* ── 3-4 소화기 (supabase/05_fire.sql). QR 점검 입력은 check-sb.html 이 따로 부름 ── */
    feList: async token => fePage(await rpc('ws_fe_list', { p_token: token })),
    feAdd: async (token, d) => fePage(await rpc('ws_fe_add', { p_token: token, p_d: d || {} })),
    feDelete: async (token, ids) => fePage(await rpc('ws_fe_delete', { p_token: token, p_ids: ids || [] })),
    labelSave: (token, w, h) => rpc('ws_label_save', { p_token: token, p_w: Number(w), p_h: Number(h) }),
    feStatus: (token, ym) => rpc('ws_fe_status', { p_token: token, p_ym: ym || '' }),
    feDetail: (token, id) => rpc('ws_fe_detail', { p_token: token, p_check_id: String(id || '') }),

    /* ── 3-5 전열필증 (supabase/06_eh.sql). 필증 QR 보기는 eh-sb.html 이 따로 부름 ── */
    ehList: async (token, floor) => fePage(await rpc('ws_eh_list', { p_token: token, p_floor: floor || '' })),
    ehStoreSave: async (token, d) => fePage(await rpc('ws_eh_store_save', { p_token: token, p_d: d || {} })),
    ehStoreDelete: async (token, id) => fePage(await rpc('ws_eh_store_delete', { p_token: token, p_id: String(id || '') })),
    ehSave: async (token, d) => fePage(await rpc('ws_eh_save', { p_token: token, p_d: d || {} })),
    ehDelete: async (token, ids, floor) => fePage(await rpc('ws_eh_delete', { p_token: token, p_ids: ids || [], p_floor: floor || '' })),
    ehPrinted: async (token, ids, floor) => fePage(await rpc('ws_eh_printed', { p_token: token, p_ids: ids || [], p_floor: floor || '' })),
    /** 엑셀은 여기서 나눠 읽고(Code.gs ehParse_ 와 같음) 저장할 때 매장·기기 목록만 DB에 */
    async ehImport(token, sheets, save, replace) {
      const P = ehParse(sheets || {});
      if (!P.items.length) return { ok: false, error: '전열기기를 찾지 못했습니다. 「2026년 전열기 관리대장」 엑셀이 맞는지 확인해 주세요.' };
      if (!save) return { ok: true, check: P.check };
      const r = await rpc('ws_eh_import', { p_token: token, p_data: { replace: !!replace,
        stores: P.stores.map(s => ({ floor: s.floor, no: s.no, name: s.name })),
        items: P.items.map(x => ({ floor: x.floor, store: x.store, no: x.no, name: x.name, w: x.w, maker: x.maker, m1: x.m1, m2: x.m2, date: x.date, gone: x.gone })) } });
      return r && r.ok ? fePage(Object.assign(r, { check: P.check })) : r;
    },

    /* ── 3-5 공사장 점검 (supabase/07_cs.sql). 새 사진·PDF는 버킷 cs_photo/·cs_pdf/ 에 먼저 ── */
    csHome: token => rpc('ws_cs_home', { p_token: token }),
    csSiteSave: (token, d) => rpc('ws_cs_site_save', { p_token: token, p_d: d || {} }),
    csSiteEnd: (token, id) => rpc('ws_cs_site_end', { p_token: token, p_id: String(id || '') }),
    csItemsSave: (token, list) => rpc('ws_cs_items_save', { p_token: token, p_list: list || [] }),
    csGet: (token, date, siteId, round) => rpc('ws_cs_get', { p_token: token, p_date: date || '', p_site: String(siteId || ''), p_round: Number(round) || 0 }),
    async csSave(token, date, siteId, list, round) {
      const items = [];
      for (const x of Array.isArray(list) ? list : []) {
        const photos = [];
        for (const p of (x && x.photos) || []) {
          if (!p || !p.data) { photos.push({ id: p && p.id || '', at: p && p.at || '' }); continue; }
          let blob; try { blob = dataUrlToBlob(p.data); } catch (e) { return { ok: false, error: '「' + (x.t || '') + '」 사진을 읽지 못했습니다. 다시 찍어 주세요.' }; }
          photos.push({ id: '', at: p.at || '', file: await upload('cs_photo', blob) });
        }
        items.push(Object.assign({}, x, { photos }));
      }
      return rpc('ws_cs_save', { p_token: token, p_date: date || '', p_site: String(siteId || ''), p_list: items, p_round: Number(round) || 0 });
    },
    async csSavePdf(token, ckId, dataUri) {
      const pdf = pdfBlob(dataUri); if (pdf.error) return pdf;
      return rpc('ws_cs_save_pdf', { p_token: token, p_ck_id: String(ckId || ''), p_file: await upload('cs_pdf', pdf) });
    },

    /* ── 3-6 환경설정 (supabase/08_settings.sql, 소장만). 위험성 목록은 시트 대신 여기서 고침 ── */
    adminStaff: token => rpc('ws_admin_staff', { p_token: token }),
    adminSetToast: (token, sec) => rpc('ws_admin_set_toast', { p_token: token, p_sec: Number(sec) }),
    adminStaffSave: (token, d) => rpc('ws_admin_staff_save', { p_token: token, p_d: d || {} }),
    adminStaffPin: (token, id, pin) => rpc('ws_admin_staff_pin', { p_token: token, p_staff_id: String(id || ''), p_pin: String(pin || '') }),
    adminStaffRemove: (token, id) => rpc('ws_admin_staff_remove', { p_token: token, p_staff_id: String(id || '') }),
    riskGet: token => rpc('ws_risk_get', { p_token: token }),
    riskSave: (token, rows) => rpc('ws_risk_save', { p_token: token, p_rows: rows || [] })
  };

  /* ── 전열기 관리대장 엑셀 → 매장·기기 (Code.gs ehParse_ · ehW_ · ehDate_ 그대로) ── */
  const EH_FLOORS = ['B3', 'B2', 'B1', '1F', '2F', '3F', '4F', '5F', '6F', '팝업'], EH_NO = /^(B[1-3]|[1-6]F|팝업)-(\d+)-(\d+)$/;
  const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  const ehSeq = no => { const m = EH_NO.exec(no); return m ? Number(m[3]) : 0; };
  function ehW(s) { const m = /\d+(\.\d+)?/.exec(String(s).replace(/,/g, '')); return m ? m[0] : ''; }
  function ehDate(s) {
    const m = /(\d{2,4})\s*[.,\-\/]\s*(\d{1,2})\s*[.,\-\/]\s*(\d{1,2})/.exec(String(s));
    if (!m) return '';
    const y = m[1].length === 2 ? '20' + m[1] : m[1], mo = Number(m[2]), d = Number(m[3]);
    if (y.length !== 4 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    return y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2);
  }
  function ehParse(sheets) {
    const stores = [], key = {}, items = [];
    Object.keys(sheets).forEach(sn => {
      const fm = /^(B[1-3])F?$|^([1-6]F)$|^(팝업)$/.exec(String(sn).trim());
      if (!fm) return;
      const floor = fm[1] || fm[2] || fm[3], rows = sheets[sn] || [];
      let cur = null, col = null;
      rows.forEach((r, i) => {
        const c = (r || []).map(x => String(x == null ? '' : x).trim());
        if (c.some(x => /^층\s*:/.test(x))) {
          const nx = (rows[i + 1] || []).map(x => String(x == null ? '' : x).trim()).filter(String);
          const name = clean(String(nx[0] || '').replace(/^매장명\s*:\s*/, ''), 30);
          if (!name || name === '0') { cur = null; return; }
          const k = floor + '|' + name;
          if (key[k] === undefined) { key[k] = stores.length; stores.push({ floor, name, nos: {} }); }
          cur = key[k];
          return;
        }
        if (c[0] === 'No') { col = {}; c.forEach((x, j) => { x = x.replace(/\s/g, ''); if (x && col[x] === undefined) col[x] = j; }); return; }
        if (cur === null || !col || !/^\d+$/.test(c[0])) return;
        const g = h => col[h] === undefined ? '' : (c[col[h]] || '');
        const no = g('관리번호'), name = g('기기명');
        if (!no && !name) return;
        items.push({ floor, store: cur, raw: no, name: clean(name.replace(/\n/g, ' '), 40) || '(이름 없음)',
          w: ehW(g('용량(W)')), maker: clean(g('제조사').replace(/\(?폐기\)?/g, ''), 40),
          m1: clean(g('관리책임자'), 30), m2: col['관리책임자'] === undefined ? '' : clean(c[col['관리책임자'] + 1], 30),
          date: ehDate(g('승인일자')), gone: /폐기|매장철수/.test(c.join(' ')) });
      });
    });
    const seen = {};
    let fixed = 0;
    items.forEach(x => {
      let no = String(x.raw).split('\n')[0].replace(/\(.*$/, '').trim();
      const b = no.replace(/^(B[1-3])F-/, '$1-');
      if (b !== no) { no = b; fixed++; }
      const m = EH_NO.exec(no);
      x.no = m && m[1] === x.floor && !seen[no] ? no : '';
      if (x.no) { seen[no] = 1; const s = stores[x.store].nos; s[m[2]] = (s[m[2]] || 0) + 1; }
    });
    const taken = {}, maxNo = {};
    stores.forEach(s => {
      const best = Object.keys(s.nos).sort((a, b) => s.nos[b] - s.nos[a] || a - b)[0];
      Object.keys(s.nos).forEach(n => { maxNo[s.floor] = Math.max(maxNo[s.floor] || 0, Number(n)); });
      if (best && !taken[s.floor + '-' + best]) { s.no = Number(best); taken[s.floor + '-' + best] = 1; }
    });
    stores.forEach(s => { if (!s.no) s.no = maxNo[s.floor] = (maxNo[s.floor] || 0) + 1; });
    let renumbered = 0;
    items.forEach(x => {
      if (x.no) return;
      const s = stores[x.store], head = s.floor + '-' + s.no + '-';
      let n = 0;
      Object.keys(seen).forEach(k => { if (k.indexOf(head) === 0) n = Math.max(n, ehSeq(k)); });
      x.no = head + (n + 1); seen[x.no] = 1; renumbered++;
    });
    const check = { stores: stores.length, items: items.length, renumbered, bfix: fixed, gone: items.filter(x => x.gone).length,
      noDate: items.filter(x => !x.date).length,
      floors: EH_FLOORS.map(f => [f, stores.filter(s => s.floor === f).length, items.filter(x => x.floor === f).length]) };
    return { stores, items, check };
  }
  /** QR 주소 앞부분: 설정 「바로가기주소」, 없으면 지금 앱이 있는 폴더 (…/fm/ws/) — QR은 거기에 ?fe= 를 붙임 */
  function fePage(r) { if (r && r.ok && !r.execUrl) r.execUrl = new URL('./', location.href).href; return r; }

  /** 화면이 만든 PDF(data:) → Blob. 틀리면 { ok:false, error } (Code.gs와 같은 안내) */
  function pdfBlob(uri) {
    if (!/^data:application\/pdf[^,]*;base64,.{100}/.test(String(uri || ''))) return { ok: false, error: 'PDF 내용이 올바르지 않습니다' };
    const b = dataUrlToBlob(uri);
    return b.size > 30 * 1024 * 1024 ? { ok: false, error: 'PDF가 너무 큽니다' } : b;
  }
  /** TBM: 새로 고른 사진(data:)만 올리고 d에서는 뺌 */
  async function tbmSplit(d) {
    const files = {}, rest = Object.assign({}, d);
    for (const k of ['meet', 'chant']) { if (d[k]) files[k] = await upload('tbm_' + k, dataUrlToBlob(d[k])); delete rest[k]; }
    return { d: rest, files };
  }
  /** 일지: 새 야간 그림만 올림. '-' (빼기)는 그대로 넘김 */
  async function logSplit(d) {
    const files = {}, rest = Object.assign({}, d);
    if (d.night && d.night !== '-') { files.night = await upload('log_night', dataUrlToBlob(d.night)); delete rest.night; }
    return { d: rest, files };
  }
  /* 공조기·에어커튼 가동시간은 구글(온습도 앱 읽기)에 남음 → 업무지원 구글 웹앱 ?api=logac 로 받음. 같은 날은 10분 기억 */
  const AC = {};
  // 기다리지 않음: 기억한 값이 없으면 r.acLater(약속)만 붙여 돌려줌 → 화면이 일지를 먼저 그리고 도착하면 그 칸만 채움
  function withAc(r) {
    if (!r || !r.day) return r;
    const c = AC[r.day];
    if (c && c.ac && Date.now() - c.at < 600e3) { r.ac = c.ac; return r; }
    if (!c || !c.p || Date.now() - c.at >= 600e3) {
      const day = r.day, p = (async () => {
        try {
          const j = await (await fetch(C.WS_GAS_URL + '?api=logac&day=' + day)).json();
          if (!j.ok) throw new Error(j.error || '');
          if (!j.ac.err) AC[day] = { at: Date.now(), ac: j.ac }; else delete AC[day];
          return j.ac;
        } catch (e) { delete AC[day]; return { err: '온습도 앱 기록을 불러오지 못했습니다' }; }
      })();
      AC[day] = { at: Date.now(), p };   // 같은 날을 받는 중이면 다시 부르지 않음
    }
    r.acLater = AC[r.day].p;
    return r;
  }

  window.WS_API = {
    sb, upload, compressImage, dataUrlToBlob,
    /** 기기 등록 상태: 등록됐으면 { email, at } , 아니면 null */
    async device() {
      const { data } = await sb.auth.getSession();
      const s = data && data.session;
      let at = ''; try { at = localStorage.getItem('ws_dev_at') || ''; } catch (e) {}
      return s ? { email: s.user.email || '', at } : null;   // at = 이 기기에서 등록한 날 (계정 전체의 마지막 로그인이 아님)
    },
    async register(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
      if (!error) try { localStorage.setItem('ws_dev_at', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)); } catch (e) {}
      if (error) throw new Error(/invalid/i.test(error.message) ? '이메일 또는 비밀번호가 맞지 않습니다. 관리자에게 확인해 주세요.' : '등록하지 못했습니다: ' + error.message);
    },
    async unregister(token) {
      try { if (token) await rpc('ws_logout', { p_token: token }); } catch (e) { /* 표가 이미 없어도 등록은 풂 */ }
      await sb.auth.signOut();
    },
    run(fn, ...args) {
      if (!API[fn]) return Promise.reject(new Error('아직 옮기지 않은 기능입니다 (Supabase 이관 중): ' + fn));
      return API[fn](...args);
    }
  };
})();
