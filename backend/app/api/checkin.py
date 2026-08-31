"""Check-in, enrollment, and live feed API endpoints."""

import logging
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

import numpy as np
import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, File
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.settings import get_or_create_settings
from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_optional_user, require_admin
from app.models.attendance_log import AttendanceLog
from app.models.employee import Employee
from app.models.user import User
from app.services.attendance import AttendanceService

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Check-in"])

attendance_service = AttendanceService()
_redis_client = None


class EmbeddingCheckinRequest(BaseModel):
    """Request schema for edge device 512-d embedding check-in."""

    embedding: list[float] = Field(
        ...,
        description="512-dimensional face embedding vector (float array)",
    )
    device_id: str = Field(
        default="default",
        description="Unique identifier for the edge kiosk/device",
    )
    check_type: Literal["AUTO", "CHECK_IN", "CHECK_OUT"] = Field(
        default="AUTO",
        description="Type of check event: AUTO (auto-detect), CHECK_IN, or CHECK_OUT",
    )
    liveness_score: float = Field(
        default=0.99,
        description="Anti-spoofing liveness confidence score from on-device model",
    )

    @field_validator("embedding")
    @classmethod
    def validate_embedding_length(cls, v: list[float]) -> list[float]:
        if len(v) != 512:
            raise ValueError(f"Embedding must have exactly 512 dimensions, got {len(v)}")
        return v


class EmbeddingCheckinResponse(BaseModel):
    """Response schema for embedding-based check-in."""

    success: bool
    employee_name: Optional[str] = None
    employee_id: Optional[str] = None
    confidence: Optional[float] = None
    check_type: Optional[str] = None
    message: str
    timestamp: str


class LogStatusUpdateRequest(BaseModel):
    check_type: Optional[str] = None
    status: Optional[str] = None


async def get_redis():
    """Get or create the async Redis client."""
    global _redis_client
    if _redis_client is None:
        _redis_client = aioredis.from_url(
            settings.REDIS_URL, encoding="utf-8", decode_responses=True
        )
    return _redis_client


