# run_me.ps1 - ALL terminal commands for the attendance tracker project
# Execute from the project root: d:\ML\attendance_tracker\
# Run in PowerShell: .\run_me.ps1

Set-Location -Path $PSScriptRoot

# ============================================================
# PHASE 1 - Database Foundation
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================

# Step 1: Install psycopg2-binary for Alembic sync migrations
Write-Host "==> [1/6] Installing psycopg2-binary..." -ForegroundColor Cyan
& ".\backend\venv\Scripts\pip.exe" install psycopg2-binary
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: pip install psycopg2-binary failed" -ForegroundColor Red; exit 1 }
Write-Host "OK" -ForegroundColor Green

# Step 2: Create the attendance_db database (ignore error if it already exists)
Write-Host "==> [2/6] Creating attendance_db database..." -ForegroundColor Cyan
psql -U postgres -c "CREATE DATABASE attendance_db;"
# Not checking LASTEXITCODE -- database may already exist
Write-Host "OK (or already exists)" -ForegroundColor Green

# Step 3: Enable pgvector extension
Write-Host "==> [3/6] Enabling pgvector extension..." -ForegroundColor Cyan
psql -U postgres -d attendance_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: pgvector extension failed - is pgvector installed in PostgreSQL?" -ForegroundColor Red; exit 1 }
Write-Host "OK" -ForegroundColor Green

# Step 4: (Skipped) Migrations already exist in the repository
Write-Host "==> [4/6] Migrations already exist, skipping autogenerate..." -ForegroundColor Cyan
Set-Location backend
& ".\venv\Scripts\activate.ps1"
Write-Host "OK" -ForegroundColor Green

# Step 5: Apply migration to database
Write-Host "==> [5/6] Applying migration (alembic upgrade head)..." -ForegroundColor Cyan
& ".\venv\Scripts\alembic.exe" upgrade head
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: alembic upgrade head failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Write-Host "OK" -ForegroundColor Green
Set-Location ..

# Step 6: Verify tables exist
Write-Host "==> [6/6] Verifying tables..." -ForegroundColor Cyan
psql -U postgres -d attendance_db -c "\dt"
Write-Host ""
Write-Host "==> Phase 1 complete!" -ForegroundColor Green
Write-Host "    You should see employees, attendance_logs, and alembic_version tables above."

# ============================================================
# PHASE 2 — Test AI Pipeline
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
# NOTE: First run downloads ~300MB InsightFace buffalo_l models. Be patient.

# Step 1: Activate venv and run pipeline test
Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE 2 - AI Pipeline Test" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Set-Location backend
& ".\venv\Scripts\activate.ps1"
& ".\venv\Scripts\python.exe" tests\test_pipeline.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: AI pipeline test failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Write-Host "Phase 2 complete!" -ForegroundColor Green
Set-Location ..

# ============================================================
# PHASE 3 — Check-in Endpoint + E2E Test
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
# IMPORTANT: Run these in TWO separate PowerShell terminals.
#
# Terminal 1 — start FastAPI (keep this running):
#   cd D:\ML\attendance_tracker\backend
#   .\venv\Scripts\activate
#   .\venv\Scripts\uvicorn.exe app.main:app --reload --port 8000
#
# Terminal 2 — run the E2E test (after server shows "Application startup complete"):
#   cd D:\ML\attendance_tracker
#   .\venv_test.ps1    <- or run the lines below manually

Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE 3 - E2E Check-in Test" -ForegroundColor Cyan
Write-Host "  NOTE: FastAPI must already be running at localhost:8000" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan

Set-Location backend
& ".\venv\Scripts\python.exe" tests\test_checkin.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: E2E test failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Write-Host "Phase 3 complete! Full pipeline verified." -ForegroundColor Green
Set-Location ..

