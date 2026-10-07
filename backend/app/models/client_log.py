"""ClientLog ORM model — diagnostic log trail uploaded by mobile kiosks."""

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ClientLog(Base):
    """One log entry from a device (scan trace, API call, sync event, crash)."""

    __tablename__ = "client_logs"
    __table_args__ = (
        # Re-uploads after a lost response are dropped instead of duplicated
        UniqueConstraint("device_id", "client_log_id", name="uq_client_logs_device_entry"),
        Index("ix_client_logs_device_ts", "device_id", "ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(100), nullable=False)
    app_version: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    client_log_id: Mapped[int] = mapped_column(Integer, nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    tag: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    trace_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
