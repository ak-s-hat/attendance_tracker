"""Attendance Summary API with department breakdown and late tracking."""

import logging
from datetime import datetime, date as date_type, time as time_type, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.attendance_log import AttendanceLog
from app.models.employee import Employee

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Attendance"])


class DepartmentStat(BaseModel):
    present: int = 0
    absent: int = 0
    late: int = 0


class AttendanceSummaryResponse(BaseModel):
    date: str
    total_employees: int
    present_count: int
    absent_count: int
    late_count: int
    departments: dict[str, DepartmentStat]


@router.get("/attendance/summary", response_model=AttendanceSummaryResponse)
async def get_attendance_summary(
    date: Optional[str] = Query(
        None, description="Date in YYYY-MM-DD format (defaults to UTC today)"
    ),
    db: AsyncSession = Depends(get_db),
):
    """GET /api/attendance/summary — Department-wise attendance and late count summary."""
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        target_date = datetime.now(timezone.utc).date()

    start_dt = datetime.combine(target_date, time_type.min)
    end_dt = datetime.combine(target_date, time_type.max)

    # Dynamic system settings
    from app.api.settings import get_or_create_settings
    sys_settings = await get_or_create_settings(db)
    try:
        fallback_h, fallback_m = map(int, sys_settings.work_start_time.split(":"))
    except Exception:
        fallback_h, fallback_m = 9, 0

    # Fetch all active employees
    emp_stmt = select(Employee).where(Employee.is_active == True)  # noqa: E712
    emp_res = await db.execute(emp_stmt)
    employees = emp_res.scalars().all()
    total_employees = len(employees)

    # Fetch logs for the day
    log_stmt = (
        select(AttendanceLog)
        .where(
            AttendanceLog.timestamp >= start_dt,
            AttendanceLog.timestamp <= end_dt,
            AttendanceLog.status == "SUCCESS",
            AttendanceLog.check_type == "CHECK_IN",
        )
        .order_by(AttendanceLog.timestamp.asc())
    )
    log_res = await db.execute(log_stmt)
    logs = log_res.scalars().all()

    # Map earliest check-in time per employee
    employee_first_checkin: dict[str, datetime] = {}
    for log in logs:
        if log.employee_id:
            emp_id_str = str(log.employee_id)
            if emp_id_str not in employee_first_checkin:
                employee_first_checkin[emp_id_str] = log.timestamp

    present_emp_ids = set(employee_first_checkin.keys())
    present_count = len(present_emp_ids)
    absent_count = max(0, total_employees - present_count)

    late_count = 0
    dept_stats: dict[str, DepartmentStat] = {}

    for emp in employees:
        dept = emp.department or "General"
        if dept not in dept_stats:
            dept_stats[dept] = DepartmentStat()

        emp_id_str = str(emp.id)
        if emp_id_str in present_emp_ids:
            dept_stats[dept].present += 1
            first_in = employee_first_checkin[emp_id_str]

            # Check late status against work_start_time
            emp_start_h, emp_start_m = fallback_h, fallback_m
            if emp.work_start_time:
                try:
                    emp_start_h, emp_start_m = map(
                        int, emp.work_start_time.split(":")
                    )
                except Exception:
                    pass

            if (first_in.hour > emp_start_h) or (
                first_in.hour == emp_start_h and first_in.minute > emp_start_m
            ):
                late_count += 1
                dept_stats[dept].late += 1
        else:
            dept_stats[dept].absent += 1

    return AttendanceSummaryResponse(
        date=target_date.isoformat(),
        total_employees=total_employees,
        present_count=present_count,
        absent_count=absent_count,
        late_count=late_count,
        departments=dept_stats,
    )


class DailyMatrixItem(BaseModel):
    employee_id: str
    name: str
    department: Optional[str] = "General"
    job_title: Optional[str] = None
    status: str  # "PRESENT", "LATE", "ABSENT"
    first_check_in: Optional[str] = None
    last_check_out: Optional[str] = None
    total_hours: Optional[float] = None
    late_minutes: int = 0
    leave_balance: float = 15.0
    confidence_score: Optional[float] = None
    liveness_score: Optional[float] = None


