"""AttendanceLog ORM model."""

import uuid
from typing import Optional
from uuid import uuid4

from sqlalchemy import DateTime, Enum, Float, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class AttendanceLog(TimestampMixin, Base):
    """A single check-in or check-out event for an employee."""

    __tablename__ = "attendance_logs"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    employee_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("employees.id"),
        nullable=True,
        index=True,
    )
    check_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="CHECK_IN",
    )
    timestamp: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    confidence_score: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )
    device_id: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="SUCCESS",
        server_default="SUCCESS",
    )
    failure_reason: Mapped[Optional[str]] = mapped_column(
        String(200), nullable=True
    )

    # Relationships
    employee = relationship("Employee", back_populates="attendance_logs")
