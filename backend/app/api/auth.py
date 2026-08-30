"""Authentication endpoints: login & registration."""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    create_access_token,
    get_password_hash,
    verify_password,
)
from app.models.employee import Employee
from app.models.user import RegistrationToken, User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: str
    employee_id: Optional[str] = None


class RegisterRequest(BaseModel):
    username: str
    password: str
    employee_id: Optional[str] = None
    registration_token: Optional[str] = None


@router.post("/auth/login", response_model=LoginResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """POST /api/auth/login — Authenticate user and issue JWT token."""
    stmt = select(User).where(User.username == payload.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token_data = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
    }
    access_token = create_access_token(data=token_data)

    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        role=user.role,
        user_id=str(user.id),
        employee_id=str(user.employee_id) if user.employee_id else None,
    )


@router.post("/auth/register", status_code=201)
async def register(payload: RegisterRequest, db: AsyncSession = Depends(get_db)):
    """POST /api/auth/register — Register a new user account."""
    # Check for existing username
    existing_stmt = select(User).where(User.username == payload.username)
    existing_res = await db.execute(existing_stmt)
    if existing_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Username '{payload.username}' is already taken",
        )

    # Optional: validate registration token if provided
    if payload.registration_token:
        tok_stmt = select(RegistrationToken).where(
            RegistrationToken.token == payload.registration_token,
            RegistrationToken.is_used == False,
        )
        tok_res = await db.execute(tok_stmt)
        token_rec = tok_res.scalar_one_or_none()
        
        now = datetime.now(timezone.utc)
        exp_time = token_rec.expires_at if token_rec else None
        if exp_time and exp_time.tzinfo is None:
            exp_time = exp_time.replace(tzinfo=timezone.utc)

        if not token_rec or (exp_time and exp_time < now):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or expired registration token",
            )
        token_rec.is_used = True
        token_rec.used_at = now

    emp_uuid = None
    if payload.employee_id:
        try:
            emp_uuid = UUID(payload.employee_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid employee_id UUID format")
        
        emp_obj = await db.get(Employee, emp_uuid)
        if not emp_obj:
            raise HTTPException(status_code=404, detail="Referenced employee not found")

    user = User(
        username=payload.username,
        password_hash=get_password_hash(payload.password),
        role="employee",
        employee_id=emp_uuid,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    logger.info("User '%s' registered with role '%s'", user.username, user.role)
    return {"message": "User registered successfully", "user_id": str(user.id)}
