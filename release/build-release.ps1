# Monta o ForeverNote para Windows (pacote portatil + instalador .bat) no GitHub Actions.
# Gera out/ForeverNote-vX.Y.Z.zip com a pasta "ForeverNote vX.Y.Z" dentro.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path $PSScriptRoot -Parent
$ver = (Get-Content (Join-Path $root 'app/package.json') -Raw | ConvertFrom-Json).version
$electron = '37.10.3'
$out = Join-Path $root 'out'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
$pkg = Join-Path $out "ForeverNote v$ver"
$appDir = Join-Path $pkg 'ForeverNote'
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

# motor do app (Electron para Windows 64 bits)
$ez = Join-Path $out 'electron.zip'
Invoke-WebRequest "https://github.com/electron/electron/releases/download/v$electron/electron-v$electron-win32-x64.zip" -OutFile $ez
Expand-Archive $ez -DestinationPath $appDir
Remove-Item $ez
Remove-Item (Join-Path $appDir 'resources/default_app.asar') -Force
Get-ChildItem (Join-Path $appDir 'locales') -Filter *.pak | Where-Object { $_.Name -notin @('en-US.pak', 'pt-BR.pak', 'pt-PT.pak') } | Remove-Item
Rename-Item (Join-Path $appDir 'electron.exe') 'ForeverNote.exe'

# o app em si
Copy-Item (Join-Path $root 'app') (Join-Path $appDir 'resources/app') -Recurse

# icone e nome no .exe
$rc = Join-Path $out 'rcedit.exe'
Invoke-WebRequest 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' -OutFile $rc
& $rc (Join-Path $appDir 'ForeverNote.exe') `
  --set-icon (Join-Path $root 'app/build/icon.ico') `
  --set-file-version $ver --set-product-version $ver `
  --set-version-string ProductName 'ForeverNote' `
  --set-version-string FileDescription 'ForeverNote' `
  --set-version-string CompanyName 'revmpt' `
  --set-version-string LegalCopyright 'by revmpt' `
  --set-version-string OriginalFilename 'ForeverNote.exe' `
  --set-version-string InternalName 'ForeverNote'
if ($LASTEXITCODE -ne 0) { throw "Falha ao aplicar o icone (codigo $LASTEXITCODE)." }
Remove-Item $rc

# instalador e leia-me
Copy-Item (Join-Path $PSScriptRoot 'Instalar.bat') $pkg
Copy-Item (Join-Path $PSScriptRoot 'Desinstalar.bat') $pkg
(Get-Content (Join-Path $PSScriptRoot 'LEIA-ME.txt') -Raw).Replace('{VERSAO}', $ver) | Set-Content (Join-Path $pkg 'LEIA-ME.txt') -Encoding utf8

$zip = Join-Path $out "ForeverNote-v$ver.zip"
Compress-Archive -Path $pkg -DestinationPath $zip -CompressionLevel Optimal
Write-Host "OK: $zip ($([math]::Round((Get-Item $zip).Length / 1MB)) MB)"
