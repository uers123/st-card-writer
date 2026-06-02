$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PortStart = 8787
$PortEnd = 8799

Set-Location -LiteralPath $Root

function Test-Command($Name) {
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-Health($Url) {
    try {
        $health = Invoke-RestMethod -Uri "$Url/api/health" -Method Get -TimeoutSec 2
        return [bool]$health.ok
    } catch {
        return $false
    }
}

function Test-PortInUse($Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-LaunchTarget {
    for ($port = $PortStart; $port -le $PortEnd; $port++) {
        $url = "http://localhost:$port"
        if (Test-Health $url) {
            return @{ Port = $port; Url = $url; Running = $true }
        }
        if (-not (Test-PortInUse $port)) {
            return @{ Port = $port; Url = $url; Running = $false }
        }
    }

    throw "No available port found from $PortStart to $PortEnd."
}

if (-not (Test-Command 'node')) {
    Write-Host 'Node.js is not installed or not available in PATH.' -ForegroundColor Red
    Write-Host 'Install Node.js 20+ first, then run Start.bat again.'
    pause
    exit 1
}

if (-not (Test-Command 'npm')) {
    Write-Host 'npm is not installed or not available in PATH.' -ForegroundColor Red
    Write-Host 'Install Node.js/npm first, then run Start.bat again.'
    pause
    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
    Write-Host 'Installing dependencies...'
    npm install
}

$target = Get-LaunchTarget
$Url = $target.Url
$Port = $target.Port

if ($target.Running) {
    Write-Host "Server is already running: $Url" -ForegroundColor Green
    Start-Process $Url
    exit 0
}

Write-Host "Starting SillyTavern card writer on port $Port..."
$escapedRoot = $Root.Replace("'", "''")
$serverCommand = "Set-Location -LiteralPath '$escapedRoot'; `$env:PORT='$Port'; npm start"
Start-Process powershell.exe -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $serverCommand)

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Health $Url) {
        Write-Host "Opened: $Url" -ForegroundColor Green
        Start-Process $Url
        exit 0
    }
}

Write-Host "Server did not respond yet. Check the server window, then open $Url manually." -ForegroundColor Yellow
pause
