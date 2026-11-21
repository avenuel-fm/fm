// 업무지원 앱 파일을 기기에 복사 (결정 222): 신호 없는 지하에서도 앱·QR 점검 화면이 열리게.
// 「신호가 되면 늘 새 파일, 안 되면(4초) 복사본」 방식이라 업데이트가 늦게 반영되지 않음. 서버(Supabase) 요청은 건드리지 않음.
const CK = 'ws-shell-v1';
const KEEP = [/^\/fm\/ws\/[^/]*$/, /^\/fm\/(apps\.js|icon-\d+\.png)$/, /^\/fm\/?$/];   // 같은 사이트 안에서 복사할 것
const CDN = /^https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\//;

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CK).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const own = u.origin === self.location.origin && KEEP.some(re => re.test(u.pathname));
  if (!own && !CDN.test(r.url)) return;
  const key = own ? u.origin + u.pathname : r.url;   // ?fe=…·?v=… 달라도 같은 파일
  e.respondWith((async () => {
    const c = await caches.open(CK);
    try {
      const res = await Promise.race([fetch(r), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]);
      if (res && res.ok) c.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await c.match(key);
      if (hit) return hit;
      throw err;
    }
  })());
});
