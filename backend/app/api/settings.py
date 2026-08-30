"""System settings and database hygiene management API."""

import logging
from typing import Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import require_admin
from app.models.attendance_log import AttendanceLog
from app.models.employee import Employee
from app.models.system_setting import SystemSetting
from app.models.user import RegistrationToken, User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Settings"])


class SystemSettingsSchema(BaseModel):
    rapid_scan_debounce_minutes: float = 2.0
    work_start_time: str = "09:00"
    half_day_cutoff_time: str = "13:00"
    valid_checkout_time: str = "17:00"
    duplicate_face_threshold: float = 0.65
    auto_deduct_absent_leave: bool = False

    @field_validator("work_start_time", "half_day_cutoff_time", "valid_checkout_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        parts = v.strip().split(":")
        if len(parts) != 2:
            raise ValueError("Time must be in HH:MM format (24h)")
        h, m = int(parts[0]), int(parts[1])
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError("Invalid hour or minute in time format")
        return f"{h:02d}:{m:02d}"


class SystemSettingsUpdateSchema(BaseModel):
    rapid_scan_debounce_minutes: Optional[float] = None
    work_start_time: Optional[str] = None
    half_day_cutoff_time: Optional[str] = None
    valid_checkout_time: Optional[str] = None
    duplicate_face_threshold: Optional[float] = None
    auto_deduct_absent_leave: Optional[bool] = None


class DatabaseStatsResponse(BaseModel):
    total_employees: int
    enrolled_employees: int
    total_logs: int
    unknown_logs: int
    spoof_logs: int
    total_users: int
    db_size_mb: float
    status: str
    last_cleanup_days_ago: int


async def get_or_create_settings(db: AsyncSession) -> SystemSetting:
    """Fetch system settings singleton row (id=1) or create default."""
    stmt = select(SystemSetting).where(SystemSetting.id == 1)
    res = await db.execute(stmt)
    setting = res.scalar_one_or_none()
    if not setting:
        setting = SystemSetting(
            id=1,
            rapid_scan_debounce_minutes=2.0,
            work_start_time="09:00",
            half_day_cutoff_time="13:00",
            valid_checkout_time="17:00",
            duplicate_face_threshold=0.65,
            auto_deduct_absent_leave=False,
        )
        db.add(setting)
        await db.commit()
        await db.refresh(setting)
    return setting


@router.get("/settings", response_model=SystemSettingsSchema)
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """GET /api/settings — Retrieve current system rules & tuneables."""
    setting = await get_or_create_settings(db)
    return SystemSettingsSchema(
        rapid_scan_debounce_minutes=setting.rapid_scan_debounce_minutes,
        work_start_time=setting.work_start_time,
        half_day_cutoff_time=setting.half_day_cutoff_time,
        valid_checkout_time=setting.valid_checkout_time,
        duplicate_face_threshold=setting.duplicate_face_threshold,
        auto_deduct_absent_leave=setting.auto_deduct_absent_leave,
    )


@router.patch("/settings", response_model=SystemSettingsSchema)
async def update_settings(
    payload: SystemSettingsUpdateSchema,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """PATCH /api/settings — Update system tuneables & time cutoffs."""
    setting = await get_or_create_settings(db)

    # Basic time ordering validations (Item 11)
    new_start = payload.work_start_time or setting.work_start_time
    new_half = payload.half_day_cutoff_time or setting.half_day_cutoff_time
    new_out = payload.valid_checkout_time or setting.valid_checkout_time

    sh, sm = map(int, new_start.split(":"))
    hh, hm = map(int, new_half.split(":"))
    oh, om = map(int, new_out.split(":"))

    start_mins = sh * 60 + sm
    half_mins = hh * 60 + hm
    out_mins = oh * 60 + om

    if start_mins >= half_mins:
        raise HTTPException(status_code=400, detail="Work Start Time must be earlier than Half-Day Cutoff Time.")
    if half_mins >= out_mins:
        raise HTTPException(status_code=400, detail="Half-Day Cutoff Time must be earlier than Valid Checkout Time.")

    if payload.rapid_scan_debounce_minutes is not None:
        setting.rapid_scan_debounce_minutes = max(0.5, round(payload.rapid_scan_debounce_minutes, 1))
    if payload.work_start_time is not None:
        setting.work_start_time = payload.work_start_time
    if payload.half_day_cutoff_time is not None:
        setting.half_day_cutoff_time = payload.half_day_cutoff_time
    if payload.valid_checkout_time is not None:
        setting.valid_checkout_time = payload.valid_checkout_time
    if payload.duplicate_face_threshold is not None:
        setting.duplicate_face_threshold = min(0.95, max(0.4, payload.duplicate_face_threshold))
    if payload.auto_deduct_absent_leave is not None:
        setting.auto_deduct_absent_leave = payload.auto_deduct_absent_leave

    await db.commit()
    await db.refresh(setting)
    logger.info("Updated system settings: %s", payload)

    return SystemSettingsSchema(
        rapid_scan_debounce_minutes=setting.rapid_scan_debounce_minutes,
        work_start_time=setting.work_start_time,
        half_day_cutoff_time=setting.half_day_cutoff_time,
        valid_checkout_time=setting.valid_checkout_time,
        duplicate_face_threshold=setting.duplicate_face_threshold,
        auto_deduct_absent_leave=setting.auto_deduct_absent_leave,
    )


@router.get("/settings/db-stats", response_model=DatabaseStatsResponse)
async def get_database_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """GET /api/settings/db-stats — Overview of database storage usage and hygiene."""
    emp_count = (await db.execute(select(func.count(Employee.id)).where(Employee.is_active == True))).scalar() or 0
    enrolled_count = (await db.execute(select(func.count(Employee.id)).where(Employee.is_active == True, Employee.face_embedding.isnot(None)))).scalar() or 0
    log_count = (await db.execute(select(func.count(AttendanceLog.id)))).scalar() or 0
    unknown_count = (await db.execute(select(func.count(AttendanceLog.id)).where(AttendanceLog.employee_id.is_(None)))).scalar() or 0
    spoof_count = (await db.execute(select(func.count(AttendanceLog.id)).where(AttendanceLog.failure_reason == "spoof_detected"))).scalar() or 0
    user_count = (await db.execute(select(func.count(User.id)).where(User.is_active == True))).scalar() or 0

    # Calculate approx database size via postgres function
    size_res = await db.execute(text("SELECT pg_database_size(current_database())"))
    size_bytes = size_res.scalar() or 0
    size_mb = round(size_bytes / (1024 * 1024), 2)

    return DatabaseStatsResponse(
        total_employees=emp_count,
        enrolled_employees=enrolled_count,
        total_logs=log_count,
        unknown_logs=unknown_count,
        spoof_logs=spoof_count,
        total_users=user_count,
        db_size_mb=size_mb,
        status="Healthy",
        last_cleanup_days_ago=0,
    )


@router.delete("/settings/purge-logs")
async def purge_unwanted_logs(
    purge_type: str = "unknown",  # "unknown", "spoof", "all_failed", or "older_than"
    days_older: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """DELETE /api/settings/purge-logs — Clean up unneeded unknown/spoof scan logs to save DB space."""
    stmt = delete(AttendanceLog)

    if purge_type == "unknown":
        stmt = stmt.where(AttendanceLog.employee_id.is_(None))
    elif purge_type == "spoof":
        stmt = stmt.where(AttendanceLog.failure_reason == "spoof_detected")
    elif purge_type == "all_failed":
        stmt = stmt.where(AttendanceLog.status == "FAILED")
    elif purge_type == "older_than":
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=days_older)
        stmt = stmt.where(AttendanceLog.timestamp < cutoff_date)
    else:
        raise HTTPException(status_code=400, detail="Invalid purge_type")

    result = await db.execute(stmt)
    await db.commit()
    deleted_rows = result.rowcount

    logger.info("Purged %d logs with purge_type=%s", deleted_rows, purge_type)
    return {
        "success": True,
        "deleted_count": deleted_rows,
        "message": f"Successfully purged {deleted_rows} scan log records.",
    }
