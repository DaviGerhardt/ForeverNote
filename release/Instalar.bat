@echo off
chcp 65001 >nul
title Instalar ForeverNote
set "DEST=%LOCALAPPDATA%\Programs\ForeverNote"
echo.
echo   Instalando o ForeverNote...
taskkill /im "ForeverNote.exe" /f >nul 2>&1
timeout /t 1 /nobreak >nul
robocopy "%~dp0ForeverNote" "%DEST%" /MIR /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
  echo   Nao foi possivel copiar os arquivos. Feche o app e tente de novo.
  pause
  exit /b 1
)
echo   Pronto! Abrindo o app...
echo   Os atalhos na Area de Trabalho e no Menu Iniciar sao criados na primeira abertura.
start "" "%DEST%\ForeverNote.exe"
timeout /t 3 /nobreak >nul
