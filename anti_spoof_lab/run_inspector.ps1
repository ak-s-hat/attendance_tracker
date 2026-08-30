# ============================================================
# Launcher for Anti-Spoof & Liveness Forensic Lab
# Run from attendance_tracker\ root directory
# ============================================================

$VENV_PYTHON = ".\backend\venv\Scripts\python.exe"

if (-not (Test-Path $VENV_PYTHON)) {
    Write-Host "[!] Error: Backend virtualenv not found at $VENV_PYTHON" -ForegroundColor Red
    Write-Host "    Please ensure virtual environment is created in backend\venv" -ForegroundColor Yellow
    exit 1
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Starting Anti-Spoof & Face Detection Forensic Lab" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Opening laptop webcam feed..." -ForegroundColor Green
Write-Host "Press [SPACE] inside camera window to capture full analysis." -ForegroundColor Yellow
Write-Host "Press [Q] inside camera window to exit." -ForegroundColor Yellow
Write-Host ""

& $VENV_PYTHON "anti_spoof_lab\inspector.py" $args