# ============================================================
# PHASE 4 — Start Frontend (Next.js in Docker)
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================

Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE 4 - Frontend Docker Build + Start" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Step 1: Build and start all Docker services including frontend
Write-Host "==> Building and starting Docker services..." -ForegroundColor Cyan
docker compose up -d --build frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose up failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK - Frontend starting at http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "==> Phase 4 complete!" -ForegroundColor Green
Write-Host "    Open http://localhost:3000 in your browser"

# ============================================================
# PHASE 5 — Full System Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================

Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE 5 - Full System Check" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Step 1: Verify Docker services running
Write-Host "==> [1/5] Docker services:" -ForegroundColor Cyan
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# Step 2: FastAPI health check
Write-Host "`n==> [2/5] FastAPI health check:" -ForegroundColor Cyan
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -Method GET -TimeoutSec 5
    Write-Host "  Status: $($health.status) | Models loaded: $($health.models_loaded)" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: FastAPI not reachable at localhost:8000 - is it running?" -ForegroundColor Red
}

# Step 3: Verify pgvector
Write-Host "`n==> [3/5] pgvector extension:" -ForegroundColor Cyan
& "D:\sql\bin\psql.exe" -U postgres -d attendance_db -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"

# Step 4: Verify employee table schema
Write-Host "`n==> [4/5] Employee table schema:" -ForegroundColor Cyan
& "D:\sql\bin\psql.exe" -U postgres -d attendance_db -c "\d employees"

# Step 5: Run E2E test
Write-Host "`n==> [5/5] Running full E2E test:" -ForegroundColor Cyan
Write-Host "    (FastAPI must be running at localhost:8000)" -ForegroundColor Yellow
Set-Location backend
& ".\venv\Scripts\python.exe" tests\test_checkin.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: E2E test failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Write-Host "`n==> Phase 5 complete! System fully verified." -ForegroundColor Green
Set-Location ..

# ============================================================
# PHASE M1 - Backend Embedding API
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
# Step 1: Run AI pipeline tests
Set-Location backend
& ".\venv\Scripts\activate.ps1"
& ".\venv\Scripts\python.exe" tests\test_pipeline.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: AI pipeline test failed" -ForegroundColor Red; Set-Location ..; exit 1 }

# Step 2: Run End-to-End API check-in tests
& ".\venv\Scripts\python.exe" tests\test_checkin.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: E2E check-in test failed" -ForegroundColor Red; Set-Location ..; exit 1 }

# Step 3: Run Edge Vector Embedding check-in tests
& ".\venv\Scripts\python.exe" tests\test_embedding_checkin.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Embedding check-in test failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Write-Host "Phase M1 complete! All backend embedding API tests passed." -ForegroundColor Green
Set-Location ..

# ============================================================
# PHASE M1_CHALLENGER_2 - Adversarial Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location backend
& ".\venv\Scripts\activate.ps1"
& ".\venv\Scripts\python.exe" tests\verify_milestone1_adversarial.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger 2 adversarial verification failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Write-Host "Challenger 2 adversarial verification executed successfully." -ForegroundColor Green
Set-Location ..

# ============================================================
# PHASE M1_CHALLENGER_1 — Embedding Check-in Stress Test
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location backend
& ".\venv\Scripts\activate.ps1"
& ".\venv\Scripts\python.exe" tests\test_embedding_checkin_stress.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger 1 stress test failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Write-Host "Challenger 1 stress test executed successfully." -ForegroundColor Green

# ============================================================
# PHASE M2 — Edge AI Mobile Setup & Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================

# Step 1: Export/copy ONNX models to mobile/assets/models/
Write-Host "==> [1/4] Copying ONNX models to mobile/assets/models/..." -ForegroundColor Cyan
& ".\backend\venv\Scripts\python.exe" mobile\scripts\export_models.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Model export script failed" -ForegroundColor Red; exit 1 }

# Step 2: Install npm dependencies in mobile directory
Write-Host "==> [2/4] Installing npm dependencies in mobile/..." -ForegroundColor Cyan
Set-Location mobile
npm install
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: npm install failed in mobile" -ForegroundColor Red; Set-Location ..; exit 1 }