@router.get("/attendance/daily-matrix", response_model=list[DailyMatrixItem])
async def get_daily_attendance_matrix(
    date: Optional[str] = Query(
        None, description="Date in YYYY-MM-DD format (defaults to UTC today)"
    ),
    db: AsyncSession = Depends(get_db),
):
    """GET /api/attendance/daily-matrix — Per-employee first check-in, check-out, and punctuality matrix."""
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        target_date = datetime.now(timezone.utc).date()

    start_dt = datetime.combine(target_date, time_type.min)
    end_dt = datetime.combine(target_date, time_type.max)

    try:
        fallback_h, fallback_m = map(int, settings.WORK_START_TIME.split(":"))
    except Exception:
        fallback_h, fallback_m = 9, 0

    emp_stmt = select(Employee).where(Employee.is_active == True).order_by(Employee.name)  # noqa: E712
    emp_res = await db.execute(emp_stmt)
    employees = emp_res.scalars().all()

    # Fetch all SUCCESS logs for the target day
    log_stmt = (
        select(AttendanceLog)
        .where(
            AttendanceLog.timestamp >= start_dt,
            AttendanceLog.timestamp <= end_dt,
            AttendanceLog.status == "SUCCESS",
        )
        .order_by(AttendanceLog.timestamp.asc())
    )
    log_res = await db.execute(log_stmt)
    logs = log_res.scalars().all()

    # Group logs by employee_id
    emp_logs: dict[str, list[AttendanceLog]] = {}
    for log in logs:
        if log.employee_id:
            eid = str(log.employee_id)
            if eid not in emp_logs:
                emp_logs[eid] = []
            emp_logs[eid].append(log)

    matrix: list[DailyMatrixItem] = []
    now = datetime.now(timezone.utc)

    for emp in employees:
        eid = str(emp.id)
        logs_for_emp = emp_logs.get(eid, [])

        check_ins = [l for l in logs_for_emp if l.check_type == "CHECK_IN"]
        check_outs = [l for l in logs_for_emp if l.check_type == "CHECK_OUT"]

        first_in_log = check_ins[0] if check_ins else None
        last_out_log = check_outs[-1] if check_outs else None

        first_in_str = first_in_log.timestamp.isoformat() if first_in_log else None
        last_out_str = last_out_log.timestamp.isoformat() if last_out_log else None

        # Determine punctuality
        emp_start_h, emp_start_m = fallback_h, fallback_m
        if emp.work_start_time:
            try:
                emp_start_h, emp_start_m = map(int, emp.work_start_time.split(":"))
            except Exception:
                pass

        late_mins = 0
        total_hrs = None
        status_label = "ABSENT"

        if first_in_log:
            arrival_mins = first_in_log.timestamp.hour * 60 + first_in_log.timestamp.minute
            expected_mins = emp_start_h * 60 + emp_start_m
            if arrival_mins > expected_mins:
                late_mins = arrival_mins - expected_mins
                status_label = "LATE"
            else:
                status_label = "PRESENT"

            # Calculate hours worked
            if last_out_log and last_out_log.timestamp > first_in_log.timestamp:
                delta = last_out_log.timestamp - first_in_log.timestamp
                total_hrs = round(delta.total_seconds() / 3600.0, 2)
            elif target_date == now.date():
                # Still in office today
                delta = now - first_in_log.timestamp
                total_hrs = max(0.0, round(delta.total_seconds() / 3600.0, 2))

        conf = first_in_log.confidence_score if first_in_log else None

        matrix.append(
            DailyMatrixItem(
                employee_id=eid,
                name=emp.name,
                department=emp.department or "General",
                job_title=emp.job_title,
                status=status_label,
                first_check_in=first_in_str,
                last_check_out=last_out_str,
                total_hours=total_hrs,
                late_minutes=late_mins,
                leave_balance=getattr(emp, "leave_balance", 15.0),
                confidence_score=round(conf, 3) if conf is not None else None,
                liveness_score=0.95 if status_label in ["PRESENT", "LATE"] else None,
            )
        )

    return matrix

