// 업무지원(WS) Supabase 설정 — 한곳에서 관리 (Supabase 이관 2단계, docs/설계/WS_Supabase이관.md)
// 여기 값은 화면에 그대로 보이는 공개용 값입니다. 데이터는 RLS(로그인한 사용자만)로 지킵니다.
// ⚠ service_role(secret) 키는 절대 여기에 넣지 않습니다 — 구글 Apps Script 스크립트 속성에만.
window.WS_CONFIG = Object.freeze({
  // 바꿔 타는 날 스위치 (WS_Supabase이관.md 4.17): true = 바로가기·QR(?fe= ?eh=)이 Supabase 화면으로. false 로 되돌리면 옛 구글 앱
  LIVE: true,
  SUPABASE_URL: 'https://kjhsduhufwaihhlfdipf.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_fOT-Mnciwl0HDrPKbfOh4g_VrcOObR6',   // publishable(anon) 키
  SUPABASE_BUCKET_NAME: 'ws-files',   // 01_schema_rls.sql 8장의 공개 버킷
  // 구글에 남는 일(공조기 가동시간 ?api=logac)을 부르는 업무지원 웹앱 주소 — fm/apps.js 의 ws.exec 와 같음
  WS_GAS_URL: 'https://script.google.com/macros/s/AKfycbxzD0-R4Cg5_eeECMfgLok3lCSOZuac5cwVSVLvVuQTp_d3rfm_HWH1ju-EmyVC5qut6Q/exec'
});
