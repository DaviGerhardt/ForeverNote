@echo off
chcp 65001 >nul
title Desinstalar ForeverNote
echo.
echo   Isto remove o programa e os atalhos.
echo   Suas notas NAO sao apagadas: elas continuam na pasta Documentos\ForeverNote.
echo.
pause
taskkill /im "ForeverNote.exe" /f >nul 2>&1
timeout /t 1 /nobreak >nul
rmdir /s /q "%LOCALAPPDATA%\Programs\ForeverNote"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\ForeverNote.lnk" >nul 2>&1
for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "[Environment]::GetFolderPath('Desktop')"`) do del "%%D\ForeverNote.lnk" >nul 2>&1
echo   Programa removido.
pause
