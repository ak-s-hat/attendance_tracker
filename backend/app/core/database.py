"""Async SQLAlchemy database engine, session factory, and FastAPI dependency."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False, poolclass=NullPool)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db():
    """FastAPI dependency — yields an async database session."""
    async with AsyncSessionLocal() as session:
        yield session


async def create_all_tables():
    """Create all tables from metadata and ensure schema alterations are applied."""
    from app.models.base import Base  # noqa: local import to avoid circular

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Apply non-destructive schema migrations for existing tables if needed
        await conn.execute(
            text(
                "ALTER TABLE employees ADD COLUMN IF NOT EXISTS leave_balance FLOAT DEFAULT 15.0;"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE employees ADD COLUMN IF NOT EXISTS work_start_time VARCHAR(5) DEFAULT '09:00';"
            )
        )
