# setup.ps1 — Run once to bootstrap the backend environment
# Execute from the project root: d:\ML\attendance_tracker\
# Run in PowerShell: .\setup.ps1

Set-Location -Path $PSScriptRoot

Write-Host "==> [1/4] Creating Python virtual environment..." -ForegroundColor Cyan
python -m venv backend\venv
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: venv creation failed" -ForegroundColor Red; exit 1 }
Write-Host "OK" -ForegroundColor Green

Write-Host "==> [2/4] Installing Python dependencies..." -ForegroundColor Cyan
& "backend\venv\Scripts\pip.exe" install -r backend\requirements.txt
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: pip install failed" -ForegroundColor Red; exit 1 }
Write-Host "OK" -ForegroundColor Green

Write-Host "==> [3/4] Starting Docker services (redis, minio, frontend, nginx)..." -ForegroundColor Cyan
docker compose up -d
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: docker compose up failed" -ForegroundColor Red; exit 1 }
Write-Host "OK" -ForegroundColor Green

Write-Host "==> [4/4] Initializing Alembic..." -ForegroundColor Cyan
Set-Location backend
& "venv\Scripts\alembic.exe" init alembic
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: alembic init failed (may already exist)" -ForegroundColor Yellow }
else { Write-Host "OK" -ForegroundColor Green }
Set-Location ..

Write-Host ""
Write-Host "==> Setup complete!" -ForegroundColor Green
Write-Host "    Edit .env to set your real DATABASE_URL and JWT_SECRET_KEY"
Write-Host "    Start backend: backend\venv\Scripts\uvicorn.exe app.main:app --reload --app-dir backend"
