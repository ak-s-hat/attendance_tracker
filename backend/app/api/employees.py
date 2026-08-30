"""Employee CRUD API endpoints."""

import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import require_admin
from app.models.attendance_log import AttendanceLog
from app.models.employee import Employee
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Employees"])


# ── Pydantic schemas ─────────────────────────────────────────────────────────

class EmployeeCreate(BaseModel):
    name: str
    email: Optional[str] = None
    department: Optional[str] = "General"
    job_title: Optional[str] = None

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, v):
        if not v or not str(v).strip():
            return None
        return str(v).strip().lower()


class EmployeeResponse(BaseModel):
    id: str
    name: str
    email: str | None
    department: str | None
    job_title: str | None
    is_enrolled: bool  # True if face_embedding is set
    is_active: bool
    leave_balance: float = 15.0

    class Config:
        from_attributes = True


class LeaveAdjustmentRequest(BaseModel):
    action: Literal["add", "deduct", "set"]
    amount: float


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/employees", response_model=list[EmployeeResponse])
async def list_employees(db: AsyncSession = Depends(get_db)):
    """GET /api/employees — List all active employees."""
    stmt = select(Employee).where(Employee.is_active == True)  # noqa: E712
    result = await db.execute(stmt)
    employees = result.scalars().all()

    return [
        EmployeeResponse(
            id=str(emp.id),
            name=emp.name,
            email=emp.email,
            department=emp.department,
            job_title=emp.job_title,
            is_enrolled=emp.face_embedding is not None,
            is_active=emp.is_active,
            leave_balance=getattr(emp, "leave_balance", 15.0),
        )
        for emp in employees
    ]


