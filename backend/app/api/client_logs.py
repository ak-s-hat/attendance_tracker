"""Client diagnostics log ingestion and query endpoints."""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import require_admin
from app.models.client_log import ClientLog
from app.models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Diagnostics"])

MAX_MESSAGE_CHARS = 2000
MAX_DATA_CHARS = 20000
RETENTION_DAYS = 14


class ClientLogItem(BaseModel):
    client_log_id: int
    ts: datetime
    level: str = Field(max_length=10)
    tag: str = Field(max_length=20)
    trace_id: Optional[str] = Field(default=None, max_length=64)
    message: str
    data: Optional[Any] = None


class ClientLogBatch(BaseModel):
    device_id: str = Field(min_length=1, max_length=100)
    app_version: Optional[str] = Field(default=None, max_length=30)
    logs: List[ClientLogItem] = Field(max_length=1000)


def _cap_data(data: Any) -> Any:
    if data is None:
        return None
    try:
        encoded = json.dumps(data)
    except (TypeError, ValueError):
        return {"unserializable": True}
    if len(encoded) > MAX_DATA_CHARS:
        return {"truncated": True, "preview": encoded[:MAX_DATA_CHARS]}
    return data


@router.post("/client-logs")
async def ingest_client_logs(batch: ClientLogBatch, db: AsyncSession = Depends(get_db)):
    """Store a batch of device log entries. Idempotent per (device_id, client_log_id)."""
    if not batch.logs:
        return {"accepted": 0}

    rows = [
        {
            "device_id": batch.device_id,
            "app_version": batch.app_version,
            "client_log_id": item.client_log_id,
            "ts": item.ts,
            "level": item.level,
            "tag": item.tag,
            "trace_id": item.trace_id or None,
            "message": item.message[:MAX_MESSAGE_CHARS],
            "data": _cap_data(item.data),
        }
        for item in batch.logs
    ]
    stmt = insert(ClientLog).values(rows).on_conflict_do_nothing(constraint="uq_client_logs_device_entry")
    await db.execute(stmt)

    # Keep the table small on the free tier
    cutoff = datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    await db.execute(delete(ClientLog).where(ClientLog.ts < cutoff))
    await db.commit()

    errors = sum(1 for r in rows if r["level"] == "error")
    if errors:
        logger.warning("client-logs: device=%s uploaded %d entries (%d errors)", batch.device_id, len(rows), errors)
    return {"accepted": len(rows)}


@router.get("/client-logs")
async def list_client_logs(
    device_id: Optional[str] = None,
    tag: Optional[str] = None,
    level: Optional[str] = None,
    trace_id: Optional[str] = None,
    since: Optional[datetime] = None,
    limit: int = Query(200, ge=1, le=2000),
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Query the uploaded device log trail (newest first)."""
    stmt = select(ClientLog)
    if device_id:
        stmt = stmt.where(ClientLog.device_id == device_id)
    if tag:
        stmt = stmt.where(ClientLog.tag == tag.upper())
    if level:
        stmt = stmt.where(ClientLog.level == level.lower())
    if trace_id:
        stmt = stmt.where(ClientLog.trace_id == trace_id)
    if since:
        stmt = stmt.where(ClientLog.ts >= since)
    stmt = stmt.order_by(ClientLog.ts.desc()).limit(limit)

    result = await db.execute(stmt)
    return [
        {
            "device_id": r.device_id,
            "app_version": r.app_version,
            "ts": r.ts.isoformat(),
            "level": r.level,
            "tag": r.tag,
            "trace_id": r.trace_id,
            "message": r.message,
            "data": r.data,
        }
        for r in result.scalars().all()
    ]
