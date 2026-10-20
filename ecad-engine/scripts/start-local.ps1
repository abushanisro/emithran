<#
Starts the ecad-engine natively on Windows (no Docker) on http://127.0.0.1:5100.

  powershell -ExecutionPolicy Bypass -File ecad-engine/scripts/start-local.ps1
  powershell -ExecutionPolicy Bypass -File ecad-engine/scripts/start-local.ps1 -Port 5200
  powershell -ExecutionPolicy Bypass -File ecad-engine/scripts/start-local.ps1 -Python C:\path\to\python.exe

The engine needs Python 3.11 or 3.12 (the pinned pydantic-core has no wheel for 3.14 yet). On the first run it creates .venv
with the first of: -Python, the py launcher (3.12, then 3.11), or a conda environment that has 3.12 or 3.11. Later runs reuse
.venv and only check that the pinned requirements are installed.

The API key is taken, in order, from ECAD_ENGINE_API_KEY in the environment, ecad-engine/.env, or backend/.env (so the backend
and the engine always share one key). Only when none exists is a random key generated; it is written to ecad-engine/.env and
backend/.env needs the same value. Both files are git-ignored.
#>
param([int]$Port = 5100, [string]$Python = '')

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-SupportedPython([string]$exe) {
    if (-not (Test-Path $exe)) { return $false }
    $version = & $exe -c "import sys; print('%d.%d' % sys.version_info[:2])" 2>$null
    return $version -in @('3.12', '3.11')
}

function Find-Python {
    if ($Python) {
        if (Test-SupportedPython $Python) { return $Python }
        throw "$Python is not Python 3.12 or 3.11."
    }
    foreach ($candidate in @('-3.12', '-3.11')) {
        $exe = & py $candidate -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $exe) { return $exe.Trim() }
    }
    $condaRoots = @("$env:USERPROFILE\miniconda3", "$env:USERPROFILE\anaconda3", "$env:LOCALAPPDATA\miniconda3", "$env:ProgramData\miniconda3")
    foreach ($condaRoot in $condaRoots) {
        foreach ($exe in @(Get-ChildItem -Path "$condaRoot\envs\*\python.exe" -ErrorAction SilentlyContinue)) {
            if (Test-SupportedPython $exe.FullName) { return $exe.FullName }
        }
    }
    throw "Python 3.12 or 3.11 was not found (py launcher or conda). Install it, pass -Python <path>, or run the service in Docker: see RUNNING.md."
}

if (-not (Test-Path .venv\Scripts\python.exe)) {
    $base = Find-Python
    Write-Host "Creating .venv with $base ..."
    & $base -m venv .venv
}
& .\.venv\Scripts\python.exe -m pip install --quiet --disable-pip-version-check -r requirements.txt

function Read-Key([string]$file) {
    if (-not (Test-Path $file)) { return $null }
    foreach ($line in Get-Content $file) {
        if ($line -match '^\s*ECAD_ENGINE_API_KEY\s*=\s*(.+?)\s*$') { return $Matches[1].Trim('"').Trim("'") }
    }
    return $null
}

if (-not $env:ECAD_ENGINE_API_KEY) { $env:ECAD_ENGINE_API_KEY = Read-Key '.env' }
if (-not $env:ECAD_ENGINE_API_KEY) {
    $env:ECAD_ENGINE_API_KEY = Read-Key '..\backend\.env'
    if ($env:ECAD_ENGINE_API_KEY) { "ECAD_ENGINE_API_KEY=$($env:ECAD_ENGINE_API_KEY)" | Out-File -Encoding ascii .env }
}
if (-not $env:ECAD_ENGINE_API_KEY) {
    $bytes = New-Object byte[] 24
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $env:ECAD_ENGINE_API_KEY = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    "ECAD_ENGINE_API_KEY=$($env:ECAD_ENGINE_API_KEY)" | Out-File -Encoding ascii .env
    Write-Host "Generated an API key and saved it to ecad-engine/.env. Put the same value in backend/.env as ECAD_ENGINE_API_KEY."
}

$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) { throw "Port $Port is already in use (process $($busy.OwningProcess)). Stop it, or pass -Port." }

$env:PORT = "$Port"
Write-Host "ecad-engine on http://127.0.0.1:$Port  (Ctrl+C stops it)"
& .\.venv\Scripts\python.exe main.py
