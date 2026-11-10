# Gera o instalador ForeverNote-Setup-vX.Y.Z.exe (Inno Setup) a partir do pacote montado por build-release.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$ver = (Get-Content (Join-Path $root 'app/package.json') -Raw | ConvertFrom-Json).version
$src = Join-Path $root "out/ForeverNote v$ver/ForeverNote"
if (-not (Test-Path (Join-Path $src 'ForeverNote.exe'))) { throw "Pacote nao encontrado: $src" }

$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) {
  Write-Host 'Instalando o Inno Setup...'
  choco install innosetup -y --no-progress | Out-Host
  $iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw 'Inno Setup (ISCC.exe) nao encontrado.' }

$outDir = Join-Path $root 'out'
Push-Location (Join-Path $PSScriptRoot 'setup')
try {
  & $iscc "/DAppVer=$ver" "/DSrcDir=$src" "/DOutDir=$outDir" /Qp 'ForeverNote.iss'
  if ($LASTEXITCODE -ne 0) { throw "Falha ao gerar o instalador (codigo $LASTEXITCODE)." }
} finally { Pop-Location }
$exe = Join-Path $outDir "ForeverNote-Setup-v$ver.exe"
Write-Host "OK: $exe ($([math]::Round((Get-Item $exe).Length / 1MB)) MB)"
