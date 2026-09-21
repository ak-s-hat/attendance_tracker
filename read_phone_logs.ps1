# read_phone_logs.ps1 - Stream live React Native and Android logs from your connected phone
param (
    [switch]$DumpOnly
)

$adb = "d:\ML\platform-tools\adb.exe"

if (-not (Test-Path $adb)) {
    Write-Host "ERROR: adb.exe not found at $adb" -ForegroundColor Red
    exit 1
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " Attendance Tracker -- Live Phone Log Streamer" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Check connected devices
$rawDevices = & $adb devices -l
$deviceLine = $rawDevices | Where-Object { $_ -match "\bdevice\b" -and $_ -notmatch "List of" }

if (-not $deviceLine) {
    Write-Host "No authorized Android device detected!" -ForegroundColor Yellow
    Write-Host "Please ensure:" -ForegroundColor Yellow
    Write-Host " 1. USB cable is firmly connected"
    Write-Host " 2. Developer Options -> USB Debugging is turned ON"
    Write-Host " 3. Phone screen is unlocked and 'Allow USB debugging' was accepted"
    Write-Host ""
    & $adb devices -l
    exit 1
}

Write-Host "Connected Device:" -ForegroundColor Green
Write-Host "  $deviceLine" -ForegroundColor Green
Write-Host ""

if ($DumpOnly) {
    Write-Host "Dumping recent React Native logs..." -ForegroundColor Yellow
    & $adb logcat -d -v time ReactNativeJS:V AndroidRuntime:E *:S
} else {
    Write-Host "STREAMING LIVE LOGS IN REAL-TIME..." -ForegroundColor Green
    Write-Host "Everything you do on the app will print below live." -ForegroundColor Gray
    Write-Host "Press Ctrl+C anytime to stop." -ForegroundColor Yellow
    Write-Host "------------------------------------------------------------" -ForegroundColor DarkGray
    
    # Continuous live streaming without -d or -t so it never exits
    & $adb logcat -v time ReactNativeJS:V AndroidRuntime:E *:S
}
