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
  async function upload(kind, blob, ext) {   // ext 를 주면 줄이지 않고 원본 그대로 (열화상 사진은 줄이면 온도 자료가 사라짐)
    if (!ext && blob.type.startsWith('image/') && blob.type !== 'image/png') blob = await compressImage(blob);
    const k = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
    const path = kind + '/' + k + '/' + rid() + '.' + (ext || EXT[blob.type] || 'bin');
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error('파일을 올리지 못했습니다: ' + error.message);
    return { path, url: sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl };
  }

  /** 작업내역 사진 칸: 이미 있는 것은 {id}, 새 것({data})은 버킷에 올려 {file} */
  async function dwPics(list) {
    const out = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (p && p.data) { let blob; try { blob = dataUrlToBlob(p.data); } catch (e) { throw new Error('사진을 읽지 못했습니다. 다시 찍어 주세요.'); } out.push({ file: await upload('dw_photo', blob, 'jpg') }); }
      else if (p && p.id) out.push({ id: p.id });
    }
    return out;
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
      const [r, m, t] = await Promise.all([rpc('ws_bootstrap', { p_token: token }), rpc('ws_menu', { p_token: token }).catch(() => null),   // 메인 메뉴 켜기·끄기 (결정 148)
        rpc('ws_usage_todo', { p_token: token }).catch(() => null)]);   // 메인 「가동시간 미입력」 (결정 194) — 19_climate.sql 전이면 없음
      r.menuOff = m && m.ok ? m.off : [];
      r.acTodo = t && t.ok ? t : null;
      r.app = { id: 'WS', title: '업무지원', version: window.WS_VERSION || '' };
      return r;
    },

    /* ── 3-2 서류작업 (supabase/03_docs.sql). 사진·PDF는 버킷에 먼저 올리고 주소·경로만 DB 함수에 ── */
    /* ── 지도 (supabase/13_map.sql, 결정 130): 도면 앱 저장 칸 · 층 도면 주소 ── */
    specBoot: (token) => rpc('ws_spec_boot', { p_token: token }),   // 시방서 검색 (결정 140, 14_spec.sql)
    specIndex: (token) => rpc('ws_spec_index', { p_token: token }),
    specPage: (token, d, p) => rpc('ws_spec_page', { p_token: token, p_guide: String(d || ''), p_page: Number(p) || 0 }),
    mapLoad: (token) => rpc('ws_map_load', { p_token: token }),
    mapSave: (token, k, v, ver) => rpc('ws_map_save', { p_token: token, p_k: k, p_v: v == null ? null : String(v), p_ver: ver || '' }),
    mapBase: (token, k, v) => rpc('ws_map_base', { p_token: token, p_k: k, p_v: v }),   // 업체 바탕 도면 보관 (결정 132)
    mapDays: (token) => rpc('ws_map_days', { p_token: token }),
    mapAt: (token, at) => rpc('ws_map_at', { p_token: token, p_at: at }),
    mapRestore: (token, day) => rpc('ws_map_restore', { p_token: token, p_day: day }),
    /* ── CAD 변환된 도면 (supabase/18_cad.sql): 뷰어(fm/cad)가 WS_CAD 통로로 부름 ── */
    cadList: (token) => rpc('ws_cad_list', { p_token: token }),
    cadSave: (token, r) => rpc('ws_cad_save', { p_token: token, p_r: r }),
    cadDelete: (token, id) => rpc('ws_cad_delete', { p_token: token, p_id: id }),
    cadCatAdd: (token, name) => rpc('ws_cad_cat_add', { p_token: token, p_name: name }),
    cadCatDel: (token, id) => rpc('ws_cad_cat_del', { p_token: token, p_id: id }),
    cadSetCat: (token, id, cat) => rpc('ws_cad_set_cat', { p_token: token, p_id: id, p_cat: cat }),

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
    async logGet(token, day) { return withAc(await rpc('ws_log_get', { p_token: token, p_day: day || '' }), token); },
    async logSave(token, day, d, ver) {
      const s = await logSplit(d);
      return withAc(await rpc('ws_log_save', { p_token: token, p_day: day, p_d: s.d, p_ver: ver || '', p_files: s.files }), token);
    },
    async logSavePdf(token, day, dataUri, d, ver) {
      const pdf = pdfBlob(dataUri); if (pdf.error) return pdf;
      const s = d ? await logSplit(d) : { d: null, files: {} };
      s.files.pdf = await upload('log_pdf', pdf);
      return withAc(await rpc('ws_log_save_pdf', { p_token: token, p_day: day, p_files: s.files, p_d: s.d, p_ver: ver || '' }), token);
    },

    /* ── 공조기 환기온도 (supabase/12_ahu.sql, 결정 128). 저장은 고친 칸만 ── */
    /* ── 온습도/공조기/에어커튼 입력 (supabase/19_climate.sql, 결정 192·194·196) ── */
    usageGet: (token, kind, day) => rpc('ws_usage_get', { p_token: token, p_kind: kind, p_day: day || '' }),
    usageSave: (token, kind, day, rows) => rpc('ws_usage_save', { p_token: token, p_kind: kind, p_day: day, p_rows: rows || [] }),
    usageReport: (token, kind, from, to) => rpc('ws_usage_report', { p_token: token, p_kind: kind, p_from: from || '', p_to: to || '' }),
    climateGet: (token) => rpc('ws_climate_get', { p_token: token }),
    climateAdd: (token, rows, out) => rpc('ws_climate_add', { p_token: token, p_rows: rows || [], p_out: out || {} }),
    climateReport: (token, from, to) => rpc('ws_climate_report', { p_token: token, p_from: from || '', p_to: to || '' }),
    equipKwGet: (token) => rpc('ws_equip_kw_get', { p_token: token }),
    equipKwSave: (token, d) => rpc('ws_equip_kw_save', { p_token: token, p_d: d || {} }),
    equipHoursGet: (token, kind) => rpc('ws_equip_hours_get', { p_token: token, p_kind: kind }),
    equipHoursSave: (token, kind, rows) => rpc('ws_equip_hours_save', { p_token: token, p_kind: kind, p_rows: rows || [] }),
    // 오늘 날씨가 비었으면 구글 웹앱이 네이버에서 읽어 일지에 넣게 한 뒤 다시 받음 (실패해도 화면은 그대로)
    async ahuGet(token, day) {
      const g = () => rpc('ws_ahu_get', { p_token: token, p_day: day || '' });
      let r = await g();
      if (r && r.ok && r.day === r.workDay && !(r.wx && (r.wx.weather || r.wx.tmin != null))) {
        try {
          const j = await (await fetch(C.WS_GAS_URL + '?api=logac&wx=1&day=' + r.day)).json();
          if (j.ok) r = await g() || r;
        } catch (e) { /* 날씨는 빈칸으로 둠 */ }
      }
      return r;
    },
    ahuSave: (token, day, c) => rpc('ws_ahu_save', { p_token: token, p_day: day, p_c: c || {} }),
    async ahuSavePdf(token, day, dataUri) {
      const pdf = pdfBlob(dataUri); if (pdf.error) return pdf;
      return rpc('ws_ahu_save_pdf', { p_token: token, p_day: day, p_file: await upload('ahu_pdf', pdf) });
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

    /* ── 소화전·공기호흡기 (supabase/23_fire_equip.sql, 결정 224). 점검 입력·QR 표는 eq.html 이 따로 부름 ── */
    eqList: async (token, kind) => eqPage(await rpc('ws_eq_list', { p_token: token, p_kind: kind || 'hyd' })),
    eqAdd: async (token, d) => eqPage(await rpc('ws_eq_add', { p_token: token, p_d: d || {} })),
    eqDelete: async (token, ids, kind) => eqPage(await rpc('ws_eq_delete', { p_token: token, p_ids: ids || [], p_kind: kind || 'hyd' })),
    eqStatus: (token, ym) => rpc('ws_eq_status', { p_token: token, p_ym: ym || '' }),
    eqDetail: (token, id) => rpc('ws_eq_detail', { p_token: token, p_check_id: String(id || '') }),
    eqCheckDelete: (token, id) => rpc('ws_eq_check_delete', { p_token: token, p_check_id: String(id || '') }),   // 점검 기록 삭제 (결정 290)
    feCheckDelete: (token, id) => rpc('ws_fe_check_delete', { p_token: token, p_check_id: String(id || '') }),
    /** QR 관리 v2 (결정 228): 위치 이름 고치기(QR 그대로) · 인쇄함 표시 — kind: fe 소화기 · hyd 소화전 · air 공기호흡기 */
    qrRename: async (token, kind, floor, oldP, newP) => (kind === 'fe' ? fePage : eqPage)(await rpc('ws_qr_rename', { p_token: token, p_kind: kind, p_floor: floor, p_old: oldP, p_new: newP })),
    qrPrinted: async (token, kind, ids) => (kind === 'fe' ? fePage : eqPage)(await rpc('ws_qr_printed', { p_token: token, p_kind: kind, p_ids: ids || [] })),

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

    /* ── 위험작업신청서 (supabase/25_risk.sql): 사진은 버킷 risk_photo/ 에 먼저 — 글자가 읽히게 다시 줄이지 않고 그대로 (화면이 2400px·85%로 줄여 보냄) ── */
    rwList: (token, q, from, to) => rpc('ws_rw_list', { p_token: token, p_q: q || '', p_from: from || '', p_to: to || '' }),
    async rwAdd(token, day, co, floor, dataUri, cid) {
      let blob; try { blob = dataUrlToBlob(dataUri); } catch (e) { return { ok: false, error: '사진을 읽지 못했습니다. 다시 찍어 주세요.' }; }
      return rpc('ws_rw_add', { p_token: token, p_day: day || '', p_co: co || '', p_floor: floor || '', p_file: await upload('risk_photo', blob, 'jpg'), p_cid: cid || '' });
    },
    rwDelete: (token, id) => rpc('ws_rw_delete', { p_token: token, p_id: String(id || '') }),

    /* ── 주간/야간 작업내역 (supabase/26_workhist.sql): 사진은 버킷 dw_photo/ 에 먼저 — 화면이 이미 줄여 보내므로 그대로 ── */
    dwList: (token, q, from, to) => rpc('ws_dw_list', { p_token: token, p_q: q || '', p_from: from || '', p_to: to || '' }),
    dwSave: async (token, d) => rpc('ws_dw_save', { p_token: token, p_d: Object.assign({}, d, { before: await dwPics(d.before), after: await dwPics(d.after) }) }),
    dwDelete: (token, id) => rpc('ws_dw_delete', { p_token: token, p_id: String(id || '') }),
    dnList: (token, q, from, to) => rpc('ws_dn_list', { p_token: token, p_q: q || '', p_from: from || '', p_to: to || '' }),
    dnSave: async (token, d) => rpc('ws_dn_save', { p_token: token, p_d: Object.assign({}, d, { photos: await dwPics(d.photos), fire: await dwPics(d.fire), pledge: await dwPics(d.pledge) }) }),
    dnDelete: (token, id) => rpc('ws_dn_delete', { p_token: token, p_id: String(id || '') }),

    /* ── 하자점검 (supabase/27_defect.sql): 사진·서명은 버킷 dw_photo/ 에 먼저 올리고 {file} 로 넘김 ── */
    hjList: (token, q, from, to) => rpc('ws_hj_list', { p_token: token, p_q: q || '', p_from: from || '', p_to: to || '' }),
    async hjSave(token, d) {
      const one = async (p, ext) => p && p.data ? { file: await upload('dw_photo', dataUrlToBlob(p.data), ext) } : p && p.id ? { id: p.id } : null;
      const items = []; for (const it of d.items || []) items.push({ n: it.n, t: it.t, photo: await one(it.photo, 'jpg') });
      return rpc('ws_hj_save', { p_token: token, p_d: { id: d.id, day: d.day, items, signSite: await one(d.signSite, 'png'), signFm: await one(d.signFm, 'png') } });
    },
    hjDelete: (token, id) => rpc('ws_hj_delete', { p_token: token, p_id: String(id || '') }),

    /* ── 3-6 환경설정 (supabase/08_settings.sql, 소장만). 위험성 목록은 시트 대신 여기서 고침 ── */
    adminStaff: token => rpc('ws_admin_staff', { p_token: token }),
    adminSetToast: (token, sec) => rpc('ws_admin_set_toast', { p_token: token, p_sec: Number(sec) }),
    adminSetMenu: (token, off) => rpc('ws_admin_set_menu', { p_token: token, p_off: off }),
    adminStaffSave: (token, d) => rpc('ws_admin_staff_save', { p_token: token, p_d: d || {} }),
    adminStaffPin: (token, id, pin) => rpc('ws_admin_staff_pin', { p_token: token, p_staff_id: String(id || ''), p_pin: String(pin || '') }),
    adminStaffRemove: (token, id) => rpc('ws_admin_staff_remove', { p_token: token, p_staff_id: String(id || '') }),
    riskGet: token => rpc('ws_risk_get', { p_token: token }),
    riskSave: (token, rows) => rpc('ws_risk_save', { p_token: token, p_rows: rows || [] })
  };

  /* ── 오프라인 임시 저장 (결정 222): 공조기 환기온도 · 가동시간 · 온습도 저장은 먼저 기기 상자에 넣고 보냄 ──
     신호가 없으면 「저장 대기」로 남고, 화면에는 마지막으로 받은 자료에 방금 입력을 얹어 돌려줌. 읽기 자료도 기기에 복사해 둠(지하에서 화면 열기) */
  const OFF = window.WS_OFFLINE;
  if (OFF) {
    const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 용량이 모자라면 복사만 건너뜀 */ } };
    const rkey = (name, a) => 'ws_rc:' + name + ':' + a.join('|');
    // 읽기: 성공하면 복사해 두고, 신호가 없어 못 받으면 복사본을 돌려줌 (r.offline = true)
    const cachedGet = (name, keyArgs) => {
      const f = API[name];
      API[name] = async (...a) => {
        try {
          const r = await f(...a);
          if (r && r.ok) { lsSet(rkey(name, keyArgs(a)), r); if (r.day) lsSet(rkey(name, keyArgs(a, r.day)), r); }   // 날짜를 안 주고 받은 것(오늘)은 그 날짜 이름으로도 복사
          return r;
        } catch (e) {
          const c = OFF.isNet(e) && lsGet(rkey(name, keyArgs(a)));
          if (c) { c.offline = true; return c; }
          throw e;
        }
      };
    };
    cachedGet('usageGet', (a, d) => [a[1], d !== undefined ? d : a[2] || '']);
    cachedGet('ahuGet', (a, d) => [d !== undefined ? d : a[1] || '']);
    cachedGet('climateGet', () => []);
    const after = (res, name, keyArgs, patch) => {
      if (res.status === 'sent' || res.status === 'rejected' || res.status === 'full' || res.status === 'nostore') return res.r;
      const c = lsGet(rkey(name, keyArgs)) || {};
      const r = patch ? patch(c) : c;
      r.ok = true; r.queued = true; r.offline = true; return r;
    };
    const asNum = v => v === '' || v == null ? null : Number(v);

    OFF.handler('usage', (j, ctx) => rpc('ws_usage_save', { p_token: ctx.token, p_kind: j.args.kind, p_day: j.args.day, p_rows: j.args.rows, p_at: j.enteredAt }));
    API.usageSave = async (token, kind, day, rows) => after(
      await OFF.send({ kind: 'usage', token, label: (kind === 'hvac' ? '공조기' : '에어커튼') + ' 가동시간 ' + Number(day.slice(5, 7)) + '/' + Number(day.slice(8, 10)), args: { kind, day, rows } }),
      'usageGet', [kind, day], c => {
        c.recs = c.recs || {};
        (rows || []).forEach(x => { if (x.s == null && x.e == null && !x.off) delete c.recs[x.u]; else c.recs[x.u] = { s: x.s, e: x.e, off: !!x.off, by: '', ver: '' }; });
        return c;
      });

    OFF.handler('ahu', (j, ctx) => rpc('ws_ahu_save', { p_token: ctx.token, p_day: j.args.day, p_c: j.args.c }));
    API.ahuSave = async (token, day, c) => after(
      await OFF.send({ kind: 'ahu', token, label: '공조기 환기온도 ' + Number(day.slice(5, 7)) + '/' + Number(day.slice(8, 10)), args: { day, c: c || {} } }),
      'ahuGet', [day], r => {
        const rec = r.rec = r.rec || { temps: {} }; rec.temps = rec.temps || {};
        Object.keys(c || {}).forEach(k => {
          if (k !== 'temps') { rec[k] = asNum(c[k]); return; }
          Object.keys(c.temps).forEach(u => Object.keys(c.temps[u]).forEach(t => {
            const v = asNum(c.temps[u][t]); rec.temps[u] = rec.temps[u] || {};
            if (v == null) delete rec.temps[u][t]; else rec.temps[u][t] = v;
          }));
        });
        return r;
      });

    OFF.handler('climate', (j, ctx) => rpc('ws_climate_add', { p_token: ctx.token, p_rows: j.args.rows, p_out: j.args.out, p_cid: j.id, p_at: j.enteredAt }));
    API.climateAdd = async (token, rows, out) => after(
      await OFF.send({ kind: 'climate', token, label: '온습도 ' + (rows || []).length + '곳', args: { rows: rows || [], out: out || {} } }), 'climateGet', [], null);
  }

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
          // 2026-11 새 양식: 「매장명 :」 칸 옆 칸에 이름. 옛 양식: 한 칸에 「매장명 : 이름」 또는 이름만
          const name = clean(String((/^매장명\s*:?$/.test(nx[0]) ? nx[1] : nx[0]) || '').replace(/^매장명\s*:\s*/, ''), 30);
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
  /** 소화전·공기호흡기 목록: QR 라벨 글자는 이름 통째로 (화면 labelHtml 이 label 을 씀) */
  function eqPage(r) { fePage(r); if (r && r.ok && r.items) r.items = r.items.map(i => Object.assign({ label: i.name, store: i.place }, i)); return r; }   // store = 화면이 층 아래 위치로 묶을 때 쓰는 이름 (소화기 store_name 과 같은 자리)

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
  /* 공조기·에어커튼 가동시간: Supabase ws_log_ac 에서 바로 (결정 194, 전: 구글 ?api=logac 가 옛 온습도 앱을 읽음). 같은 날은 10분 기억 */
  const AC = {};
  // 기다리지 않음: 기억한 값이 없으면 r.acLater(약속)만 붙여 돌려줌 → 화면이 일지를 먼저 그리고 도착하면 그 칸만 채움
  function withAc(r, token) {
    if (!r || !r.day) return r;
    const c = AC[r.day];
    if (c && c.ac && Date.now() - c.at < 600e3) { r.ac = c.ac; return r; }
    if (!c || !c.p || Date.now() - c.at >= 600e3) {
      const day = r.day, p = (async () => {
        try {
          const j = await rpc('ws_log_ac', { p_token: token, p_day: day, p_prev: r.prevDay || '' });
          if (!j.ok) throw new Error(j.error || '');
          AC[day] = { at: Date.now(), ac: j.ac };
          return j.ac;
        } catch (e) { delete AC[day]; return { err: '가동시간 기록을 불러오지 못했습니다' }; }
      })();
      AC[day] = { at: Date.now(), p };   // 같은 날을 받는 중이면 다시 부르지 않음
      fetch(C.WS_GAS_URL + '?api=logac&day=' + day).catch(() => {});   // 날씨가 빠진 날 구글이 채움 (기다리지 않음)
    }
    r.acLater = AC[r.day].p;
    return r;
  }

  window.WS_API = {
    sb, upload, compressImage, dataUrlToBlob,
    /** 기기 등록 상태: 등록됐으면 { email, at } , 아니면 null */
    async device() {
      const { data, error } = await sb.auth.getSession();
      const s = data && data.session;
      let at = '', kept = false; try { at = localStorage.getItem('ws_dev_at') || ''; kept = !!localStorage.getItem('ws_sb_auth'); } catch (e) {}
      // 등록 기록은 남았는데 새로 받기만 실패(인터넷 늦음 등) → 등록 화면 대신 다시 시도 (결정 286). 서버가 무효로 본 기록은 supabase-js 가 이미 지움
      if (!s && error && kept) throw new Error('RETRY');
      this.gone = !s && !!at;   // 등록한 날은 남았는데 로그인만 없음 = 브라우저가 지운 게 아니라 서버에서 풀림 (등록 화면 안내용)
      return s ? { email: s.user.email || '', at } : null;   // at = 이 기기에서 등록한 날 (계정 전체의 마지막 로그인이 아님)
    },
    async register(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
      if (!error) try { localStorage.setItem('ws_dev_at', new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)); navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {}); } catch (e) {}   // persist: 저장 공간이 모자랄 때 브라우저가 먼저 지우지 않게 (닫을 때 삭제 설정은 못 막음)
      if (error) throw new Error(/invalid/i.test(error.message) ? '이메일 또는 비밀번호가 맞지 않습니다. 관리자에게 확인해 주세요.' : '등록하지 못했습니다: ' + error.message);
    },
    async unregister(token) {
      try { if (token) await rpc('ws_logout', { p_token: token }); } catch (e) { /* 표가 이미 없어도 등록은 풂 */ }
      await sb.auth.signOut();
      try { localStorage.removeItem('ws_dev_at'); } catch (e) {}
    },
    run(fn, ...args) {
      if (!API[fn]) return Promise.reject(new Error('아직 옮기지 않은 기능입니다 (Supabase 이관 중): ' + fn));
      return API[fn](...args);
    }
  };
})();
