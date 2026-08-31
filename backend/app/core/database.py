"""Async SQLAlchemy database engine, session factory, and FastAPI dependency."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

def _get_async_db_url(url: str) -> str:
    """Ensure DATABASE_URL uses the asyncpg driver."""
    clean = url.strip()
    if clean.startswith("postgres://"):
        return clean.replace("postgres://", "postgresql+asyncpg://", 1)
    if clean.startswith("postgresql://") and not clean.startswith("postgresql+asyncpg://"):
        return clean.replace("postgresql://", "postgresql+asyncpg://", 1)
    return clean

engine = create_async_engine(_get_async_db_url(settings.DATABASE_URL), echo=False, poolclass=NullPool)

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
        await conn.execute(
            text(
                "ALTER TABLE employees ADD COLUMN IF NOT EXISTS enrollment_photo_key VARCHAR(500);"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;"
            )
        )
        await conn.execute(
            text(
                "DO $$ BEGIN "
                "IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='registration_tokens' AND column_name='used') THEN "
                "ALTER TABLE registration_tokens RENAME COLUMN used TO is_used; "
                "END IF; "
                "END $$;"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE registration_tokens ADD COLUMN IF NOT EXISTS is_used BOOLEAN DEFAULT false;"
            )
        )
        await conn.execute(
            text(
                "ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();"
            )
        )
        await conn.execute(
            text(
                "DO $$ BEGIN "
                "IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='system_settings' AND column_name='id' AND data_type='uuid') THEN "
                "DROP TABLE system_settings CASCADE; "
                "END IF; "
                "END $$;"
            )
        )
