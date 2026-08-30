"""
Test suite for Authentication, Web Registration, User Role Management, Attendance Summary, and Employee Leave Balance.

Run from backend/ directory:
    python tests/test_auth_and_management.py
"""

import sys
import json
import asyncio
import uuid
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

import requests
from fastapi.testclient import TestClient

from app.main import app
from app.core.database import create_all_tables, engine
from manage import create_superadmin

BASE_URL = "http://localhost:8000"


class UnifiedClient:
    """HTTP client that tries live server at http://localhost:8000 first, falling back to TestClient(app)."""

    def __init__(self):
        self.test_client = TestClient(app)
        self.use_live = False
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=2)
            if r.status_code == 200:
                self.use_live = True
                print("  [Client] Connected to live server at http://localhost:8000")
        except Exception:
            print("  [Client] Live server not reachable; using in-process TestClient")

    def request(self, method: str, path: str, **kwargs):
        headers = kwargs.get("headers", {})
        json_data = kwargs.get("json", None)
        params = kwargs.get("params", None)

        if self.use_live:
            url = f"{BASE_URL}{path}"
            resp = requests.request(method, url, headers=headers, json=json_data, params=params, timeout=10)
            class ResponseWrapper:
                def __init__(self, r):
                    self.status_code = r.status_code
                    self._r = r
                def json(self):
                    return self._r.json()
            return ResponseWrapper(resp)
        else:
            tc_method = getattr(self.test_client, method.lower())
            kwargs_tc = {}
            if headers:
                kwargs_tc["headers"] = headers
            if json_data is not None:
                kwargs_tc["json"] = json_data
            if params is not None:
                kwargs_tc["params"] = params
            resp = tc_method(path, **kwargs_tc)
            return resp

    def get(self, path: str, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs):
        return self.request("POST", path, **kwargs)

    def patch(self, path: str, **kwargs):
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs):
        return self.request("DELETE", path, **kwargs)


def pp(label: str, data: dict):
    print(f"\n{'─'*50}")
    print(f"  {label}")
    print(f"{'─'*50}")
    print(json.dumps(data, indent=2))


async def setup_database():
    """Single async setup call to avoid event loop / connection pool conflicts."""
    await create_all_tables()
    await create_superadmin("admin", "admin123", create_tables=False)
    await engine.dispose()


