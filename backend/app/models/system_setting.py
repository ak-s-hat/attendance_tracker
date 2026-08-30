"""System settings ORM model for dynamic HR rules."""

from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SystemSetting(TimestampMixin, Base):
    """Dynamic system settings for HR and Kiosk rules."""

    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rapid_scan_debounce_minutes: Mapped[float] = mapped_column(Float, default=2.0, nullable=False, server_default="2.0")
    work_start_time: Mapped[str] = mapped_column(String(5), default="09:00", nullable=False, server_default="'09:00'")
    half_day_cutoff_time: Mapped[str] = mapped_column(String(5), default="13:00", nullable=False, server_default="'13:00'")
    valid_checkout_time: Mapped[str] = mapped_column(String(5), default="17:00", nullable=False, server_default="'17:00'")
    duplicate_face_threshold: Mapped[float] = mapped_column(Float, default=0.65, nullable=False, server_default="0.65")
    auto_deduct_absent_leave: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