# Step 3: Run standalone Edge AI verification script
Write-Host "==> [3/4] Running standalone Edge AI verification script..." -ForegroundColor Cyan
npm run verify:ai
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Edge AI verification failed" -ForegroundColor Red; Set-Location ..; exit 1 }

# Step 4: Run Jest unit tests for mobile Edge AI modules
Write-Host "==> [4/4] Running Jest tests for mobile/src/ai/..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Mobile Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "==> Phase M2 Complete! Mobile Edge AI pipeline verified." -ForegroundColor Green

# ============================================================
# PHASE M2_CHALLENGER_1 — Edge AI Empirical Stress & Edge Case Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location mobile
Write-Host "==> Running Challenger M2-1 standalone verification script..." -ForegroundColor Cyan
npm run verify:challenger
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger M2-1 verification failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Write-Host "==> Running Challenger M2-1 Jest edge cases test suite..." -ForegroundColor Cyan
npx jest tests/ai/challenger_edge_cases.test.ts
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger M2-1 Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "Challenger M2-1 empirical verification executed successfully." -ForegroundColor Green

# ============================================================
# PHASE M2_CHALLENGER_2 — Milestone 2 Adversarial Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Write-Host "==> Running Challenger M2-2 adversarial verification script..." -ForegroundColor Cyan
& ".\backend\venv\Scripts\python.exe" backend\tests\verify_m2_adversarial.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger M2-2 adversarial verification failed" -ForegroundColor Red; exit 1 }

Write-Host "==> Running ONNX Model Export script..." -ForegroundColor Cyan
& ".\backend\venv\Scripts\python.exe" mobile\scripts\export_models.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: export_models.py execution failed" -ForegroundColor Red; exit 1 }

Write-Host "Challenger M2-2 adversarial verification executed successfully." -ForegroundColor Green

# ============================================================
# PHASE M3 — React Native App UI & Modes + Edge AI Fixes
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location mobile
Write-Host "==> Running Jest unit tests for Mobile UI components, screens, and Edge AI fixes..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Mobile UI Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "Phase M3 complete! React Native App UI & Modes verified." -ForegroundColor Green

# ============================================================
# PHASE M3_CHALLENGER_1 — Empirical Verification & Stress Test
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location mobile
Write-Host "==> Running Challenger M3-1 Jest stress test suite..." -ForegroundColor Cyan
npx jest tests/ai/challenger_m3_stress.test.tsx
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger M3-1 Jest stress tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "Challenger M3-1 empirical verification executed successfully." -ForegroundColor Green

# ============================================================
# PHASE M3_CHALLENGER_2 — React Native UI & Dashboard Stress Tests
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location mobile
Write-Host "==> Running Challenger M3-2 UI & Manager Dashboard edge cases test suite..." -ForegroundColor Cyan
npx jest tests/screens/ManagerDashboardScreen_challenger2.test.tsx tests/App.test.tsx
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger M3-2 Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "Challenger M3-2 empirical verification executed successfully." -ForegroundColor Green

# ============================================================
# PHASE M4 — Web Registration Portal & Quality Feedback Engine
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================

Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE M4 - Web Registration Portal & Quality Engine Verification" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

Set-Location frontend

# Step 1: Install frontend dev dependencies if needed (Jest, Testing Library, Types)
Write-Host "==> [1/4] Installing Jest & Testing Library dependencies in frontend/..." -ForegroundColor Cyan
npm install --save-dev jest @types/jest ts-jest @testing-library/react @testing-library/jest-dom @testing-library/user-event jest-environment-jsdom
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: npm install test dependencies failed in frontend" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Write-Host "OK" -ForegroundColor Green

# Step 2: Next.js TypeScript compilation & build verification
Write-Host "==> [2/4] Verifying Next.js TypeScript compilation & build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Next.js build verification failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Write-Host "OK - Next.js build succeeded" -ForegroundColor Green

