# Testa o instalador num Windows de verdade (GitHub Actions) antes de publicar:
# instala, confere, reinstala por cima, desinstala e garante que as notas nao foram tocadas.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$ver = (Get-Content (Join-Path $root 'app/package.json') -Raw | ConvertFrom-Json).version
$exe = Join-Path $root "out/ForeverNote-Setup-v$ver.exe"
$app = Join-Path $env:LOCALAPPDATA 'Programs\ForeverNote'
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{8E3A5C2B-6F1D-4B7A-9C3E-2D5F7A1B9C40}_is1'
$startLnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'ForeverNote.lnk'
$deskLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'ForeverNote.lnk'
$notes = Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'ForeverNote'
function Check($ok, $msg) { if (-not $ok) { throw "FALHOU: $msg" } ; Write-Host "  ok - $msg" }
function Run($file, $argList) { $p = Start-Process $file -ArgumentList $argList -Wait -PassThru; return $p.ExitCode }

New-Item -ItemType Directory -Force -Path $notes | Out-Null
Set-Content (Join-Path $notes 'nota-de-teste.json') '{"teste":"nao pode ser apagada"}'

Write-Host '1) Instalacao nova'
Check ((Run $exe @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/TASKS=desktopicon')) -eq 0) 'instalador terminou sem erro'
foreach ($f in @('ForeverNote.exe', 'resources\app\main.js', 'resources\app\renderer\app.js', 'resources\app\build\icon.ico')) { Check (Test-Path (Join-Path $app $f)) "arquivo $f" }
Check (-not (Test-Path (Join-Path $app 'resources\default_app.asar'))) 'sem arquivo de exemplo do Electron'
Check ((Get-Content (Join-Path $app 'resources\app\package.json') -Raw | ConvertFrom-Json).version -eq $ver) "versao do app = $ver"
Check (Test-Path $startLnk) 'atalho no Menu Iniciar'
Check (Test-Path $deskLnk) 'atalho na Area de Trabalho'
$reg = Get-ItemProperty $key
Check ($reg.DisplayVersion -eq $ver) "Aplicativos do Windows mostra a versao $ver"
Check ($reg.DisplayName -eq 'ForeverNote') 'nome em Aplicativos do Windows'
Check ($reg.Publisher -eq 'revmpt') 'editor revmpt'

Write-Host '2) Reinstalar por cima (atualizacao)'
Set-Content (Join-Path $app 'resources\app\arquivo-velho.txt') 'versao antiga'
Check ((Run $exe @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')) -eq 0) 'reinstalacao sem erro'
Check (-not (Test-Path (Join-Path $app 'resources\app\arquivo-velho.txt'))) 'arquivos antigos do app removidos'
Check (Test-Path (Join-Path $app 'resources\app\main.js')) 'app continua completo'

Write-Host '3) Desinstalar'
$un = (Get-ItemProperty $key).UninstallString.Trim('"')
Check ((Run $un @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART')) -eq 0) 'desinstalador terminou sem erro'
$t = 0; while ((Test-Path (Join-Path $app 'ForeverNote.exe')) -and $t -lt 60) { Start-Sleep 1; $t++ }
Check (-not (Test-Path (Join-Path $app 'ForeverNote.exe'))) 'programa removido'
Check (-not (Test-Path $startLnk)) 'atalho do Menu Iniciar removido'
Check (-not (Test-Path $deskLnk)) 'atalho da Area de Trabalho removido'
Check (-not (Test-Path $key)) 'removido de Aplicativos do Windows'
Check (Test-Path (Join-Path $notes 'nota-de-teste.json')) 'NOTAS INTACTAS depois de desinstalar'
Write-Host 'Instalador aprovado.'
