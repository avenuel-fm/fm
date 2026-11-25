@echo off
chcp 65001 > nul
title 에비뉴엘 시설팀 열화상 리포트 자동 작성기 (오프라인 단독 구동)

echo ========================================================
echo   에비뉴엘 시설팀 열화상 리포트 자동 작성기 (오프라인)
echo ========================================================
echo.
echo [1/2] 로컬 초경량 엔진 점검 중...

:: 8150 포트 점검
netstat -ano | findstr :8150 | findstr LISTENING > nul
if %errorlevel% neq 0 (
    echo [2/2] 로컬 초경량 서버 시작 중 (포트 8150)...
    start /b python -m http.server 8150 --directory "%~dp0..\.." > nul 2>&1
    timeout /t 1 /nobreak > nul
) else (
    echo [2/2] 로컬 초경량 서버가 정상 실행 중입니다.
)

echo.
echo [완료] 브라우저에서 열화상 리포트 자동 작성기를 엽니다...
start http://localhost:8150/fm/thermal/index.html

echo.
echo ========================================================
echo   인터넷 연결 없이 파일 용량 제한 없이 초고속 구동됩니다.
echo   작업 창이 열리면 이 안내창은 닫으셔도 좋습니다.
echo ========================================================
timeout /t 3 > nul