# Step 3: Run Frontend Jest Unit Tests
Write-Host "==> [3/4] Running Frontend Jest Unit Test Suite..." -ForegroundColor Cyan
npx jest --passWithNoTests
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Frontend Jest unit tests failed" -ForegroundColor Red
    Set-Location ..; exit 1
}
Write-Host "OK - All frontend unit tests passed" -ForegroundColor Green

# Step 4: Docker Container Rebuild Verification
Write-Host "==> [4/4] Rebuilding and starting frontend Docker container..." -ForegroundColor Cyan
Set-Location ..
docker compose up -d --build frontend
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose rebuild for frontend failed" -ForegroundColor Red
    exit 1
}

Write-Host "Phase M4 Complete! Web Registration Portal & Quality Engine fully verified." -ForegroundColor Green

# ============================================================
# PHASE M4_DOCKER_MOBILE_FIX — Rebuild Mobile Docker Container with @expo/ngrok
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE M4_DOCKER_MOBILE_FIX - Mobile Container Rebuild" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
docker compose up -d --build mobile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose rebuild for mobile failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK - Mobile container rebuilt successfully!" -ForegroundColor Green


# ============================================================
# PHASE M5_OPTIONAL_EMAIL_FIX — Verification of Email & Mobile Check-in
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE M5_OPTIONAL_EMAIL_FIX - Optional Email & Mobile Image Check-in" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Step 1: Run frontend jest tests
Set-Location frontend
Write-Host "==> [1/2] Running Frontend Jest Unit Tests..." -ForegroundColor Cyan
npx jest __tests__/RegisterForm.test.tsx --passWithNoTests
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Frontend Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

# Step 2: Run mobile jest tests
Set-Location mobile
Write-Host "==> [2/2] Running Mobile Jest Unit Tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Mobile Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

Write-Host "Phase M5_OPTIONAL_EMAIL_FIX complete!" -ForegroundColor Green


# ============================================================
# PHASE M5_E2E_VERIFICATION — Rebuild Services & Run E2E Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE M5_E2E_VERIFICATION - System Rebuild & E2E Check-in Test" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Step 1: Rebuild backend, frontend, and mobile Docker services
Write-Host "==> [1/2] Rebuilding Docker containers..." -ForegroundColor Cyan
docker compose up -d --build backend frontend mobile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: docker compose rebuild failed" -ForegroundColor Red
    exit 1
}
Write-Host "OK - All services updated and running." -ForegroundColor Green

# Step 2: Run End-to-End API check-in test
Write-Host "==> [2/2] Running E2E check-in test..." -ForegroundColor Cyan
Set-Location backend
& ".\venv\Scripts\activate.ps1"
& ".\venv\Scripts\python.exe" tests\test_checkin.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: E2E check-in test failed" -ForegroundColor Red
    Set-Location ..
    exit 1
}
Set-Location ..

Write-Host "==> All E2E checks passed! system is fully ready for testing." -ForegroundColor Green


# ============================================================
# PHASE M1_AUTH_SYSTEM — Milestone 1 Backend Enhancements & Auth System (R4)
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE M1_AUTH_SYSTEM - Milestone 1 Backend Enhancements & Auth" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Step 1: Install required dependencies
Write-Host "==> [1/4] Installing dependencies passlib and python-jose..." -ForegroundColor Cyan
& ".\backend\venv\Scripts\pip.exe" install passlib[bcrypt] python-jose[cryptography]
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: pip install failed" -ForegroundColor Red; exit 1 }

# Step 2: Bootstrap Super Admin account
Write-Host "==> [2/4] Bootstrapping Super Admin account..." -ForegroundColor Cyan
Set-Location backend
& ".\venv\Scripts\python.exe" manage.py create_superadmin --username admin --password admin123
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: manage.py create_superadmin failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

# Step 3: Run existing check-in tests
Write-Host "==> [3/4] Running baseline checkin tests..." -ForegroundColor Cyan
Set-Location backend
& ".\venv\Scripts\python.exe" tests\test_checkin.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: test_checkin.py failed" -ForegroundColor Red; Set-Location ..; exit 1 }
& ".\venv\Scripts\python.exe" tests\test_embedding_checkin.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: test_embedding_checkin.py failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

