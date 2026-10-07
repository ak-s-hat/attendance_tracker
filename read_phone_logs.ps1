# read_phone_logs.ps1 - Stream / save / pull diagnostics from the Android test device
#
#   .\read_phone_logs.ps1                 Live stream (JS logs + crashes), also saved to logs\phone_<time>.log
#   .\read_phone_logs.ps1 -Tag SCAN       Show only one logger tag (SCAN, DET, LIVE, REC, MATCH, SYNC, API, CRASH ...)
#   .\read_phone_logs.ps1 -Crash          Include native errors (ONNX Runtime / JNI / tombstones) - use when the app dies
#   .\read_phone_logs.ps1 -DumpOnly       Print what is currently in the logcat buffer and exit
#   .\read_phone_logs.ps1 -Pull           Copy kiosk "Debug dump" scans to logs\debug\ (dev-client builds only)
param (
    [switch]$DumpOnly,
    [switch]$Crash,
    [switch]$Pull,
    [string]$Tag = "",
    [string]$Package = "com.attendancetracker.app"
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$adb = "d:\ML\platform-tools\adb.exe"
if (-not (Test-Path $adb)) {
    $cmd = Get-Command adb -ErrorAction SilentlyContinue
    if ($cmd) { $adb = $cmd.Source }
}
if (-not (Test-Path $adb)) {
    Write-Host "ERROR: adb.exe not found (looked in d:\ML\platform-tools and PATH)" -ForegroundColor Red
    exit 1
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Attendance Tracker -- Phone Diagnostics" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$rawDevices = & $adb devices -l
$deviceLine = $rawDevices | Where-Object { $_ -match "\bdevice\b" -and $_ -notmatch "List of" }
if (-not $deviceLine) {
    Write-Host "No authorized Android device detected!" -ForegroundColor Yellow
    Write-Host " 1. USB cable is firmly connected"
    Write-Host " 2. Developer Options -> USB Debugging is turned ON"
    Write-Host " 3. Phone screen is unlocked and 'Allow USB debugging' was accepted"
    & $adb devices -l
    exit 1
}
Write-Host "Connected Device: $deviceLine" -ForegroundColor Green

$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

# ---------------------------------------------------------------------------
# -Pull : copy debug dumps (<app files>/debug/<traceId>/*) to logs\debug\
# ---------------------------------------------------------------------------
if ($Pull) {
    $dest = Join-Path $logDir "debug"
    New-Item -ItemType Directory -Force -Path $dest | Out-Null
    $scans = & $adb shell "run-as $Package ls files/debug 2>/dev/null"
    if (-not $scans) {
        Write-Host "No debug scans found. Enable 'Debug dump' in the kiosk AI Info panel and scan first." -ForegroundColor Yellow
        Write-Host "(run-as only works on debuggable builds, i.e. the EAS 'development' profile.)" -ForegroundColor DarkGray
        exit 0
    }
    foreach ($scan in $scans) {
        $scan = $scan.Trim()
        if (-not $scan) { continue }
        $scanDir = Join-Path $dest $scan
        New-Item -ItemType Directory -Force -Path $scanDir | Out-Null
        $files = & $adb shell "run-as $Package ls files/debug/$scan"
        foreach ($f in $files) {
            $f = $f.Trim()
            if (-not $f) { continue }
            $out = Join-Path $scanDir $f
            # cmd.exe redirection keeps the bytes intact (PowerShell 5.1 '>' would re-encode binary data)
            cmd /c "`"$adb`" exec-out run-as $Package cat files/debug/$scan/$f > `"$out`""
        }
        Write-Host "  pulled $scan" -ForegroundColor Green
    }
    Write-Host "Saved to $dest" -ForegroundColor Cyan
    exit 0
}

# ---------------------------------------------------------------------------
# Log streaming
# ---------------------------------------------------------------------------
$filters = @("ReactNativeJS:V", "ReactNative:W", "AndroidRuntime:E")
if ($Crash) {
    $filters += @("DEBUG:V", "libc:F", "onnxruntime:V", "ONNXRuntime:V", "*:E")
} else {
    $filters += "*:S"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$logFile = Join-Path $logDir "phone_$stamp.log"
Write-Host "Saving full log to: $logFile" -ForegroundColor Gray
if ($Tag) { Write-Host "Showing only [$Tag] entries (file still gets everything)" -ForegroundColor Gray }

$show = {
    param($line)
    if (-not $Tag -or $line -match "\[$Tag\]") {
        if ($line -match "\[CRASH\]|AndroidRuntime|FATAL|\bE/") { Write-Host $line -ForegroundColor Red }
        elseif ($line -match "\bW/") { Write-Host $line -ForegroundColor Yellow }
        elseif ($line -match "\[SCAN\]") { Write-Host $line -ForegroundColor Cyan }
        else { Write-Host $line }
    }
}

if ($DumpOnly) {
    & $adb logcat -d -v time @filters | Tee-Object -FilePath $logFile | ForEach-Object { & $show $_ }
} else {
    Write-Host "STREAMING LIVE LOGS... (Ctrl+C to stop)" -ForegroundColor Green
    Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
    & $adb logcat -v time @filters | Tee-Object -FilePath $logFile | ForEach-Object { & $show $_ }
}
