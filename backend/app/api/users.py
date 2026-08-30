"""User list & role promotion/demotion management."""

import logging
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import require_admin, require_super_admin
from app.models.user import User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Users"])


class RoleUpdateRequest(BaseModel):
    role: Literal["admin", "employee"]


class UserResponse(BaseModel):
    id: str
    username: str
    role: str
    employee_id: Optional[str] = None

    class Config:
        from_attributes = True


@router.get("/users", response_model=list[UserResponse])
async def list_users(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """GET /api/users — List all user accounts (Admin/Super Admin only)."""
    stmt = select(User)
    res = await db.execute(stmt)
    users = res.scalars().all()
    return [
        UserResponse(
            id=str(u.id),
            username=u.username,
            role=u.role,
            employee_id=str(u.employee_id) if u.employee_id else None,
        )
        for u in users
    ]


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    payload: RoleUpdateRequest,
    current_user: User = Depends(require_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """PATCH /api/users/{id}/role — Promote or demote user role (Super Admin only)."""
    try:
        target_uuid = UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user_id UUID format")

    if target_uuid == current_user.id:
        raise HTTPException(
            status_code=400, detail="Super Admin cannot demote their own role"
        )

    target_user = await db.get(User, target_uuid)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    target_user.role = payload.role
    await db.commit()

    logger.info("User %s role updated to %s", target_user.username, payload.role)
    return {"user_id": str(target_user.id), "role": target_user.role}
