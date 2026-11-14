// 도면협의(DW) Supabase 설정 — 한곳에서 관리 (docs/설계/DW_Supabase이관.md)
// 여기 값은 화면에 그대로 보이는 공개용 값입니다. 자료는 DB 함수(PIN 확인 뒤)로만 읽고 씁니다.
// ⚠ service_role(secret) 키는 절대 여기에 넣지 않습니다 — 구글 Apps Script 스크립트 속성에만.
window.DW_CONFIG = Object.freeze({
  // 바꿔 타는 날 스위치: true = 바로가기·QR(?store=)·서명 메일(?sign=)이 Supabase 앱(app.html)으로. false 로 되돌리면 옛 구글 앱
  LIVE: true,
  SUPABASE_URL: 'https://kjhsduhufwaihhlfdipf.supabase.co',             // 업무지원과 같은 Supabase 프로젝트
  SUPABASE_ANON_KEY: 'sb_publishable_fOT-Mnciwl0HDrPKbfOh4g_VrcOObR6',   // publishable(anon) 키
  SUPABASE_BUCKET_NAME: 'dw-files'                                       // supabase/01_schema.sql 의 공개 버킷
  // 메일·드라이브 파일은 도면협의 구글 웹앱으로 — 주소는 ../apps.js 의 dw.exec
});
