@echo off
title Avenuel Thermal Reporter
netstat -ano | findstr :8150 | findstr LISTENING > nul
if errorlevel 1 (
    start /b python -m http.server 8150 --directory "%~dp0..\.." > nul 2>&1
    ping 127.0.0.1 -n 2 > nul
)
start "" "http://localhost:8150/fm/thermal/index.html"
exit
