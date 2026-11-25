@echo off
chcp 65001 >nul
title 열화상 리포트 자동 작성기 (보안 인증)
cls
echo ========================================================
echo       열화상 리포트 자동 작성 시스템 (보안 인증)
echo ========================================================
echo.
set /p USER_INPUT="비밀번호를 입력하세요: "

powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=[System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes('%USER_INPUT%'.Trim()))).Replace('-','').ToLower(); if($h -eq '9562f4870effc101cf5d2152b4775e86a06bf54593aba697a5860d70e266dafd'){exit 0}else{exit 1}"

if errorlevel 1 (
    echo.
    echo [인증 실패] 비밀번호가 올바르지 않습니다.
    timeout /t 3 >nul
    exit /b 1
)

echo.
echo [인증 성공] 시스템을 시작합니다...
netstat -ano | findstr :8150 | findstr LISTENING > nul
if errorlevel 1 (
    start /b python -m http.server 8150 --directory "%~dp0..\.." > nul 2>&1
    ping 127.0.0.1 -n 2 > nul
)
start "" "http://localhost:8150/fm/thermal/index.html?auth=9562f4870effc101cf5d2152b4775e86a06bf54593aba697a5860d70e266dafd"
exit
