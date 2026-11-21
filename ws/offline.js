// 오프라인 임시 저장 — 「보낼 일 상자」 (결정 222, docs/설계/WS_오프라인저장.md)
// 입력을 먼저 이 기기(IndexedDB)에 넣고 → 바로 보내 보고 → 신호 문제로 못 보냈으면 남겨 두었다가 자동으로 다시 보냄.
// 같은 입력은 job.id(= client_id)로 서버가 한 번만 받음. 업무지원 앱(app.html)과 QR 점검(check-sb.html)이 함께 씀.
(function () {
  'use strict';
  var DB = 'ws_outbox', ST = 'jobs', MAX_JOBS = 30, MAX_BYTES = 50 * 1024 * 1024, TRY_MS = 15000;
  var handlers = {}, subs = [], cache = [], busy = false, dbp = null;
  var OFF = window.WS_OFFLINE = { tokenFn: function () { return ''; } };   // tokenFn: 앱이 지금 로그인 표를 알려 줌

  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/-/g, ''); }
  function db() {
    return dbp || (dbp = new Promise(function (ok, no) {
      if (!window.indexedDB) return no(new Error('indexedDB 없음'));
      var r; try { r = indexedDB.open(DB, 1); } catch (e) { return no(e); }
      r.onupgradeneeded = function () { r.result.createObjectStore(ST, { keyPath: 'id' }); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = r.onblocked = function () { no(r.error || new Error('indexedDB 열기 실패')); };
    }));
  }
  function tx(mode, f) {
    return db().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction(ST, mode), s = t.objectStore(ST), q = f(s);
        t.oncomplete = function () { ok(q && q.result); }; t.onerror = t.onabort = function () { no(t.error); };
      });
    });
  }
  var all = function () { return tx('readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).sort(function (x, y) { return x.createdAt < y.createdAt ? -1 : 1; }); }); };
  var put = function (j) { return tx('readwrite', function (s) { return s.put(j); }); };
  var del = function (id) { return tx('readwrite', function (s) { return s.delete(id); }); };

  /* 신호 문제(보낼 수 없음)인지, 서버가 답을 준 것인지 */
  function isNet(e) {
    var m = String(e && e.message || e);
    return (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|networkerror|network request|load failed|fetch failed|timeout|abort|offline|bad gateway|service unavailable|gateway time|^5(02|03|04)\b/i.test(m);
  }
  var isLogin = function (e) { return String(e && e.message || e).indexOf('LOGIN') !== -1; };
  function withTimeout(p, ms) { return new Promise(function (ok, no) { var t = setTimeout(function () { no(new Error('timeout')); }, ms); p.then(function (v) { clearTimeout(t); ok(v); }, function (e) { clearTimeout(t); no(e); }); }); }
  function staffOf(token) { return String(token || '').split('.')[0] || ''; }
  function tokenAlive(t) { var p = String(t || '').split('.'); return p.length === 3 && Number(p[1]) > Date.now(); }
  function size(j) { return (j.files || []).reduce(function (n, f) { return n + (f.blob && f.blob.size || 0); }, 0); }

  function refresh() {
    return all().then(function (a) { cache = a; subs.forEach(function (f) { try { f(a); } catch (e) {} }); paint(); return a; }, function () { return cache; });
  }
  OFF.on = function (f) { subs.push(f); };
  OFF.count = function () { return cache.length; };
  OFF.list = function () { return cache.slice(); };
  OFF.handler = function (kind, f) { handlers[kind] = f; };
  OFF.uuid = uuid;
  OFF.isNet = isNet;

  /* 한 건을 보내 봄. 반환: 'sent' | 'net' | 'login' | 'rejected' (r = 서버 답) */
  function attempt(j, token) {
    var h = handlers[j.kind]; if (!h) return Promise.resolve({ st: 'skip' });
    var ctx = { token: token, save: function () { return put(j).catch(function () {}); } };
    return withTimeout(Promise.resolve().then(function () { return h(j, ctx); }), TRY_MS).then(function (r) {
      if (r && r.ok) return { st: 'sent', r: r };
      return { st: 'rejected', r: r || { ok: false, error: '서버 답이 없습니다' } };
    }, function (e) {
      if (isLogin(e)) return { st: 'login' };
      if (isNet(e)) return { st: 'net' };
      return { st: 'rejected', r: { ok: false, error: String(e && e.message || e) } };
    });
  }

  /* 입력 한 건 보내기: job = { kind, label, args, files:[{key, blob, path}], token? } */
  OFF.send = function (job) {
    var j = { id: uuid(), kind: job.kind, label: job.label || '', args: job.args || {}, files: job.files || [], staffId: staffOf(job.token),
      enteredAt: new Date().toISOString(), createdAt: new Date().toISOString(), state: 'waiting', tries: 0, nextTry: 0, err: '' };
    var token = job.token || OFF.tokenFn();
    var stored = cache.length < MAX_JOBS && cache.reduce(function (n, x) { return n + size(x); }, size(j)) <= MAX_BYTES
      ? put(j).then(function () { return true; }, function () { return false; }) : Promise.resolve(null);
    return stored.then(function (ok) {
      if (ok === null) return { status: 'full', r: { ok: false, error: '저장 대기가 가득 찼습니다. 신호가 잡히는 곳에서 먼저 보내 주세요 (저장 대기 ' + cache.length + '건).' } };
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
      return attempt(j, token).then(function (a) {
        if (a.st === 'sent' || a.st === 'rejected') { return (ok ? del(j.id).catch(function () {}) : Promise.resolve()).then(function () { return refresh(); }).then(function () { return { status: a.st, r: a.r }; }); }
        if (!ok) return { status: 'nostore', r: { ok: false, error: '이 기기에 저장하지 못했습니다(사생활 보호 모드이거나 저장 공간 부족). 신호를 확인하고 다시 눌러 주세요.' } };
        j.state = a.st === 'login' ? 'login' : 'waiting'; j.tries = 1; j.nextTry = Date.now() + 30000; return put(j).then(function () { return refresh(); }).then(function () { return { status: 'queued', why: a.st, job: j }; });
      });
    });
  };

  /* 쌓인 것 차례로 보내기. force = 시각·상태 무시하고 지금 */
  OFF.flush = function (force) {
    if (busy) return Promise.resolve();
    busy = true;
    return all().then(function (a) {
      var token = OFF.tokenFn(), me = staffOf(token), chain = Promise.resolve();
      a.forEach(function (j) {
        chain = chain.then(function () {
          if (!handlers[j.kind] || j.state === 'conflict' || j.state === 'failed') return;
          if (!force && j.nextTry > Date.now()) return;
          if (j.staffId && (!tokenAlive(token) || j.staffId !== me)) { if (j.state !== 'login') { j.state = 'login'; return put(j); } return; }   // 본인이 로그인했을 때만
          return attempt(j, token).then(function (r) {
            if (r.st === 'sent') return del(j.id).then(function () { OFF.sentCount = (OFF.sentCount || 0) + 1; });
            if (r.st === 'skip') return;
            if (r.st === 'rejected') { j.state = r.r && r.r.exists ? 'conflict' : 'failed'; j.err = (r.r && r.r.error) || '서버가 받지 않았습니다'; return put(j); }
            if (r.st === 'login') { j.state = 'login'; return put(j); }
            j.state = 'waiting'; j.tries = (j.tries || 0) + 1; j.nextTry = Date.now() + Math.min(600000, 30000 * Math.pow(2, j.tries - 1)); return put(j);
          });
        });
      });
      return chain;
    }).catch(function () {}).then(function () { busy = false; var n = OFF.sentCount; OFF.sentCount = 0; return refresh().then(function () { if (n && OFF.onSent) OFF.onSent(n, cache.length); }); }, function () { busy = false; });
  };
  OFF.retry = function (id, patch) {   // 목록의 [지금 보내기] / [덮어쓰기]
    return all().then(function (a) {
      var j = a.filter(function (x) { return x.id === id; })[0]; if (!j) return;
      j.state = 'waiting'; j.nextTry = 0; j.err = ''; if (patch) patch(j); return put(j);
    }).then(function () { return OFF.flush(true); });
  };
  OFF.drop = function (id) { return del(id).then(refresh); };

  /* ── 화면: 「저장 대기 n건」 버튼(.offchip)은 앱·QR 화면이 그려 두고, 여기서 글자·보임만 갱신 ── */
  function paint() {
    var n = cache.length;
    [].forEach.call(document.querySelectorAll('.offchip'), function (b) { b.textContent = '저장 대기 ' + n + '건'; b.style.display = n ? '' : 'none'; });
  }
  OFF.chip = function () { var n = cache.length; return '<button class="btn sm offchip" onclick="WS_OFFLINE.open()" style="' + (n ? '' : 'display:none') + '">저장 대기 ' + n + '건</button>'; };
  var STATE = { waiting: '전송 대기', login: '로그인 필요', conflict: '확인 필요', failed: '확인 필요' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function when(iso) { var d = new Date(Date.parse(iso) + 9 * 3600e3); return (d.getUTCMonth() + 1) + '월 ' + d.getUTCDate() + '일 ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0') + ' 입력'; }
  OFF.open = function () {
    var L = document.getElementById('layer') || (function () { var x = document.createElement('div'); x.id = 'layer'; document.body.appendChild(x); return x; })();
    var me = staffOf(OFF.tokenFn());
    var rows = cache.length ? cache.map(function (j) {
      var st = j.state === 'waiting' && j.staffId && j.staffId !== me ? 'login' : j.state, bad = st === 'conflict' || st === 'failed' || st === 'login', old = Date.now() - Date.parse(j.createdAt) > 7 * 864e5;
      return '<div style="border:1px solid var(--line);padding:var(--sp-3);display:flex;flex-direction:column;gap:var(--sp-2);text-align:left">' +
        '<div style="display:flex;justify-content:space-between;gap:var(--sp-2)"><b>' + esc(j.label || j.kind) + '</b><span style="font-size:var(--size-s);border:1px solid ' + (bad ? 'var(--error)' : 'var(--line)') + ';color:' + (bad ? 'var(--error)' : 'var(--text-sub)') + ';padding:0 6px;white-space:nowrap">' + STATE[st] + '</span></div>' +
        '<span style="font-size:var(--size-s);color:var(--text-sub)">' + when(j.enteredAt) + (old ? ' · <b>7일 넘은 대기</b>' : '') + '</span>' +
        (j.err ? '<span style="font-size:var(--size-s);color:var(--error)">' + esc(j.err) + '</span>' : '') +
        (st === 'login' && j.staffId ? '<span style="font-size:var(--size-s);color:var(--text-sub)">입력한 본인이 로그인하면 보냅니다</span>' : '') +
        '<div style="display:flex;gap:var(--sp-2)">' + (j.state === 'conflict' ? '<button class="btn sm" onclick="WS_OFFLINE.act(\'over\',\'' + j.id + '\')">덮어쓰기</button>' : '<button class="btn sm" onclick="WS_OFFLINE.act(\'retry\',\'' + j.id + '\')">지금 보내기</button>') +
        '<button class="btn sm" onclick="WS_OFFLINE.act(\'drop\',\'' + j.id + '\')">버리기</button></div></div>';
    }).join('') : '<span style="color:var(--text-sub)">저장 대기 중인 입력이 없습니다.</span>';
    L.innerHTML = '<div class="dialog-back" onclick="if(event.target===this)WS_OFFLINE.close()"><div class="dialog" role="dialog" aria-modal="true" style="display:flex;flex-direction:column;gap:var(--sp-3);max-height:85vh;overflow:auto">' +
      '<h2 style="margin:0;font-size:var(--size-l)">저장 대기 ' + cache.length + '건</h2>' +
      '<div style="background:var(--tint);border-left:3px solid var(--navy);padding:var(--sp-3);font-size:var(--size-s);line-height:1.55;text-align:left">신호가 잡히는 곳에서 앱(이 화면)을 열어 두면 자동으로 보냅니다. 앱을 닫으면 멈추고, 이 기기 브라우저 데이터를 지우면 사라집니다.</div>' +
      rows + '<button class="btn" onclick="WS_OFFLINE.close()">닫기</button></div></div>';
  };
  OFF.close = function () { var L = document.getElementById('layer'); if (L) L.innerHTML = ''; };
  OFF.act = function (a, id) {
    if (a === 'drop') { if (!confirm('이 입력을 버릴까요? 버리면 되돌릴 수 없습니다.')) return; return OFF.drop(id).then(OFF.open); }
    return OFF.retry(id, a === 'over' ? function (j) { j.args.overwrite = true; } : null).then(OFF.open);
  };

  /* ── 소화기 QR 점검 보내기 (매장 직원, 로그인 없음 = anon). 앱과 QR 화면이 같은 상자를 쓰므로 여기서 한 번만 정의 ──
     사진·손글씨는 입력할 때 정한 경로로 올림(이미 있으면 성공으로 봄) → 끊겨도 같은 파일을 다시 올려 찌꺼기가 안 쌓임 */
  var anon = null;
  function sbAnon() {
    if (anon) return anon;
    var C = window.WS_CONFIG || {};
    return (anon = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } }));
  }
  OFF.handler('fire_check', function (j, ctx) {
    var sb = sbAnon(), bucket = (window.WS_CONFIG || {}).SUPABASE_BUCKET_NAME || 'ws-files';
    return j.files.reduce(function (p, f) {
      return p.then(function () {
        if (f.url) return;
        return sb.storage.from(bucket).upload(f.path, f.blob, { contentType: f.blob.type, upsert: false }).then(function (r) {
          if (r.error && !/already exists|duplicate|409/i.test(String(r.error.message) + String(r.error.statusCode))) throw new Error(r.error.message || '사진을 올리지 못했습니다');
          f.url = sb.storage.from(bucket).getPublicUrl(f.path).data.publicUrl;
          return ctx.save();
        });
      });
    }, Promise.resolve()).then(function () {
      var files = {}; j.files.forEach(function (f) { files[f.key] = { path: f.path, url: f.url }; });
      return sb.rpc('ws_check_submit', { p_qr: j.args.qr, p_d: { state: j.args.state, overwrite: !!j.args.overwrite, client_id: j.id, entered_at: j.enteredAt }, p_files: files })
        .then(function (r) { if (r.error) throw new Error(r.error.message); return r.data; });
    });
  });

  /* ── 자동 재전송: 열 때 · 신호 복구 · 화면이 다시 보일 때 · 대기가 있는 동안 30초마다 ── */
  var go = function () { if (cache.length) OFF.flush(); };
  window.addEventListener('online', function () { OFF.flush(true); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) go(); });
  setInterval(go, 30000);
  OFF.ready = refresh().then(function () { go(); });
})();
