"""AttendanceService — pgvector matching and check-in logging."""

import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.attendance_log import AttendanceLog

logger = logging.getLogger(__name__)


class AttendanceService:
    """Business logic for face matching and attendance logging."""

    async def find_matching_employee(
        self,
        session: AsyncSession,
        query_embedding: np.ndarray | list[float],
        threshold: float = 0.6,
    ) -> tuple[Employee | None, float]:
        """
        Find the closest enrolled employee using pgvector cosine distance.

        Args:
            session: async DB session
            query_embedding: L2-normalized 512-d numpy array or float list
            threshold: minimum cosine similarity to accept as a match (default 0.6)

        Returns:
            (employee, similarity) if match found, (None, best_similarity) otherwise
        """
        # SKILL.md rule: numpy array → list before passing to cosine_distance
        query_vector = (
            query_embedding.tolist()
            if isinstance(query_embedding, np.ndarray)
            else query_embedding
        )

        stmt = (
            select(
                Employee,
                (1 - Employee.face_embedding.cosine_distance(query_vector)).label(
                    "similarity"
                ),
            )
            .where(Employee.face_embedding.isnot(None))
            .where(Employee.is_active == True)  # noqa: E712
            .order_by(Employee.face_embedding.cosine_distance(query_vector))
            .limit(1)
        )

        result = await session.execute(stmt)
        row = result.first()

        if not row:
            logger.info("find_matching_employee: no enrolled employees found")
            return None, 0.0

        employee, similarity = row
        similarity = float(similarity)
        logger.info(
            "find_matching_employee: best match=%s similarity=%.4f threshold=%.2f",
            employee.name,
            similarity,
            threshold,
        )

        if similarity < threshold:
            return None, similarity

        return employee, similarity

    async def get_recent_success_log(
        self,
        session: AsyncSession,
        employee_id: UUID,
        debounce_seconds: float = 120.0,
    ) -> AttendanceLog | None:
        """Check if a successful checkin log occurred within debounce window."""
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=debounce_seconds)
        stmt = (
            select(AttendanceLog)
            .where(AttendanceLog.employee_id == employee_id)
            .where(AttendanceLog.status == "SUCCESS")
            .where(AttendanceLog.timestamp >= cutoff)
            .order_by(AttendanceLog.timestamp.desc())
            .limit(1)
        )
        res = await session.execute(stmt)
        return res.scalar_one_or_none()

    async def determine_check_type(
        self,
        session: AsyncSession,
        employee_id: UUID,
        half_day_cutoff: str = "13:00",
        valid_checkout_time: str = "17:00",
    ) -> str:
        """
        Determine CHECK_IN, CHECK_OUT, or HALF_DAY based on last log and time cutoffs.
        """
        now = datetime.now(timezone.utc)
        start_of_day = now.replace(
            hour=0, minute=0, second=0, microsecond=0
        )

        stmt = (
            select(AttendanceLog)
            .where(AttendanceLog.employee_id == employee_id)
            .where(AttendanceLog.status == "SUCCESS")
            .where(AttendanceLog.timestamp >= start_of_day)
            .order_by(AttendanceLog.timestamp.desc())
            .limit(1)
        )
        result = await session.execute(stmt)
        last_log = result.scalar_one_or_none()

        if not last_log or last_log.check_type not in ("CHECK_IN", "HALF_DAY"):
            return "CHECK_IN"

        # Check half-day cutoff window
        try:
            hh, hm = map(int, half_day_cutoff.split(":"))
            half_day_mins = hh * 60 + hm
            curr_mins = now.hour * 60 + now.minute

            if curr_mins < half_day_mins:
                return "HALF_DAY"
        except Exception:
            pass

        return "CHECK_OUT"

    async def log_checkin(
        self,
        session: AsyncSession,
        employee_id: UUID | None,
        confidence: float,
        device_id: str,
        status: str,
        check_type: str = "CHECK_IN",
        failure_reason: str | None = None,
    ) -> AttendanceLog:
        """
        Persist an AttendanceLog record. Always logs — including failed attempts.

        Args:
            session: async DB session
            employee_id: UUID of matched employee (None for failed/unknown)
            confidence: cosine similarity score
            device_id: device identifier string
            status: "SUCCESS", "FAILED", or "UNKNOWN"
            check_type: "CHECK_IN" or "CHECK_OUT"
            failure_reason: reason string for failed attempts

        Returns:
            The persisted AttendanceLog instance
        """
        log = AttendanceLog(
            id=uuid4(),
            employee_id=employee_id,
            check_type=check_type,
            confidence_score=confidence,
            device_id=device_id,
            status=status,
            failure_reason=failure_reason,
            timestamp=datetime.now(timezone.utc),
        )
        session.add(log)
        await session.commit()
        await session.refresh(log)
        logger.info(
            "log_checkin: status=%s employee_id=%s check_type=%s confidence=%.4f",
            status,
            employee_id,
            check_type,
            confidence,
        )
        return log