# Step 4: Run Auth & Management Test Suite
Write-Host "==> [4/4] Running Auth & Management Test Suite..." -ForegroundColor Cyan
Set-Location backend
& ".\venv\Scripts\python.exe" tests\test_auth_and_management.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: test_auth_and_management.py failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

Write-Host "==> Phase M1_AUTH_SYSTEM complete! All tests passed successfully." -ForegroundColor Green


# ============================================================
# PHASE M1_AUTH_ADVERSARIAL — Milestone 1 Auth & Registration Adversarial Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE M1_AUTH_ADVERSARIAL - Milestone 1 Auth Security Verification" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

Set-Location backend
& ".\venv\Scripts\activate.ps1"
& ".\venv\Scripts\python.exe" tests\test_m1_auth_adversarial.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: test_m1_auth_adversarial.py failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

Write-Host "==> Phase M1_AUTH_ADVERSARIAL complete! All adversarial security tests passed." -ForegroundColor Green


# ============================================================
# PHASE M2_REVIEWER_1 — Milestone 2 Web Registration Portal Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Write-Host "" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHASE M2_REVIEWER_1 - Web Registration Portal Review Verification" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

Set-Location frontend
Write-Host "==> [1/2] Verifying Next.js TypeScript compilation & build..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Next.js build failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Write-Host "==> [2/2] Running Frontend Jest Unit Tests for RegisterPage, EmployeeForm & LiveCameraFeed..." -ForegroundColor Cyan
npx jest __tests__/RegisterPage.test.tsx __tests__/RegisterForm.test.tsx __tests__/LiveCameraFeed.test.tsx --passWithNoTests
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Frontend Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "==> Phase M2_REVIEWER_1 complete! Web Registration Portal verified." -ForegroundColor Green


# ============================================================
# PHASE M3_THREE_SCREEN_MOBILE — Three-Screen Mobile App & EAS Build Config Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location mobile
Write-Host "==> Running Jest unit tests for Mobile UI components, screens, and EAS build config..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Mobile UI Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "Phase M3_THREE_SCREEN_MOBILE complete! Three-screen mobile app & EAS build config verified." -ForegroundColor Green


# ============================================================
# PHASE M3_WORKER_FIX — Milestone 3 Remediation Fixes Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location mobile
Write-Host "==> Running Jest unit tests for Mobile components and screens..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Mobile UI Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }

Set-Location ..
Write-Host "Phase M3_WORKER_FIX complete! Remediation fixes verified." -ForegroundColor Green


# ============================================================
# PHASE M4_CHALLENGER_1 — Security, Authentication & Role Protection Verification
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location backend
& ".\venv\Scripts\activate.ps1"
& ".\venv\Scripts\python.exe" tests\test_m4_empirical_challenger.py
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Challenger M4_1 verification failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

Set-Location frontend
Write-Host "==> Running Frontend Jest Unit Tests for RegisterPage..." -ForegroundColor Cyan
npx jest __tests__/RegisterPage.test.tsx --passWithNoTests
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Frontend Jest tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

Write-Host "Challenger M4_1 empirical verification executed successfully." -ForegroundColor Green

# ============================================================
# PHASE M4_WORKER_FIX — Frontend Empirical Workflows & Mobile Verification Fixes
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
Set-Location frontend
Write-Host "==> Running Frontend Jest tests..." -ForegroundColor Cyan
npx jest
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Frontend Jest unit tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

Set-Location mobile
Write-Host "==> Running Mobile Jest tests..." -ForegroundColor Cyan
npm test
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR: Mobile Jest unit tests failed" -ForegroundColor Red; Set-Location ..; exit 1 }
Set-Location ..

Write-Host "Phase M4_WORKER_FIX complete! Frontend and Mobile test suites verified 100%." -ForegroundColor Green