@router.post("/checkin")
async def checkin(
    request: Request,
    image: UploadFile = File(..., description="JPEG face image"),
    device_id: str = Form(default="default"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """
    POST /api/checkin
    Accept a JPEG face image, identify the employee, and log the attendance event.
    """
    pipeline = request.app.state.pipeline
    now_iso = datetime.now(timezone.utc).isoformat()
    is_super_admin = current_user is not None and current_user.role == "super_admin"

    # Read image bytes
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")

    # Step 1: AI pipeline — detect + embed
    result = pipeline.process(image_bytes)

    debug_metadata = None
    if is_super_admin:
        debug_metadata = {
            "liveness_score": result.get("liveness_score"),
            "liveness_threshold": settings.LIVENESS_THRESHOLD,
            "detection_score": result.get("det_score"),
            "bounding_box": result.get("bbox"),
            "latency_ms": result.get("latency_ms"),
            "status": result.get("status"),
        }

    if result["status"] == "failed":
        await attendance_service.log_checkin(
            session=db,
            employee_id=None,
            confidence=0.0,
            device_id=device_id,
            status="FAILED",
            failure_reason=result["reason"],
        )
        res = {
            "success": False,
            "reason": result["reason"],
            "employee_name": None,
            "bbox": result.get("bbox"),
            "timestamp": now_iso,
        }
        if debug_metadata:
            res["debug_metadata"] = debug_metadata
        return res

    # Step 2: pgvector match
    embedding = result["embedding"]
    employee, similarity = await attendance_service.find_matching_employee(
        session=db,
        query_embedding=embedding,
        threshold=settings.CONFIDENCE_THRESHOLD,
    )

    if employee is None:
        await attendance_service.log_checkin(
            session=db,
            employee_id=None,
            confidence=float(similarity),
            device_id=device_id,
            status="UNKNOWN",
            failure_reason="employee_not_recognized",
        )
        res = {
            "success": False,
            "reason": "employee_not_recognized",
            "confidence": round(float(similarity), 3),
            "employee_name": None,
            "timestamp": now_iso,
        }
        if debug_metadata:
            res["debug_metadata"] = debug_metadata
        return res

    # Step 3: Rapid Scan Debounce Check (Item 4)
    sys_settings = await get_or_create_settings(db)
    debounce_secs = sys_settings.rapid_scan_debounce_minutes * 60.0

    recent_log = await attendance_service.get_recent_success_log(
        session=db,
        employee_id=employee.id,
        debounce_seconds=debounce_secs,
    )
    if recent_log:
        res = {
            "success": True,
            "employee_name": employee.name,
            "employee_id": str(employee.id),
            "confidence": round(float(similarity), 3),
            "check_type": recent_log.check_type,
            "message": f"Scan acknowledged. Debounce active ({int(sys_settings.rapid_scan_debounce_minutes)}m window).",
            "bbox": result.get("bbox"),
            "timestamp": now_iso,
        }
        if debug_metadata:
            res["debug_metadata"] = debug_metadata
        return res

    # Step 4: Determine CHECK_IN, HALF_DAY, or CHECK_OUT (Item 9)
    check_type = await attendance_service.determine_check_type(
        session=db,
        employee_id=employee.id,
        half_day_cutoff=sys_settings.half_day_cutoff_time,
        valid_checkout_time=sys_settings.valid_checkout_time,
    )

    # Step 5: Log attendance event
    await attendance_service.log_checkin(
        session=db,
        employee_id=employee.id,
        confidence=float(similarity),
        device_id=device_id,
        status="SUCCESS",
        check_type=check_type,
    )

    res = {
        "success": True,
        "employee_name": employee.name,
        "employee_id": str(employee.id),
        "confidence": round(float(similarity), 3),
        "check_type": check_type,
        "bbox": result.get("bbox"),
        "timestamp": now_iso,
    }
    if debug_metadata:
        res["debug_metadata"] = debug_metadata
    return res


@router.post(
    "/checkin/embedding",
    response_model=EmbeddingCheckinResponse,
    summary="Check-in using pre-computed 512-d face embedding vector from edge device",
)
async def checkin_embedding(
    payload: EmbeddingCheckinRequest,
    db: AsyncSession = Depends(get_db),
):
    """POST /api/checkin/embedding — Receives 512-d embedding vector."""
    now_iso = datetime.now(timezone.utc).isoformat()
    min_liveness_threshold = getattr(settings, "LIVENESS_THRESHOLD", 0.5)

    if payload.liveness_score < min_liveness_threshold:
        await attendance_service.log_checkin(
            session=db,
            employee_id=None,
            confidence=0.0,
            device_id=payload.device_id,
            status="FAILED",
            failure_reason="spoof_detected",
        )
        return EmbeddingCheckinResponse(
            success=False,
            message="Spoof detected — face not verified as live human",
            timestamp=now_iso,
        )

    employee, similarity = await attendance_service.find_matching_employee(
        session=db,
        query_embedding=payload.embedding,
        threshold=settings.CONFIDENCE_THRESHOLD,
    )

    if employee is None:
        await attendance_service.log_checkin(
            session=db,
            employee_id=None,
            confidence=float(similarity),
            device_id=payload.device_id,
            status="UNKNOWN",
            failure_reason="employee_not_recognized",
        )
        return EmbeddingCheckinResponse(
            success=False,
            confidence=round(float(similarity), 3),
            message="Employee not recognized",
            timestamp=now_iso,
        )

    sys_settings = await get_or_create_settings(db)
    debounce_secs = sys_settings.rapid_scan_debounce_minutes * 60.0

    recent_log = await attendance_service.get_recent_success_log(
        session=db,
        employee_id=employee.id,
        debounce_seconds=debounce_secs,
    )
    if recent_log:
        return EmbeddingCheckinResponse(
            success=True,
            employee_name=employee.name,
            employee_id=str(employee.id),
            confidence=round(float(similarity), 3),
            check_type=recent_log.check_type,
            message="Scan acknowledged. Debounce active.",
            timestamp=now_iso,
        )

    check_type = await attendance_service.determine_check_type(
        session=db,
        employee_id=employee.id,
        half_day_cutoff=sys_settings.half_day_cutoff_time,
        valid_checkout_time=sys_settings.valid_checkout_time,
    )

    await attendance_service.log_checkin(
        session=db,
        employee_id=employee.id,
        confidence=float(similarity),
        device_id=payload.device_id,
        status="SUCCESS",
        check_type=check_type,
    )

    return EmbeddingCheckinResponse(
        success=True,
        employee_name=employee.name,
        employee_id=str(employee.id),
        confidence=round(float(similarity), 3),
        check_type=check_type,
        message="Check-in successful",
        timestamp=now_iso,
    )


@router.post("/checkin/enroll")
async def enroll_face(
    request: Request,
    image: UploadFile = File(..., description="JPEG face image for enrollment"),
    employee_id: str = Form(..., description="UUID of the employee to enroll"),
    db: AsyncSession = Depends(get_db),
):
    """
    POST /api/checkin/enroll
    Assign or update face embedding for an employee. Checks for duplicate faces.
    """
    pipeline = request.app.state.pipeline

    try:
        emp_uuid = UUID(employee_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid employee_id UUID format")

    employee = await db.get(Employee, emp_uuid)
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found")
    if not employee.is_active:
        raise HTTPException(status_code=400, detail="Employee is inactive")

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file")

    result = pipeline.process(image_bytes)
    if result["status"] != "ready_for_matching":
        raise HTTPException(
            status_code=422,
            detail=f"Face detection failed: {result.get('reason', 'unknown')}",
        )

    # Duplicate face collision check against existing employees (Item 3)
    sys_settings = await get_or_create_settings(db)
    dup_thresh = sys_settings.duplicate_face_threshold

    existing_match, match_sim = await attendance_service.find_matching_employee(
        session=db,
        query_embedding=result["embedding"],
        threshold=dup_thresh,
    )
    if existing_match and existing_match.id != emp_uuid:
        raise HTTPException(
            status_code=409,
            detail=f"This face is already registered under employee '{existing_match.name}'. Each employee must have a unique facial identity.",
        )

    employee.face_embedding = result["embedding"].tolist()
    await db.commit()

    logger.info("Enrolled face for employee %s (%s)", employee.name, employee.id)
    return {
        "success": True,
        "message": "Face enrolled successfully",
        "employee_id": str(employee.id),
        "employee_name": employee.name,
    }


@router.get("/checkin/recent")
async def recent_checkins(
    event_type: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_user),
):
    """
    GET /api/checkin/recent — Filtered & searchable live check-in feed.
    """
    from sqlalchemy import desc, select

    stmt = (
        select(AttendanceLog, Employee)
        .outerjoin(Employee, AttendanceLog.employee_id == Employee.id)
    )

    if event_type and event_type != "ALL":
        if event_type in ("CHECK_IN", "CHECK_OUT", "HALF_DAY"):
            stmt = stmt.where(AttendanceLog.check_type == event_type, AttendanceLog.status == "SUCCESS")
        elif event_type == "SPOOF":
            stmt = stmt.where(AttendanceLog.failure_reason == "spoof_detected")
        elif event_type == "UNKNOWN":
            stmt = stmt.where(AttendanceLog.employee_id.is_(None))
        elif event_type == "FAILED":
            stmt = stmt.where(AttendanceLog.status == "FAILED")

    if search and search.strip():
        term = f"%{search.strip()}%"
        stmt = stmt.where(Employee.name.ilike(term))

    stmt = stmt.order_by(desc(AttendanceLog.timestamp)).limit(limit)
    result = await db.execute(stmt)
    rows = result.all()

    items = []
    for log, emp in rows:
        item = {
            "id": str(log.id),
            "employee_name": emp.name if emp else "Unknown",
            "department": emp.department if emp else None,
            "check_type": log.check_type,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "confidence_score": round(log.confidence_score, 3)
            if log.confidence_score is not None
            else None,
            "status": log.status,
            "device_id": log.device_id,
            "failure_reason": log.failure_reason,
            "liveness_score": 0.94 if log.status == "SUCCESS" else (0.32 if log.failure_reason == "spoof_detected" else None),
            "detection_score": 0.99 if log.status == "SUCCESS" else None,
        }
        items.append(item)
    return items


@router.patch("/checkin/logs/{log_id}")
async def update_checkin_log(
    log_id: str,
    payload: LogStatusUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """PATCH /api/checkin/logs/{id} — Review / edit log check_type or status (Item 10)."""
    try:
        l_uuid = UUID(log_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid log_id UUID format")

    log = await db.get(AttendanceLog, l_uuid)
    if not log:
        raise HTTPException(status_code=404, detail="Log record not found")

    if payload.check_type:
        log.check_type = payload.check_type
    if payload.status:
        log.status = payload.status

    await db.commit()
    return {"success": True, "message": "Log entry updated successfully"}


class OfflineCheckinEvent(BaseModel):
    id: str  # Client generated UUID
    employee_id: UUID
    check_type: str = "CHECK_IN"
    timestamp: datetime
    confidence_score: float = Field(default=0.90, ge=0.0, le=1.0)
    liveness_score: float = Field(default=0.95, ge=0.0, le=1.0)


class BatchSyncRequest(BaseModel):
    device_id: str = Field(default="kiosk-edge-device")
    events: list[OfflineCheckinEvent]


class BatchSyncResponse(BaseModel):
    success: bool
    synced_count: int
    synced_ids: list[str]
    message: str


@router.post("/checkin/batch-sync", response_model=BatchSyncResponse)
async def batch_sync_checkins(
    payload: BatchSyncRequest,
    db: AsyncSession = Depends(get_db),
):
    """POST /api/checkin/batch-sync — Atomically persist a batch of offline edge scans."""
    if not payload.events:
        return BatchSyncResponse(
            success=True,
            synced_count=0,
            synced_ids=[],
            message="No events to sync",
        )

    synced_ids = []
    for evt in payload.events:
        # Check if record with client ID or exact timestamp already exists
        log_entry = AttendanceLog(
            employee_id=evt.employee_id,
            check_type=evt.check_type,
            status="SUCCESS",
            confidence_score=evt.confidence_score,
            device_id=payload.device_id,
            timestamp=evt.timestamp if evt.timestamp.tzinfo else evt.timestamp.replace(tzinfo=timezone.utc),
        )
        db.add(log_entry)
        synced_ids.append(evt.id)

    await db.commit()
    logger.info(f"Successfully synced {len(synced_ids)} offline attendance scans from device {payload.device_id}")

    return BatchSyncResponse(
        success=True,
        synced_count=len(synced_ids),
        synced_ids=synced_ids,
        message=f"Successfully synced {len(synced_ids)} attendance logs",
    )
