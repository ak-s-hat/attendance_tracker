# read_phone_logs.ps1 - Stream live React Native and Android logs from your connected phone
param (
    [int]$Lines = 150
)

$adb = "d:\ML\platform-tools\adb.exe"

if (-not (Test-Path $adb)) {
    Write-Host "ERROR: adb.exe not found at $adb" -ForegroundColor Red
    exit 1
}

Write-Host "Checking connected Android devices..." -ForegroundColor Cyan
& $adb devices -l

Write-Host ""
Write-Host "Streaming latest React Native & Attendance Tracker logs..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop streaming." -ForegroundColor Yellow
Write-Host ""

& $adb logcat -v time -t $Lines *:S ReactNative:V ReactNativeJS:V CameraKiosk:V EdgeSync:V OfflineDB:V AndroidRuntime:E
