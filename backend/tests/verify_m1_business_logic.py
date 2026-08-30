"""
Empirical Verification Test Suite for Milestone 1 Business Logic.
Focuses on:
1. Late Entry calculation (08:55 present vs 09:15 late based on work_start_time)
2. Leave Balance (add, deduct, set, negative balances)
3. Department Summary (grouping present, absent, late counts per dept)
4. User Role Promotion & Super Admin self-demotion block
"""

import sys
import uuid
import json
import asyncio
from datetime import datetime, timezone, time as time_type
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from sqlalchemy import select
from app.main import app
from app.core.database import create_all_tables, engine, AsyncSessionLocal
from app.models.employee import Employee
from app.models.attendance_log import AttendanceLog
from app.models.user import User
from manage import create_superadmin


results = {
    "late_entry": {"status": "UNKNOWN", "details": []},
    "leave_balance": {"status": "UNKNOWN", "details": []},
    "dept_summary": {"status": "UNKNOWN", "details": []},
    "role_promotion": {"status": "UNKNOWN", "details": []},
}


def log_test(category: str, test_name: str, passed: bool, message: str):
    status_str = "PASS" if passed else "FAIL"
    entry = f"[{status_str}] {test_name}: {message}"
    print(f"  {entry}")
    results[category]["details"].append(entry)


async def setup_db_and_admin():
    await create_all_tables()
    await create_superadmin("admin", "admin123", create_tables=False)
    await engine.dispose()


