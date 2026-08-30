"""Employee ORM model."""

from typing import Optional
from uuid import uuid4

from sqlalchemy import Boolean, Float, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.models.base import Base, TimestampMixin


class Employee(TimestampMixin, Base):
    """An employee who can be enrolled for face-based attendance."""

    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(
        String(200), unique=True, nullable=True, index=True
    )
    department: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    job_title: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    face_embedding: Mapped[Optional[list]] = mapped_column(
        Vector(512), nullable=True
    )
    enrollment_photo_key: Mapped[Optional[str]] = mapped_column(
        String(500), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    leave_balance: Mapped[float] = mapped_column(
        Float, default=15.0, nullable=False, server_default="15.0"
    )
    work_start_time: Mapped[Optional[str]] = mapped_column(
        String(5), default="09:00", nullable=True, server_default="09:00"
    )

    # Relationships
    attendance_logs = relationship(
        "AttendanceLog", back_populates="employee", lazy="selectin"
    )
    user = relationship("User", back_populates="employee", uselist=False)

