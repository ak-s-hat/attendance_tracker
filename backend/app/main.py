"""FastAPI application entry point."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.ai.pipeline import AttendancePipeline
from app.api import attendance, auth, checkin, employees, registration, settings as settings_api, users

logger = logging.getLogger(__name__)

pipeline = AttendancePipeline()



async def _startup_health_checks():
    """Log the status of all external dependencies on startup."""
    from app.core.database import engine
    from app.core.config import settings
    import redis.asyncio as aioredis
    from sqlalchemy import text

    # DB check
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        logger.info("✅ DB connected")
    except Exception as e:
        logger.warning("❌ DB connection failed: %s", e)

    # pgvector check
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT '[1,2,3]'::vector"))
        logger.info("✅ pgvector available")
    except Exception as e:
        logger.warning(
            "❌ pgvector extension missing — run: CREATE EXTENSION vector | %s", e
        )

    # Redis check
    try:
        r = aioredis.from_url(settings.REDIS_URL)
        await r.ping()
        await r.aclose()
        logger.info("✅ Redis connected")
    except Exception as e:
        logger.warning("❌ Redis not reachable: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load AI models and run health checks at startup."""
    # Run dependency health checks first (non-fatal)
    await _startup_health_checks()

    # Load AI models
    try:
        pipeline.load_models()
        app.state.pipeline = pipeline
        logger.info("✅ AI models loaded")
    except Exception as e:
        logger.error("❌ Model load failed: %s", e)
        app.state.pipeline = pipeline  # still attach even if failed

    yield


app = FastAPI(
    title="Attendance Tracker API",
    description="AI-powered attendance tracking system with face recognition",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(checkin.router, prefix="/api")
app.include_router(employees.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(registration.router, prefix="/api")
app.include_router(registration.router)  # Also serves / and /register directly
app.include_router(attendance.router, prefix="/api")
app.include_router(settings_api.router, prefix="/api")
app.include_router(users.router, prefix="/api")


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)


@app.get("/health", tags=["Health"])
async def health():
    """Health check endpoint — returns service status and model load state."""
    return {"status": "ok", "models_loaded": pipeline._loaded}

