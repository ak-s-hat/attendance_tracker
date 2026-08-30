"""
Adversarial security verification test suite for Milestone 1 Auth & Registration.

Run from backend/ directory:
    python tests/test_m1_auth_adversarial.py
"""

import sys
import json
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Fix Windows console UTF-8 output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from jose import jwt

from app.main import app
from app.core.config import settings
from app.core.database import create_all_tables, engine, AsyncSessionLocal
from app.core.security import create_access_token, get_password_hash
from app.models.user import User, RegistrationToken
from manage import create_superadmin


def run_adversarial_security_tests():
    print("=" * 70)
    print("  EMPIRICAL ADVERSARIAL VERIFICATION: MILESTONE 1 AUTH & REGISTRATION")
    print("=" * 70)

    # Step 0: Database setup
    print("\n[0/5] Setting up database & seeding users...")
    async def setup_db():
        await create_all_tables()
        await create_superadmin("superadmin_test", "superpass123", create_tables=False)
        
        async with AsyncSessionLocal() as session:
            # Seed admin user
            admin_user = User(
                username="admin_test",
                password_hash=get_password_hash("adminpass123"),
                role="admin",
                is_active=True
            )
            # Seed normal employee user
            emp_user = User(
                username="emp_test",
                password_hash=get_password_hash("emppass123"),
                role="employee",
                is_active=True
            )
            session.add_all([admin_user, emp_user])
            await session.commit()
            
            # Fetch user IDs for token generation
            res_admin = await session.execute(User.__table__.select().where(User.username == "admin_test"))
            admin_row = res_admin.fetchone()
            admin_id = admin_row.id
            
            res_emp = await session.execute(User.__table__.select().where(User.username == "emp_test"))
            emp_row = res_emp.fetchone()
            emp_id = emp_row.id

            res_super = await session.execute(User.__table__.select().where(User.username == "superadmin_test"))
            super_row = res_super.fetchone()
            super_id = super_row.id
            
            return str(super_id), str(admin_id), str(emp_id)

    super_id, admin_id, emp_id = asyncio.run(setup_db())
    print(f"  [OK] DB initialized. SuperAdmin ID: {super_id}, Admin ID: {admin_id}, Emp ID: {emp_id}")

    client = TestClient(app)

    # -------------------------------------------------------------------------
    # Test Group 1: Authentication Requirements
    # -------------------------------------------------------------------------
    print("\n[1/5] Testing Authentication Requirements...")
    
    # 1.1 Bad password returns 401
    resp = client.post("/api/auth/login", json={"username": "emp_test", "password": "wrongpassword"})
    print(f"  1.1 Bad password -> HTTP {resp.status_code} (expected 401)")
    assert resp.status_code == 401, f"Expected 401 for bad password, got {resp.status_code}"
    
    # 1.2 Non-existent username returns 401
    resp = client.post("/api/auth/login", json={"username": "non_existent_user_999", "password": "emppass123"})
    print(f"  1.2 Non-existent username -> HTTP {resp.status_code} (expected 401)")
    assert resp.status_code == 401, f"Expected 401 for non-existent user, got {resp.status_code}"

    # 1.3 Expired JWT token returns 401
    expired_token = create_access_token(
        data={"sub": emp_id, "username": "emp_test", "role": "employee"},
        expires_delta=timedelta(seconds=-10)  # expired 10 seconds ago
    )
    resp = client.get("/api/users", headers={"Authorization": f"Bearer {expired_token}"})
    print(f"  1.3 Expired JWT token -> HTTP {resp.status_code} (expected 401)")
    assert resp.status_code == 401, f"Expected 401 for expired token, got {resp.status_code}"

    # 1.4 Forged JWT token (wrong secret key) returns 401
    forged_token = jwt.encode(
        {"sub": emp_id, "username": "emp_test", "role": "admin", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
        "fake-secret-key-12345",
        algorithm=settings.JWT_ALGORITHM
    )
    resp = client.get("/api/users", headers={"Authorization": f"Bearer {forged_token}"})
    print(f"  1.4 Forged JWT token -> HTTP {resp.status_code} (expected 401)")
    assert resp.status_code == 401, f"Expected 401 for forged token, got {resp.status_code}"

    # 1.5 Valid login succeeds and produces valid JWT
    login_resp = client.post("/api/auth/login", json={"username": "emp_test", "password": "emppass123"})
    print(f"  1.5 Valid login -> HTTP {login_resp.status_code} (expected 200)")
    assert login_resp.status_code == 200
    emp_token = login_resp.json()["access_token"]

    login_admin = client.post("/api/auth/login", json={"username": "admin_test", "password": "adminpass123"})
    assert login_admin.status_code == 200
    admin_token = login_admin.json()["access_token"]

    login_super = client.post("/api/auth/login", json={"username": "superadmin_test", "password": "superpass123"})
    assert login_super.status_code == 200
    super_token = login_super.json()["access_token"]

    print("  [PASS] All Authentication requirements verified.")

    # -------------------------------------------------------------------------
    # Test Group 2: Authorization Requirements
    # -------------------------------------------------------------------------
    print("\n[2/5] Testing Authorization Requirements...")

    # 2.1 Non-admin user calling /api/registration/token gets 403
    resp = client.post("/api/registration/token", json={"expires_in_hours": 24}, headers={"Authorization": f"Bearer {emp_token}"})
    print(f"  2.1 Non-admin calling /api/registration/token -> HTTP {resp.status_code} (expected 403)")
    assert resp.status_code == 403, f"Expected 403 for employee on registration token endpoint, got {resp.status_code}"

    # 2.2 Non-admin user calling /api/employees/{id}/leave gets 403
    resp = client.patch(f"/api/employees/{emp_id}/leave", json={"action": "add", "amount": 5.0}, headers={"Authorization": f"Bearer {emp_token}"})
    print(f"  2.2 Non-admin calling /api/employees/{{id}}/leave -> HTTP {resp.status_code} (expected 403)")
    assert resp.status_code == 403, f"Expected 403 for employee on leave balance endpoint, got {resp.status_code}"

    # 2.3 Admin calling /api/registration/token succeeds (200)
    resp = client.post("/api/registration/token", json={"expires_in_hours": 24}, headers={"Authorization": f"Bearer {admin_token}"})
    print(f"  2.3 Admin calling /api/registration/token -> HTTP {resp.status_code} (expected 200)")
    assert resp.status_code == 200

    # 2.4 Non-super_admin (employee role) calling /api/users/{id}/role gets 403
    resp = client.patch(f"/api/users/{emp_id}/role", json={"role": "admin"}, headers={"Authorization": f"Bearer {emp_token}"})
    print(f"  2.4 Employee calling /api/users/{{id}}/role -> HTTP {resp.status_code} (expected 403)")
    assert resp.status_code == 403, f"Expected 403 for employee role change, got {resp.status_code}"

    # 2.5 Non-super_admin (admin role) calling /api/users/{id}/role gets 403
    resp = client.patch(f"/api/users/{emp_id}/role", json={"role": "admin"}, headers={"Authorization": f"Bearer {admin_token}"})
    print(f"  2.5 Admin (non-super_admin) calling /api/users/{{id}}/role -> HTTP {resp.status_code} (expected 403)")
    assert resp.status_code == 403, f"Expected 403 for admin role change (requires super_admin), got {resp.status_code}"

    # 2.6 Super_admin calling /api/users/{id}/role succeeds (200)
    resp = client.patch(f"/api/users/{emp_id}/role", json={"role": "admin"}, headers={"Authorization": f"Bearer {super_token}"})
    print(f"  2.6 Super_admin calling /api/users/{{id}}/role -> HTTP {resp.status_code} (expected 200)")
    assert resp.status_code == 200, f"Expected 200 for super_admin role change, got {resp.status_code}"

    print("  [PASS] All Authorization requirements verified.")

    # -------------------------------------------------------------------------
    # Test Group 3: Registration Tokens Requirements
    # -------------------------------------------------------------------------
    print("\n[3/5] Testing Registration Tokens Requirements...")

    # Generate a fresh registration token via Admin endpoint
    tok_resp = client.post("/api/registration/token", json={"expires_in_hours": 24}, headers={"Authorization": f"Bearer {admin_token}"})
    assert tok_resp.status_code == 200
    raw_token = tok_resp.json()["token"]

    # 3.1 Initial validation of fresh token succeeds
    val_resp = client.get(f"/api/registration/validate?token={raw_token}")
    print(f"  3.1 Fresh token validation -> valid={val_resp.json().get('valid')} (expected True)")
    assert val_resp.status_code == 200
    assert val_resp.json()["valid"] is True

    # 3.2 Single-use invalidation: Register new user with token
    reg_resp = client.post("/api/auth/register", json={
        "username": "new_registered_user_1",
        "password": "newpassword123",
        "registration_token": raw_token
    })
    print(f"  3.2 Registration with fresh token -> HTTP {reg_resp.status_code} (expected 201)")
    assert reg_resp.status_code == 201

    # 3.3 Single-use invalidation: Validation after token is used returns valid=False
    val_used_resp = client.get(f"/api/registration/validate?token={raw_token}")
    print(f"  3.3 Validation of used token -> valid={val_used_resp.json().get('valid')} (expected False)")
    assert val_used_resp.status_code == 200
    assert val_used_resp.json()["valid"] is False
    assert "already been used" in val_used_resp.json()["message"].lower()

    # 3.4 Single-use invalidation: Second registration attempt with used token fails (400)
    reg_used_resp = client.post("/api/auth/register", json={
        "username": "new_registered_user_2",
        "password": "newpassword123",
        "registration_token": raw_token
    })
    print(f"  3.4 Second registration attempt with used token -> HTTP {reg_used_resp.status_code} (expected 400)")
    assert reg_used_resp.status_code == 400, f"Expected 400 for used token registration, got {reg_used_resp.status_code}"

    # 3.5 Expired tokens fail validation & registration
    # Inject expired token directly into DB
    async def seed_expired_token():
        async with AsyncSessionLocal() as session:
            expired_reg_token = RegistrationToken(
                token="test_expired_token_99999",
                created_by_user_id=admin_id,
                expires_at=datetime.now(timezone.utc) - timedelta(hours=2),
                is_used=False
            )
            session.add(expired_reg_token)
            await session.commit()

    asyncio.run(seed_expired_token())

    # 3.5.1 Validation of expired token returns valid=False
    val_exp_resp = client.get("/api/registration/validate?token=test_expired_token_99999")
    print(f"  3.5.1 Validation of expired token -> valid={val_exp_resp.json().get('valid')} (expected False)")
    assert val_exp_resp.status_code == 200
    assert val_exp_resp.json()["valid"] is False
    assert "expired" in val_exp_resp.json()["message"].lower()

    # 3.5.2 Registration attempt with expired token fails (400)
    reg_exp_resp = client.post("/api/auth/register", json={
        "username": "new_registered_user_3",
        "password": "newpassword123",
        "registration_token": "test_expired_token_99999"
    })
    print(f"  3.5.2 Registration attempt with expired token -> HTTP {reg_exp_resp.status_code} (expected 400)")
    assert reg_exp_resp.status_code == 400, f"Expected 400 for expired token registration, got {reg_exp_resp.status_code}"

    print("  [PASS] All Registration Token requirements verified.")

    print("\n" + "=" * 70)
    print("  ALL EMPIRICAL ADVERSARIAL VERIFICATIONS PASSED [VERDICT: PASS]")
    print("=" * 70)


if __name__ == "__main__":
    run_adversarial_security_tests()