def test_full_auth_and_management_flow():
    print("=" * 60)
    print("  MILESTONE 1: AUTH & MANAGEMENT TEST SUITE")
    print("=" * 60)

    # 0. Ensure tables exist & superadmin exists in a single asyncio run
    print("\n[0/10] Initializing DB tables & superadmin user...")
    asyncio.run(setup_database())
    print("  [OK] DB tables & superadmin created")

    client = UnifiedClient()

    # 1. Health check
    print("\n[1/10] Health check...")
    resp = client.get("/health")
    assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
    print("  [OK] Health check passed")

    # 2. Login as Super Admin
    print("\n[2/10] Logging in as Super Admin...")
    login_resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    pp("POST /api/auth/login", login_resp.json())
    assert login_resp.status_code == 200, f"Login failed: {login_resp.json()}"
    login_data = login_resp.json()
    assert "access_token" in login_data
    assert login_data["role"] == "super_admin"
    admin_token = login_data["access_token"]
    admin_user_id = login_data["user_id"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    print("  [OK] Super Admin logged in successfully")

    # 3. Create Web Registration Token (Admin Only)
    print("\n[3/10] Generating web registration token...")
    reg_tok_resp = client.post("/api/registration/token", json={"expires_in_hours": 24}, headers=admin_headers)
    pp("POST /api/registration/token", reg_tok_resp.json())
    assert reg_tok_resp.status_code == 200, f"Failed: {reg_tok_resp.json()}"
    token_data = reg_tok_resp.json()
    reg_token = token_data["token"]
    assert "registration_url" in token_data
    print("  [OK] Registration token generated")

    # 4. Validate Registration Token (Public)
    print("\n[4/10] Validating registration token...")
    val_resp = client.get(f"/api/registration/validate?token={reg_token}")
    pp("GET /api/registration/validate", val_resp.json())
    assert val_resp.status_code == 200
    assert val_resp.json()["valid"] is True
    print("  [OK] Registration token is valid")

    # 5. Create Test Employee & Register Employee User Account
    print("\n[5/10] Creating employee record & registering user account...")
    unique_suffix = uuid.uuid4().hex[:6]
    emp_username = f"jane_emp_{unique_suffix}"
    emp_email = f"jane.emp.{unique_suffix}@example.com"

    # Verify unauthenticated POST /api/employees and DELETE /api/employees fail with 401
    unauth_create = client.post("/api/employees", json={"name": "Unauth Employee"})
    assert unauth_create.status_code == 401, f"Expected 401, got {unauth_create.status_code}"
    unauth_delete = client.delete(f"/api/employees/{uuid.uuid4()}")
    assert unauth_delete.status_code == 401, f"Expected 401, got {unauth_delete.status_code}"

    emp_resp = client.post("/api/employees", json={
        "name": "Jane Employee",
        "email": emp_email,
        "department": "HR",
        "job_title": "HR Specialist"
    }, headers=admin_headers)
    assert emp_resp.status_code == 201, f"Failed to create employee: {emp_resp.json()}"
    emp_id = emp_resp.json()["id"]

    reg_user_resp = client.post("/api/auth/register", json={
        "username": emp_username,
        "password": "emp_password_123",
        "employee_id": emp_id,
        "registration_token": reg_token
    })
    pp("POST /api/auth/register", reg_user_resp.json())
    assert reg_user_resp.status_code == 201, f"Failed: {reg_user_resp.json()}"
    new_user_id = reg_user_resp.json()["user_id"]
    print("  [OK] Employee user registered")

    # Re-validate registration token (should now be invalid / used)
    reval_resp = client.get(f"/api/registration/validate?token={reg_token}")
    assert reval_resp.json()["valid"] is False
    print("  [OK] Used registration token correctly invalidated")

    # 6. Login as new employee user
    print("\n[6/10] Logging in as employee user...")
    emp_login_resp = client.post("/api/auth/login", json={"username": emp_username, "password": "emp_password_123"})
    assert emp_login_resp.status_code == 200, f"Failed: {emp_login_resp.json()}"
    emp_token = emp_login_resp.json()["access_token"]
    emp_headers = {"Authorization": f"Bearer {emp_token}"}
    print("  [OK] Employee user login successful")

    # 7. Employee Leave Balance Adjustment (Admin Only)
    print("\n[7/10] Adjusting employee leave balance...")
    # Employee token should fail with 403 Forbidden
    unauth_leave = client.patch(f"/api/employees/{emp_id}/leave", json={"action": "add", "amount": 5.0}, headers=emp_headers)
    assert unauth_leave.status_code == 403, f"Expected 403 for employee role, got {unauth_leave.status_code}"

    # Admin token should succeed
    leave_set = client.patch(f"/api/employees/{emp_id}/leave", json={"action": "set", "amount": 20.0}, headers=admin_headers)
    assert leave_set.status_code == 200, f"Failed: {leave_set.json()}"
    assert leave_set.json()["new_leave_balance"] == 20.0

    leave_add = client.patch(f"/api/employees/{emp_id}/leave", json={"action": "add", "amount": 5.0}, headers=admin_headers)
    assert leave_add.status_code == 200, f"Failed: {leave_add.json()}"
    assert leave_add.json()["new_leave_balance"] == 25.0

    leave_deduct = client.patch(f"/api/employees/{emp_id}/leave", json={"action": "deduct", "amount": 3.0}, headers=admin_headers)
    assert leave_deduct.status_code == 200, f"Failed: {leave_deduct.json()}"
    assert leave_deduct.json()["new_leave_balance"] == 22.0
    print("  [OK] Leave balance adjustments verified")

    # 8. Employee Attendance Stats & Logs
    print("\n[8/10] Fetching employee attendance stats...")
    att_stats_resp = client.get(f"/api/employees/{emp_id}/attendance")
    pp("GET /api/employees/{id}/attendance", att_stats_resp.json())
    assert att_stats_resp.status_code == 200
    att_data = att_stats_resp.json()
    assert att_data["leave_balance"] == 22.0
    assert "present_days" in att_data
    assert "late_count" in att_data
    print("  [OK] Employee attendance stats verified")

    # 9. Attendance Summary Report
    print("\n[9/10] Fetching attendance summary report...")
    summary_resp = client.get("/api/attendance/summary")
    pp("GET /api/attendance/summary", summary_resp.json())
    assert summary_resp.status_code == 200
    sum_data = summary_resp.json()
    assert "total_employees" in sum_data
    assert "present_count" in sum_data
    assert "absent_count" in sum_data
    assert "late_count" in sum_data
    assert "departments" in sum_data
    print("  [OK] Attendance summary report verified")

    # 10. User Role Promotion & Management
    print("\n[10/10] Testing User Role Promotion & Constraints...")
    # List users (Admin only)
    users_list_resp = client.get("/api/users", headers=admin_headers)
    assert users_list_resp.status_code == 200, f"Failed: {users_list_resp.json()}"
    assert len(users_list_resp.json()) >= 2
    print("  [OK] Listed registered users")

    # Promote employee user to admin
    role_promote_resp = client.patch(f"/api/users/{new_user_id}/role", json={"role": "admin"}, headers=admin_headers)
    pp("PATCH /api/users/{id}/role (promote to admin)", role_promote_resp.json())
    assert role_promote_resp.status_code == 200, f"Failed: {role_promote_resp.json()}"
    assert role_promote_resp.json()["role"] == "admin"
    print("  [OK] User role promoted to admin")

    # Prevent Super Admin self-demotion
    self_demote_resp = client.patch(f"/api/users/{admin_user_id}/role", json={"role": "employee"}, headers=admin_headers)
    assert self_demote_resp.status_code == 400
    print("  [OK] Super Admin self-demotion correctly prevented")

    print("\n" + "=" * 60)
    print("  MILESTONE 1 AUTH & MANAGEMENT TEST SUITE PASSED [OK]")
    print("=" * 60)


if __name__ == "__main__":
    test_full_auth_and_management_flow()
