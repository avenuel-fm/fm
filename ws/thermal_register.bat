@echo off
title Thermal link setup
powershell -NoProfile -ExecutionPolicy Bypass -Command "$b='C:\thermal\'+([char]0xC5F4+[char]0xD654+[char]0xC0C1+[char]0xB9AC+[char]0xD3EC+[char]0xD2B8+[char]0x005F+[char]0xC2E4+[char]0xD589)+'.bat'; if(-not (Test-Path -LiteralPath $b)){ Write-Host ('['+([char]0xC2E4+[char]0xD328)+'] '+([char]0xD30C+[char]0xC77C+[char]0xC774+[char]0x0020+[char]0xC5C6+[char]0xC2B5+[char]0xB2C8+[char]0xB2E4)+': '+$b); exit 1 }; $k='HKCU:\Software\Classes\avenuel-thermal'; New-Item -Path $k -Force | Out-Null; Set-ItemProperty -Path $k -Name '(default)' -Value 'URL:Avenuel Thermal'; New-ItemProperty -Path $k -Name 'URL Protocol' -Value '' -Force | Out-Null; New-Item -Path ($k+'\shell\open\command') -Force | Out-Null; Set-ItemProperty -Path ($k+'\shell\open\command') -Name '(default)' -Value ('cmd.exe /c \"\"'+$b+'\"\"'); Write-Host ('['+([char]0xC644+[char]0xB8CC)+'] OK - Thermal button is linked to this PC.')"
if errorlevel 1 (
  echo FAILED. Check that the folder C:\thermal exists.
) else (
  echo Now click the Thermal button in the work-support app.
)
echo.
pause