@router.post("/employees", response_model=EmployeeResponse, status_code=201)
async def create_employee(
    payload: EmployeeCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """POST /api/employees — Create a new employee (without face enrollment)."""
    # Check for duplicate email
    if payload.email:
        existing = await db.execute(
            select(Employee).where(Employee.email == payload.email)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409, detail=f"Employee with email '{payload.email}' already exists"
            )

    employee = Employee(
        id=uuid4(),
        name=payload.name,
        email=payload.email,
        department=payload.department,
        job_title=payload.job_title,
        is_active=True,
        leave_balance=15.0,
    )
    db.add(employee)
    await db.commit()
    await db.refresh(employee)

    logger.info("Created employee %s (%s)", employee.name, employee.id)
    return EmployeeResponse(
        id=str(employee.id),
        name=employee.name,
        email=employee.email,
        department=employee.department,
        job_title=employee.job_title,
        is_enrolled=employee.face_embedding is not None,
        is_active=employee.is_active,
        leave_balance=getattr(employee, "leave_balance", 15.0),
    )


class CachedEmployeeDelta(BaseModel):
    id: str
    name: str
    department: str
    job_title: str | None = None
    embedding: list[float]
    updated_at: str


@router.get("/employees/embeddings-delta", response_model=list[CachedEmployeeDelta])
async def get_employee_embeddings_delta(
    since: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """GET /api/employees/embeddings-delta — Download active employee 512-d face vectors to edge kiosk."""
    stmt = select(Employee).where(
        Employee.is_active == True,
        Employee.face_embedding.isnot(None),
    )

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            stmt = stmt.where(Employee.updated_at >= since_dt)
        except Exception:
            pass  # If invalid date, return all active embeddings

    result = await db.execute(stmt)
    employees = result.scalars().all()

    deltas = []
    for emp in employees:
        if emp.face_embedding is None:
            continue
        vec = [float(x) for x in emp.face_embedding]
        if len(vec) == 512:
            deltas.append(
                CachedEmployeeDelta(
                    id=str(emp.id),
                    name=emp.name,
                    department=emp.department or "General",
                    job_title=emp.job_title,
                    embedding=vec,
                    updated_at=emp.updated_at.isoformat() if emp.updated_at else datetime.now(timezone.utc).isoformat(),
                )
            )

    return deltas


@router.get("/employees/{employee_id}", response_model=EmployeeResponse)
async def get_employee(employee_id: str, db: AsyncSession = Depends(get_db)):
    """GET /api/employees/{id} — Get a single employee by UUID."""
    try:
        emp_uuid = UUID(employee_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    employee = await db.get(Employee, emp_uuid)
    if not employee or not employee.is_active:
        raise HTTPException(status_code=404, detail="Employee not found")

    return EmployeeResponse(
        id=str(employee.id),
        name=employee.name,
        email=employee.email,
        department=employee.department,
        job_title=employee.job_title,
        is_enrolled=employee.face_embedding is not None,
        is_active=employee.is_active,
        leave_balance=getattr(employee, "leave_balance", 15.0),
    )


@router.delete("/employees/{employee_id}")
async def delete_employee(
    employee_id: str,
    hard: bool = False,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """DELETE /api/employees/{id} — Soft delete or permanent hard delete with all data."""
    try:
        emp_uuid = UUID(employee_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    employee = await db.get(Employee, emp_uuid)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")

    emp_name = employee.name
    if hard:
        await db.execute(delete(User).where(User.employee_id == emp_uuid))
        await db.execute(delete(AttendanceLog).where(AttendanceLog.employee_id == emp_uuid))
        await db.delete(employee)
        await db.commit()
        logger.info("Permanently deleted employee %s (%s)", emp_name, emp_uuid)
        return {"success": True, "message": f"Employee '{emp_name}' and all associated records permanently deleted"}
    else:
        employee.is_active = False
        await db.commit()
        logger.info("Soft-deleted employee %s (%s)", emp_name, emp_uuid)
        return {"success": True, "message": f"Employee '{emp_name}' deactivated"}


@router.get("/employees/{employee_id}/attendance")
async def get_employee_attendance(
    employee_id: str,
    db: AsyncSession = Depends(get_db),
):
    """GET /api/employees/{id}/attendance — Stats & logs for specific employee."""
    try:
        emp_uuid = UUID(employee_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    employee = await db.get(Employee, emp_uuid)
    if not employee or not employee.is_active:
        raise HTTPException(status_code=404, detail="Employee not found")

    # Logs for employee
    log_stmt = (
        select(AttendanceLog)
        .where(AttendanceLog.employee_id == emp_uuid)
        .order_by(AttendanceLog.timestamp.desc())
    )
    log_res = await db.execute(log_stmt)
    logs = log_res.scalars().all()

    # Calculate present days & late count
    distinct_dates = set()
    late_count = 0
    work_start_h, work_start_m = 9, 0
    if employee.work_start_time:
        try:
            work_start_h, work_start_m = map(int, employee.work_start_time.split(":"))
        except Exception:
            pass

    for log in logs:
        if log.status == "SUCCESS" and log.check_type == "CHECK_IN" and log.timestamp:
            date_str = log.timestamp.date().isoformat()
            if date_str not in distinct_dates:
                distinct_dates.add(date_str)
                if log.timestamp.hour > work_start_h or (
                    log.timestamp.hour == work_start_h and log.timestamp.minute > work_start_m
                ):
                    late_count += 1

    return {
        "employee_id": str(employee.id),
        "name": employee.name,
        "leave_balance": getattr(employee, "leave_balance", 15.0),
        "present_days": len(distinct_dates),
        "late_count": late_count,
        "logs": [
            {
                "timestamp": log.timestamp.isoformat() if log.timestamp else None,
                "check_type": log.check_type,
                "status": log.status,
                "confidence_score": round(log.confidence_score, 3)
                if log.confidence_score
                else None,
                "device_id": log.device_id,
            }
            for log in logs
        ],
    }


@router.patch("/employees/{employee_id}/leave")
async def adjust_leave_balance(
    employee_id: str,
    payload: LeaveAdjustmentRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """PATCH /api/employees/{id}/leave — Admin leave balance adjustment."""
    try:
        emp_uuid = UUID(employee_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid UUID format")

    employee = await db.get(Employee, emp_uuid)
    if not employee or not employee.is_active:
        raise HTTPException(status_code=404, detail="Employee not found")

    current_balance = getattr(employee, "leave_balance", 15.0)
    if payload.action == "add":
        new_balance = current_balance + payload.amount
    elif payload.action == "deduct":
        new_balance = current_balance - payload.amount
    elif payload.action == "set":
        new_balance = payload.amount
    else:
        raise HTTPException(status_code=400, detail="Invalid action")

    employee.leave_balance = round(max(0.0, new_balance), 2)
    await db.commit()

    return {
        "employee_id": str(employee.id),
        "new_leave_balance": employee.leave_balance,
        "leave_balance": employee.leave_balance,
    }

