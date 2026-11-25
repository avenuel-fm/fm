@echo off
chcp 65001 >nul
title 열화상점검 실행 연결 등록
echo ========================================================
echo   업무지원 [점검 - 열화상점검] 버튼 -> PC 열화상 프로그램 실행 연결
echo   (이 PC에서 딱 한 번만 하면 됩니다)
echo ========================================================
echo.
set "BAT=C:\avenuel\열화상리포트_오프라인단독팩\열화상리포트_실행.bat"
if not exist "%BAT%" (
    echo [안 됨] 아래 파일이 없습니다. 폴더 위치를 확인해 주세요.
    echo   %BAT%
    pause
    exit /b 1
)
reg add "HKCU\Software\Classes\avenuel-thermal" /ve /d "URL:Avenuel Thermal" /f >nul
reg add "HKCU\Software\Classes\avenuel-thermal" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\avenuel-thermal\shell\open\command" /ve /d "cmd.exe /c \"\"%BAT%\"\"" /f >nul
if errorlevel 1 (
    echo [실패] 등록하지 못했습니다.
    pause
    exit /b 1
)
echo [완료] 이제 업무지원에서 열화상점검 버튼을 누르면 열화상 프로그램이 실행됩니다.
echo   처음 누를 때 브라우저가 "열기" 허용을 물으면 [허용] 또는 [열기]를 누르세요.
echo   연결을 없애려면:  reg delete "HKCU\Software\Classes\avenuel-thermal" /f
echo.
pause
