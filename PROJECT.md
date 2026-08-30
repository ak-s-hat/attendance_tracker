# Project: Attendance Tracker Production V2

## Architecture
- **Mobile App**: React Native (Expo SDK 54) in `mobile/` configured for EAS Cloud APK build (`eas.json`). Features three screens: Login (JWT auth + role routing), Kiosk Camera (silent frame capture, bounding boxes, auto-reset confirmation banner), and Admin Dashboard (today's summary, department breakdown, per-employee attendance/leave table, leave adjustment, late entry tracking against `work_start_time`, web registration link generation, super admin role promotion/demotion). Modern premium dark-mode UI.
- **Backend**: FastAPI app in `backend/` with async SQLAlchemy, pgvector PostgreSQL, Redis, MinIO. Enhanced with `User` model, JWT authentication (`POST /api/auth/login`, `POST /api/auth/register`), leave balance management, late entry tracking, registration token generation & validation, department summary API, and super admin CLI script (`python manage.py create_superadmin`).
- **Web Portal**: Next.js 14 frontend in `frontend/` with token-validated employee registration (`/register?token=<token>`), real-time quality feedback camera feed, and optional fields (name required; email, phone, department, job title optional).

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Backend Enhancements & Auth System | User model, JWT login/register, leave balance API, late entry stats, registration token endpoints, department summary API, super admin CLI script | none | DONE |
| 2 | Admin-Triggered Web Registration Portal | Token validation, optional fields, dark-mode registration portal with real-time camera quality check | M1 | IN_PROGRESS |
| 3 | Three-Screen Mobile App & EAS Build Config | EAS Cloud APK config, Login screen (role routing), Kiosk camera (silent capture, auto-reset banner), Admin Dashboard (summary, leave mgmt, late stats, share link, role promo/demo), premium dark-mode UI | M1, M2 | PLANNED |
| 4 | E2E Verification & Sentinel Handoff | E2E integration test suite, verification of tests, forensic audit, final report to Sentinel | M1, M2, M3 | PLANNED |

## Interface Contracts
### Auth API (`backend/app/api/auth.py`)
- `POST /api/auth/login`
  - Request: `{ "username": "...", "password": "..." }`
  - Response: `{ "access_token": "...", "token_type": "bearer", "role": "super_admin"|"admin"|"employee", "user_id": "...", "employee_id": "..." }`
- `POST /api/auth/register`
  - Request: `{ "username": "...", "password": "...", "employee_id": "..." }`
  - Response: `{ "message": "User registered successfully", "user_id": "..." }`

### Registration Token API (`backend/app/api/registration.py`)
- `POST /api/registration/token` (Admin only)
  - Request: `{ "expires_in_hours": 24 }`
  - Response: `{ "token": "...", "registration_url": "http://<host>/register?token=...", "expires_at": "..." }`
- `GET /api/registration/validate?token=...`
  - Response: `{ "valid": bool, "expires_at": "...", "message": "..." }`

### Leave & Employee API (`backend/app/api/employees.py`)
- `GET /api/employees/{id}/attendance`
  - Response: `{ "employee_id": "...", "name": "...", "leave_balance": float, "present_days": int, "late_count": int, "logs": [...] }`
- `PATCH /api/employees/{id}/leave` (Admin only)
  - Request: `{ "action": "add"|"deduct"|"set", "amount": float }`
  - Response: `{ "employee_id": "...", "new_leave_balance": float }`

### Attendance Summary API (`backend/app/api/attendance.py`)
- `GET /api/attendance/summary?date=YYYY-MM-DD`
  - Response: `{ "date": "...", "total_employees": int, "present_count": int, "absent_count": int, "late_count": int, "departments": { "Engineering": { "present": 10, "absent": 2, "late": 1 } } }`

### User Role Management API (`backend/app/api/users.py`)
- `PATCH /api/users/{id}/role` (Super Admin only)
  - Request: `{ "role": "admin"|"employee" }`
  - Response: `{ "user_id": "...", "role": "..." }`
- `GET /api/users` (Admin/Super Admin only)
  - Response: `[ { "id": "...", "username": "...", "role": "...", "employee_id": "..." } ]`

## Code Layout
- `backend/app/models/user.py` — SQLAlchemy model for User and RegistrationToken
- `backend/app/models/employee.py` — Extended Employee model with `leave_balance`, `work_start_time`
- `backend/app/api/auth.py` — Authentication endpoints
- `backend/app/api/registration.py` — Token creation & validation endpoints
- `backend/app/api/users.py` — User role management endpoints
- `backend/manage.py` — CLI script for `create_superadmin`
- `frontend/app/register/page.tsx` — Token-validated web registration page
- `mobile/eas.json` — Expo Application Services build config for Android standalone APK
- `mobile/src/screens/LoginScreen.tsx` — Login screen
- `mobile/src/screens/KioskScreen.tsx` — Silent camera kiosk screen
- `mobile/src/screens/AdminDashboardScreen.tsx` — Admin dashboard screen