def run_empirical_tests():
    print("=" * 70)
    print("  EMPIRICAL VERIFICATION: MILESTONE 1 BUSINESS LOGIC")
    print("=" * 70)

    print("\n[0] Setting up database schema and Super Admin user...")
    asyncio.run(setup_db_and_admin())

    client = TestClient(app)

    # Login as Super Admin
    login_res = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert login_res.status_code == 200, f"Superadmin login failed: {login_res.text}"
    admin_token = login_res.json()["access_token"]
    superadmin_user_id = login_res.json()["user_id"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # =========================================================================
    # 1. LATE ENTRY CALCULATION
    # =========================================================================
    print("\n--- 1. LATE ENTRY CALCULATION TESTS ---")
    late_passed = True
    test_prefix = f"test_{uuid.uuid4().hex[:6]}"
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    async def create_emp_and_log(name: str, work_start: str, checkin_hour: int, checkin_min: int, dept: str = "TestingDept"):
        async with AsyncSessionLocal() as session:
            emp_id = uuid.uuid4()
            emp = Employee(
                id=emp_id,
                name=name,
                email=f"{name.lower().replace(' ', '_')}_{emp_id.hex[:4]}@example.com",
                department=dept,
                job_title="Tester",
                work_start_time=work_start,
                is_active=True,
            )
            session.add(emp)
            await session.commit()

            # Create check-in timestamp today at checkin_hour:checkin_min UTC
            ts = datetime.combine(
                datetime.now(timezone.utc).date(),
                time_type(hour=checkin_hour, minute=checkin_min, second=0)
            ).replace(tzinfo=timezone.utc)

            log = AttendanceLog(
                id=uuid.uuid4(),
                employee_id=emp.id,
                check_type="CHECK_IN",
                timestamp=ts,
                confidence_score=0.95,
                device_id="test-device",
                status="SUCCESS",
            )
            session.add(log)
            await session.commit()
            return str(emp.id)

    # Test Case 1.1: 08:55 check-in with work_start_time 09:00 -> ON_TIME (not late)
    emp_early_id = asyncio.run(create_emp_and_log(f"{test_prefix}_EarlyEmp", "09:00", 8, 55))
    res_early = client.get(f"/api/employees/{emp_early_id}/attendance")
    early_data = res_early.json()
    is_early_ok = (early_data["late_count"] == 0 and early_data["present_days"] == 1)
    log_test("late_entry", "08:55 check-in for 09:00 start (ON_TIME)", is_early_ok,
             f"late_count={early_data.get('late_count')}, present_days={early_data.get('present_days')}")
    if not is_early_ok:
        late_passed = False

    # Test Case 1.2: 09:00 check-in with work_start_time 09:00 -> ON_TIME (boundary)
    emp_on_time_id = asyncio.run(create_emp_and_log(f"{test_prefix}_ExactEmp", "09:00", 9, 0))
    res_exact = client.get(f"/api/employees/{emp_on_time_id}/attendance")
    exact_data = res_exact.json()
    is_exact_ok = (exact_data["late_count"] == 0 and exact_data["present_days"] == 1)
    log_test("late_entry", "09:00 check-in for 09:00 start (Boundary ON_TIME)", is_exact_ok,
             f"late_count={exact_data.get('late_count')}, present_days={exact_data.get('present_days')}")
    if not is_exact_ok:
        late_passed = False

    # Test Case 1.3: 09:15 check-in with work_start_time 09:00 -> LATE
    emp_late_id = asyncio.run(create_emp_and_log(f"{test_prefix}_LateEmp", "09:00", 9, 15))
    res_late = client.get(f"/api/employees/{emp_late_id}/attendance")
    late_data = res_late.json()
    is_late_ok = (late_data["late_count"] == 1 and late_data["present_days"] == 1)
    log_test("late_entry", "09:15 check-in for 09:00 start (LATE)", is_late_ok,
             f"late_count={late_data.get('late_count')}, present_days={late_data.get('present_days')}")
    if not is_late_ok:
        late_passed = False

    # Test Case 1.4: Custom start time 08:00, check-in 08:05 -> LATE
    emp_custom_late = asyncio.run(create_emp_and_log(f"{test_prefix}_CustomLateEmp", "08:00", 8, 5))
    res_c_late = client.get(f"/api/employees/{emp_custom_late}/attendance")
    c_late_data = res_c_late.json()
    is_c_late_ok = (c_late_data["late_count"] == 1)
    log_test("late_entry", "08:05 check-in for custom 08:00 start (LATE)", is_c_late_ok,
             f"late_count={c_late_data.get('late_count')}")
    if not is_c_late_ok:
        late_passed = False

    # Test Case 1.5: Custom start time 10:00, check-in 09:55 -> ON_TIME
    emp_custom_early = asyncio.run(create_emp_and_log(f"{test_prefix}_CustomEarlyEmp", "10:00", 9, 55))
    res_c_early = client.get(f"/api/employees/{emp_custom_early}/attendance")
    c_early_data = res_c_early.json()
    is_c_early_ok = (c_early_data["late_count"] == 0)
    log_test("late_entry", "09:55 check-in for custom 10:00 start (ON_TIME)", is_c_early_ok,
             f"late_count={c_early_data.get('late_count')}")
    if not is_c_early_ok:
        late_passed = False

    results["late_entry"]["status"] = "PASS" if late_passed else "FAIL"

    # =========================================================================
    # 2. LEAVE BALANCE MANAGEMENT
    # =========================================================================
    print("\n--- 2. LEAVE BALANCE MANAGEMENT TESTS ---")
    leave_passed = True

    # Create employee to test leave balance
    emp_leave_id = asyncio.run(create_emp_and_log(f"{test_prefix}_LeaveEmp", "09:00", 8, 0))

    # Initial balance check (default 15.0)
    res_init = client.get(f"/api/employees/{emp_leave_id}")
    init_emp = client.get(f"/api/employees/{emp_leave_id}/attendance").json()
    is_init_ok = (init_emp["leave_balance"] == 15.0)
    log_test("leave_balance", "Default leave balance is 15.0", is_init_ok, f"balance={init_emp.get('leave_balance')}")
    if not is_init_ok:
        leave_passed = False

    # Action: add 5.0 -> 20.0
    res_add = client.patch(f"/api/employees/{emp_leave_id}/leave", json={"action": "add", "amount": 5.0}, headers=admin_headers)
    add_ok = (res_add.status_code == 200 and res_add.json().get("new_leave_balance") == 20.0)
    log_test("leave_balance", "Action 'add' increases balance (15 + 5 = 20)", add_ok, f"response={res_add.json()}")
    if not add_ok:
        leave_passed = False

    # Action: deduct 3.0 -> 17.0
    res_deduct = client.patch(f"/api/employees/{emp_leave_id}/leave", json={"action": "deduct", "amount": 3.0}, headers=admin_headers)
    deduct_ok = (res_deduct.status_code == 200 and res_deduct.json().get("new_leave_balance") == 17.0)
    log_test("leave_balance", "Action 'deduct' decreases balance (20 - 3 = 17)", deduct_ok, f"response={res_deduct.json()}")
    if not deduct_ok:
        leave_passed = False

    # Action: set 10.0 -> 10.0
    res_set = client.patch(f"/api/employees/{emp_leave_id}/leave", json={"action": "set", "amount": 10.0}, headers=admin_headers)
    set_ok = (res_set.status_code == 200 and res_set.json().get("new_leave_balance") == 10.0)
    log_test("leave_balance", "Action 'set' replaces balance (10.0)", set_ok, f"response={res_set.json()}")
    if not set_ok:
        leave_passed = False

    # Negative balance test: deduct 25.0 from 10.0 balance -> -15.0
    res_neg_deduct = client.patch(f"/api/employees/{emp_leave_id}/leave", json={"action": "deduct", "amount": 25.0}, headers=admin_headers)
    neg_deduct_val = res_neg_deduct.json().get("new_leave_balance") if res_neg_deduct.status_code == 200 else None
    log_test("leave_balance", "Deduct exceeding current balance (10 - 25)", True,
             f"status_code={res_neg_deduct.status_code}, resulting balance={neg_deduct_val}")

    # Negative balance test: set -5.0
    res_neg_set = client.patch(f"/api/employees/{emp_leave_id}/leave", json={"action": "set", "amount": -5.0}, headers=admin_headers)
    neg_set_val = res_neg_set.json().get("new_leave_balance") if res_neg_set.status_code == 200 else None
    log_test("leave_balance", "Set negative leave balance (-5.0)", True,
             f"status_code={res_neg_set.status_code}, resulting balance={neg_set_val}")

    results["leave_balance"]["status"] = "PASS" if leave_passed else "FAIL"

    # =========================================================================
    # 3. DEPARTMENT SUMMARY
    # =========================================================================
    print("\n--- 3. DEPARTMENT SUMMARY TESTS ---")
    dept_passed = True

    # Setup isolated department test data
    async def create_dept_test_data():
        async with AsyncSessionLocal() as session:
            # We use unique department names for this run to easily verify grouping
            dept_eng = f"Eng_{uuid.uuid4().hex[:4]}"
            dept_mkt = f"Mkt_{uuid.uuid4().hex[:4]}"

            # Employee 1: Eng, On-Time checkin (08:50)
            id1 = uuid.uuid4()
            e1 = Employee(id=id1, name="Eng_OnTime", email=f"eng_ontime_{id1.hex[:4]}@example.com", department=dept_eng, work_start_time="09:00", is_active=True)
            # Employee 2: Eng, Late checkin (09:20)
            id2 = uuid.uuid4()
            e2 = Employee(id=id2, name="Eng_Late", email=f"eng_late_{id2.hex[:4]}@example.com", department=dept_eng, work_start_time="09:00", is_active=True)
            # Employee 3: Mkt, On-Time checkin (08:45)
            id3 = uuid.uuid4()
            e3 = Employee(id=id3, name="Mkt_OnTime", email=f"mkt_ontime_{id3.hex[:4]}@example.com", department=dept_mkt, work_start_time="09:00", is_active=True)
            # Employee 4: Mkt, Absent (No checkin)
            id4 = uuid.uuid4()
            e4 = Employee(id=id4, name="Mkt_Absent", email=f"mkt_absent_{id4.hex[:4]}@example.com", department=dept_mkt, work_start_time="09:00", is_active=True)

            session.add_all([e1, e2, e3, e4])
            await session.commit()

            today_date = datetime.now(timezone.utc).date()
            l1 = AttendanceLog(
                id=uuid.uuid4(), employee_id=e1.id, check_type="CHECK_IN", status="SUCCESS",
                timestamp=datetime.combine(today_date, time_type(8, 50)).replace(tzinfo=timezone.utc)
            )
            l2 = AttendanceLog(
                id=uuid.uuid4(), employee_id=e2.id, check_type="CHECK_IN", status="SUCCESS",
                timestamp=datetime.combine(today_date, time_type(9, 20)).replace(tzinfo=timezone.utc)
            )
            l3 = AttendanceLog(
                id=uuid.uuid4(), employee_id=e3.id, check_type="CHECK_IN", status="SUCCESS",
                timestamp=datetime.combine(today_date, time_type(8, 45)).replace(tzinfo=timezone.utc)
            )
            session.add_all([l1, l2, l3])
            await session.commit()
            return dept_eng, dept_mkt

    dept_eng, dept_mkt = asyncio.run(create_dept_test_data())

    res_sum = client.get("/api/attendance/summary")
    sum_ok = res_sum.status_code == 200
    sum_data = res_sum.json() if sum_ok else {}

    if not sum_ok:
        log_test("dept_summary", "GET /api/attendance/summary", False, f"Status code {res_sum.status_code}")
        dept_passed = False
    else:
        depts = sum_data.get("departments", {})

        # Check Eng department stats
        eng_stats = depts.get(dept_eng)
        eng_ok = eng_stats and eng_stats["present"] == 2 and eng_stats["absent"] == 0 and eng_stats["late"] == 1
        log_test("dept_summary", f"Department '{dept_eng}' stats (2 present, 0 absent, 1 late)", eng_ok, f"stat={eng_stats}")
        if not eng_ok:
            dept_passed = False

        # Check Mkt department stats
        mkt_stats = depts.get(dept_mkt)
        mkt_ok = mkt_stats and mkt_stats["present"] == 1 and mkt_stats["absent"] == 1 and mkt_stats["late"] == 0
        log_test("dept_summary", f"Department '{dept_mkt}' stats (1 present, 1 absent, 0 late)", mkt_ok, f"stat={mkt_stats}")
        if not mkt_ok:
            dept_passed = False

        # Check Invariants
        total_emp = sum_data.get("total_employees", 0)
        pres_cnt = sum_data.get("present_count", 0)
        abs_cnt = sum_data.get("absent_count", 0)
        late_cnt = sum_data.get("late_count", 0)

        inv1 = (pres_cnt + abs_cnt == total_emp)
        log_test("dept_summary", "Invariant: present_count + absent_count == total_employees", inv1,
                 f"{pres_cnt} + {abs_cnt} == {total_emp}")
        if not inv1:
            dept_passed = False

        sum_dept_pres = sum(d["present"] for d in depts.values())
        sum_dept_abs = sum(d["absent"] for d in depts.values())
        sum_dept_late = sum(d["late"] for d in depts.values())

        inv2 = (sum_dept_pres == pres_cnt and sum_dept_abs == abs_cnt and sum_dept_late == late_cnt)
        log_test("dept_summary", "Invariant: Dept breakdown sums equal total counts", inv2,
                 f"Dept sums: pres={sum_dept_pres}, abs={sum_dept_abs}, late={sum_dept_late}")
        if not inv2:
            dept_passed = False

    results["dept_summary"]["status"] = "PASS" if dept_passed else "FAIL"

    # =========================================================================
    # 4. USER ROLE PROMOTION & SUPER ADMIN CONSTRAINTS
    # =========================================================================
    print("\n--- 4. USER ROLE PROMOTION & SUPER ADMIN CONSTRAINTS TESTS ---")
    role_passed = True

    # Step A: Register an employee user account
    emp_username = f"emp_user_{uuid.uuid4().hex[:6]}"
    reg_res = client.post("/api/auth/register", json={
        "username": emp_username,
        "password": "user123pass",
        "employee_id": emp_early_id
    })
    reg_ok = reg_res.status_code == 201
    user_id = reg_res.json().get("user_id") if reg_ok else None
    log_test("role_promotion", "Register standard employee user", reg_ok, f"user_id={user_id}")
    if not reg_ok:
        role_passed = False

    # Step B: Login as employee user
    emp_login = client.post("/api/auth/login", json={"username": emp_username, "password": "user123pass"})
    emp_login_ok = emp_login.status_code == 200
    emp_token = emp_login.json().get("access_token") if emp_login_ok else None
    emp_headers = {"Authorization": f"Bearer {emp_token}"} if emp_token else {}
    log_test("role_promotion", "Login as employee user", emp_login_ok, f"role={emp_login.json().get('role')}")

    # Step C: Employee user attempts admin endpoint (GET /api/users) -> 403
    emp_unauth_users = client.get("/api/users", headers=emp_headers)
    is_403_users = (emp_unauth_users.status_code == 403)
    log_test("role_promotion", "Employee access GET /api/users blocked (403)", is_403_users, f"status={emp_unauth_users.status_code}")
    if not is_403_users:
        role_passed = False

    # Step D: Employee user attempts admin endpoint (PATCH /api/employees/{id}/leave) -> 403
    emp_unauth_leave = client.patch(f"/api/employees/{emp_early_id}/leave", json={"action": "add", "amount": 1.0}, headers=emp_headers)
    is_403_leave = (emp_unauth_leave.status_code == 403)
    log_test("role_promotion", "Employee access PATCH /api/employees/{id}/leave blocked (403)", is_403_leave, f"status={emp_unauth_leave.status_code}")
    if not is_403_leave:
        role_passed = False

    # Step E: Super Admin promotes employee to "admin"
    promote_res = client.patch(f"/api/users/{user_id}/role", json={"role": "admin"}, headers=admin_headers)
    promote_ok = (promote_res.status_code == 200 and promote_res.json().get("role") == "admin")
    log_test("role_promotion", "Super Admin promotes employee user to 'admin'", promote_ok, f"response={promote_res.json()}")
    if not promote_ok:
        role_passed = False

    # Re-login as employee (or generate new token) to reflect role change
    emp_relogin = client.post("/api/auth/login", json={"username": emp_username, "password": "user123pass"})
    promoted_token = emp_relogin.json().get("access_token")
    promoted_headers = {"Authorization": f"Bearer {promoted_token}"}
    log_test("role_promotion", "Re-login as promoted user gets updated role", emp_relogin.json().get("role") == "admin",
             f"role={emp_relogin.json().get('role')}")

    # Step F: Promoted user accesses GET /api/users -> 200 OK
    promoted_get_users = client.get("/api/users", headers=promoted_headers)
    is_200_users = (promoted_get_users.status_code == 200)
    log_test("role_promotion", "Promoted Admin user GET /api/users granted (200)", is_200_users, f"status={promoted_get_users.status_code}")
    if not is_200_users:
        role_passed = False

    # Step G: Promoted user accesses PATCH /api/employees/{id}/leave -> 200 OK
    promoted_patch_leave = client.patch(f"/api/employees/{emp_early_id}/leave", json={"action": "add", "amount": 1.0}, headers=promoted_headers)
    is_200_leave = (promoted_patch_leave.status_code == 200)
    log_test("role_promotion", "Promoted Admin user PATCH leave balance granted (200)", is_200_leave, f"status={promoted_patch_leave.status_code}")
    if not is_200_leave:
        role_passed = False

    # Step H: Promoted Admin user attempts Super Admin endpoint (PATCH /api/users/{id}/role) -> 403
    promoted_role_change = client.patch(f"/api/users/{user_id}/role", json={"role": "employee"}, headers=promoted_headers)
    is_403_role_change = (promoted_role_change.status_code == 403)
    log_test("role_promotion", "Promoted Admin user calling super-admin endpoint PATCH /api/users/{id}/role blocked (403)",
             is_403_role_change, f"status={promoted_role_change.status_code}")
    if not is_403_role_change:
        role_passed = False

    # Step I: Super Admin self-demotion block: Super Admin tries demoting self to employee or admin
    self_demote_emp = client.patch(f"/api/users/{superadmin_user_id}/role", json={"role": "employee"}, headers=admin_headers)
    is_self_emp_blocked = (self_demote_emp.status_code == 400)
    log_test("role_promotion", "Super Admin self-demotion to 'employee' blocked (400)", is_self_emp_blocked,
             f"status={self_demote_emp.status_code}, detail={self_demote_emp.json().get('detail')}")
    if not is_self_emp_blocked:
        role_passed = False

    self_demote_admin = client.patch(f"/api/users/{superadmin_user_id}/role", json={"role": "admin"}, headers=admin_headers)
    is_self_admin_blocked = (self_demote_admin.status_code == 400)
    log_test("role_promotion", "Super Admin self-demotion to 'admin' blocked (400)", is_self_admin_blocked,
             f"status={self_demote_admin.status_code}, detail={self_demote_admin.json().get('detail')}")
    if not is_self_admin_blocked:
        role_passed = False

    results["role_promotion"]["status"] = "PASS" if role_passed else "FAIL"

    # =========================================================================
    # SUMMARY REPORT OUTPUT
    # =========================================================================
    print("\n" + "=" * 70)
    print("  EMPIRICAL VERIFICATION SUMMARY")
    print("=" * 70)
    overall_pass = True
    for cat, res in results.items():
        print(f"  Category: {cat.upper()} => Status: {res['status']}")
        if res["status"] != "PASS":
            overall_pass = False
    print(f"\nOVERALL VERDICT: {'PASS' if overall_pass else 'FAIL'}")
    print("=" * 70)
    return overall_pass


if __name__ == "__main__":
    success = run_empirical_tests()
    sys.exit(0 if success else 1)
