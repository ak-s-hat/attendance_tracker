"""
Empirical verification test suite by Challenger_M4_1 for Security, Authentication, and Role Protection.

Tests:
1. JWT authentication (POST /api/auth/login) returns access tokens and user roles (super_admin, admin, employee).
2. Time-limited registration tokens (POST /api/registration/token) validated by GET /api/registration/validate, blocking missing/expired/used access.
3. Super admin role management (PATCH /api/users/{id}/role) prevents self-demotion and protects administrative endpoints.

Run from backend directory:
    python tests/test_m4_empirical_challenger.py
"""

import sys
import json
import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from jose import jwt

from app.main import app
from app.core.config import settings
from app.core.database import create_all_tables, engine, AsyncSessionLocal
from app.core.security import create_access_token, get_password_hash, decode_access_token
from app.models.user import User, RegistrationToken
from app.models.employee import Employee
from manage import create_superadmin


def run_empirical_challenger_verification():
    print("======================================================================")
    print("  EMPIRICAL CHALLENGER (M4_1) SECURITY & AUTH VERIFICATION")
    print("======================================================================")

    # -------------------------------------------------------------------------
    # Setup Database & Test Accounts
    # -------------------------------------------------------------------------
    print("\n[SETUP] Initializing database & seeding role test accounts...")

    async def setup_db():
        await create_all_tables()
        
        # Seed Super Admin, Admin, and Employee
        async with AsyncSessionLocal() as session:
            # Cleanup old test users if present
            for uname in ["c_superadmin", "c_admin", "c_employee", "c_target_emp"]:
                stmt = User.__table__.select().where(User.username == uname)
                res = await session.execute(stmt)
                existing = res.fetchone()
                if existing:
                    user_obj = await session.get(User, existing.id)
                    await session.delete(user_obj)
            await session.commit()

            # Create Super Admin
            super_user = User(
                username="c_superadmin",
                password_hash=get_password_hash("super_pass_123"),
                role="super_admin",
                is_active=True,
            )
            # Create Admin
            admin_user = User(
                username="c_admin",
                password_hash=get_password_hash("admin_pass_123"),
                role="admin",
                is_active=True,
            )
            # Create Employee User
            emp_user = User(
                username="c_employee",
                password_hash=get_password_hash("emp_pass_123"),
                role="employee",
                is_active=True,
            )
            session.add_all([super_user, admin_user, emp_user])
            await session.commit()
            await session.refresh(super_user)
            await session.refresh(admin_user)
            await session.refresh(emp_user)

            return str(super_user.id), str(admin_user.id), str(emp_user.id)

    super_id, admin_id, emp_id = asyncio.run(setup_db())
    print(f"  [OK] Accounts created: super_admin ({super_id}), admin ({admin_id}), employee ({emp_id})")

    client = TestClient(app)

    # -------------------------------------------------------------------------
    # Requirement 1: JWT Authentication (POST /api/auth/login)
    # -------------------------------------------------------------------------
    print("\n[REQ 1] Verifying JWT Authentication (POST /api/auth/login)...")

    # 1.1 Super Admin Login
    res_super = client.post("/api/auth/login", json={"username": "c_superadmin", "password": "super_pass_123"})
    assert res_super.status_code == 200, f"Super admin login failed: {res_super.json()}"
    body_super = res_super.json()
    assert "access_token" in body_super, "Missing access_token in response"
    assert body_super["token_type"] == "bearer", f"Unexpected token_type: {body_super['token_type']}"
    assert body_super["role"] == "super_admin", f"Expected super_admin role, got {body_super['role']}"
    assert body_super["user_id"] == super_id
    decoded_super = decode_access_token(body_super["access_token"])
    assert decoded_super["sub"] == super_id
    assert decoded_super["role"] == "super_admin"
    print("  1.1 Super Admin JWT login: PASSED (role='super_admin', valid JWT token issued)")

    # 1.2 Admin Login
    res_admin = client.post("/api/auth/login", json={"username": "c_admin", "password": "admin_pass_123"})
    assert res_admin.status_code == 200, f"Admin login failed: {res_admin.json()}"
    body_admin = res_admin.json()
    assert body_admin["role"] == "admin", f"Expected admin role, got {body_admin['role']}"
    assert body_admin["user_id"] == admin_id
    decoded_admin = decode_access_token(body_admin["access_token"])
    assert decoded_admin["sub"] == admin_id
    assert decoded_admin["role"] == "admin"
    print("  1.2 Admin JWT login: PASSED (role='admin', valid JWT token issued)")

    # 1.3 Employee Login
    res_emp = client.post("/api/auth/login", json={"username": "c_employee", "password": "emp_pass_123"})
    assert res_emp.status_code == 200, f"Employee login failed: {res_emp.json()}"
    body_emp = res_emp.json()
    assert body_emp["role"] == "employee", f"Expected employee role, got {body_emp['role']}"
    assert body_emp["user_id"] == emp_id
    decoded_emp = decode_access_token(body_emp["access_token"])
    assert decoded_emp["sub"] == emp_id
    assert decoded_emp["role"] == "employee"
    print("  1.3 Employee JWT login: PASSED (role='employee', valid JWT token issued)")

    # 1.4 Invalid Credentials
    res_invalid = client.post("/api/auth/login", json={"username": "c_employee", "password": "wrong_password"})
    assert res_invalid.status_code == 401, f"Expected 401 for invalid password, got {res_invalid.status_code}"
    print("  1.4 Invalid credentials handling: PASSED (401 Unauthorized)")

    super_token = body_super["access_token"]
    admin_token = body_admin["access_token"]
    emp_token = body_emp["access_token"]

    # -------------------------------------------------------------------------
    # Requirement 2: Time-Limited Registration Tokens
    # -------------------------------------------------------------------------
    print("\n[REQ 2] Verifying Registration Tokens & Validation...")

    # 2.1 Admin generates token
    token_gen_res = client.post(
        "/api/registration/token",
        json={"expires_in_hours": 24},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert token_gen_res.status_code == 200, f"Token generation failed: {token_gen_res.json()}"
    gen_data = token_gen_res.json()
    assert "token" in gen_data
    assert "registration_url" in gen_data
    assert "expires_at" in gen_data
    raw_token = gen_data["token"]
    print(f"  2.1 Token creation by Admin: PASSED (generated token={raw_token[:8]}...)")

    # 2.2 Validate fresh token via GET /api/registration/validate
    val_res = client.get(f"/api/registration/validate?token={raw_token}")
    assert val_res.status_code == 200
    assert val_res.json()["valid"] is True
    print("  2.2 Validation of fresh registration token: PASSED (valid=True)")

    # 2.3 Non-existent token validation
    val_missing = client.get("/api/registration/validate?token=non_existent_token_12345")
    assert val_missing.status_code == 200
    assert val_missing.json()["valid"] is False
    assert "not found" in val_missing.json()["message"].lower()
    print("  2.3 Validation of non-existent token: PASSED (valid=False, token not found)")

    # 2.4 Expired token validation & registration blocking
    async def create_expired_token():
        async with AsyncSessionLocal() as session:
            tok = RegistrationToken(
                token="test_expired_challenger_token",
                created_by_user_id=uuid.UUID(admin_id),
                expires_at=datetime.now(timezone.utc) - timedelta(hours=1),
                is_used=False,
            )
            session.add(tok)
            await session.commit()
    asyncio.run(create_expired_token())

    val_exp = client.get("/api/registration/validate?token=test_expired_challenger_token")
    assert val_exp.status_code == 200
    assert val_exp.json()["valid"] is False
    assert "expired" in val_exp.json()["message"].lower()
    print("  2.4 Validation of expired registration token: PASSED (valid=False, expired)")

    reg_exp_res = client.post("/api/auth/register", json={
        "username": "expired_token_user",
        "password": "password123",
        "registration_token": "test_expired_challenger_token"
    })
    assert reg_exp_res.status_code == 400, f"Expected 400 for registration with expired token, got {reg_exp_res.status_code}"
    print("  2.5 Registration attempt with expired token: PASSED (400 Bad Request)")

    # 2.6 Registration using valid token consumes token and invalidates future attempts
    reg_succ = client.post("/api/auth/register", json={
        "username": "valid_token_user",
        "password": "password123",
        "registration_token": raw_token
    })
    assert reg_succ.status_code == 201, f"Registration failed: {reg_succ.json()}"

    val_used = client.get(f"/api/registration/validate?token={raw_token}")
    assert val_used.status_code == 200
    assert val_used.json()["valid"] is False
    assert "already been used" in val_used.json()["message"].lower()
    print("  2.6 Token consumption & post-use validation: PASSED (valid=False, already been used)")

    # -------------------------------------------------------------------------
    # Requirement 3: Super Admin Role Management & Endpoint Protection
    # -------------------------------------------------------------------------
    print("\n[REQ 3] Verifying Super Admin Role Management & Administrative Protection...")

    # 3.1 Super admin self-demotion prevention
    self_demote = client.patch(
        f"/api/users/{super_id}/role",
        json={"role": "admin"},
        headers={"Authorization": f"Bearer {super_token}"}
    )
    assert self_demote.status_code == 400, f"Expected 400 for self-demotion, got {self_demote.status_code}"
    assert "cannot demote" in self_demote.json()["detail"].lower()
    print("  3.1 Super admin self-demotion prevention: PASSED (400 Super Admin cannot demote their own role)")

    # 3.2 Super admin updating another user's role
    role_change = client.patch(
        f"/api/users/{emp_id}/role",
        json={"role": "admin"},
        headers={"Authorization": f"Bearer {super_token}"}
    )
    assert role_change.status_code == 200, f"Role change failed: {role_change.json()}"
    assert role_change.json()["role"] == "admin"
    print("  3.2 Super admin role modification on another user: PASSED (role updated to admin)")

    # Restore employee role for testing
    client.patch(
        f"/api/users/{emp_id}/role",
        json={"role": "employee"},
        headers={"Authorization": f"Bearer {super_token}"}
    )

    # 3.3 Employee attempting role management fails (403)
    emp_role_change = client.patch(
        f"/api/users/{admin_id}/role",
        json={"role": "employee"},
        headers={"Authorization": f"Bearer {emp_token}"}
    )
    assert emp_role_change.status_code == 403, f"Expected 403 for employee role change, got {emp_role_change.status_code}"
    print("  3.3 Non-super-admin (employee) role modification: PASSED (403 Forbidden)")

    # 3.4 Admin (non-super-admin) attempting role management fails (403)
    admin_role_change = client.patch(
        f"/api/users/{emp_id}/role",
        json={"role": "admin"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert admin_role_change.status_code == 403, f"Expected 403 for admin role change, got {admin_role_change.status_code}"
    print("  3.4 Admin (non-super_admin) role modification: PASSED (403 Forbidden)")

    # 3.5 Administrative endpoint protection: GET /api/users
    unauth_users = client.get("/api/users")
    assert unauth_users.status_code == 401, f"Expected 401 for unauthenticated /api/users, got {unauth_users.status_code}"
    emp_users = client.get("/api/users", headers={"Authorization": f"Bearer {emp_token}"})
    assert emp_users.status_code == 403, f"Expected 403 for employee on /api/users, got {emp_users.status_code}"
    admin_users = client.get("/api/users", headers={"Authorization": f"Bearer {admin_token}"})
    assert admin_users.status_code == 200, f"Expected 200 for admin on /api/users, got {admin_users.status_code}"
    print("  3.5 Administrative endpoint protection (/api/users): PASSED (unauthenticated=401, employee=403, admin=200)")

    print("\n======================================================================")
    print("  ALL EMPIRICAL CHALLENGER VERIFICATION CHECKS PASSED [VERDICT: PASS]")
    print("======================================================================")


if __name__ == "__main__":
    run_empirical_challenger_verification()
