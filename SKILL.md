---
name: attendance-tracker-project
description: "Load this skill for EVERY task in the attendance_tracker project. Contains environment rules, stack decisions, Windows constraints, folder layout, and coding conventions. If you are working on anything inside attendance_tracker/, read this first — no exceptions."
---

# Attendance Tracker — Agent Skill File

## 1. Environment Rules (CRITICAL — READ FIRST)

### OS: Windows — Terminal is SANDBOXED
- The `run_command` tool is BLOCKED on this machine.
- **NEVER attempt to run terminal commands directly.**
- **ALWAYS write commands to `run_me.ps1`** at the project root.
- The human runs `run_me.ps1` manually in PowerShell after you finish writing files.
- Shell is **PowerShell** — use PowerShell syntax always:
  - Path separator: `\` not `/`
  - Activate venv: `.\backend\venv\Scripts\activate`
  - NOT: `source backend/venv/bin/activate` (that is bash — wrong on Windows)
  - Line continuation: backtick not backslash

### run_me.ps1 — the contract
- ALWAYS append to it, never overwrite.
- ALWAYS add a section comment header before your commands.
- Use this exact format every time:

# ============================================================
# PHASE X — Description of what this block does
# Run from: attendance_tracker\ root directory in PowerShell
# ============================================================
# Step 1: description
.\backend\venv\Scripts\activate

- The file already exists. Check it before writing to avoid duplicate sections.

### Python venv — ONE venv only
- Location: backend\venv\ — THE ONLY venv. No others exist or should be created.
- Activate: .\backend\venv\Scripts\activate
- Pip: .\backend\venv\Scripts\pip
- Python: .\backend\venv\Scripts\python
- NEVER run `python -m venv` anywhere. The venv already exists with all packages.
- NEVER pip install globally.

### Docker
- Docker Desktop is installed and running.
- Existing services: redis (6379), minio (9000/9001), frontend (3000), nginx (80)
- Backend FastAPI runs on HOST — NOT in Docker — on port 8000
- PostgreSQL runs on HOST on port 5432

---

## 2. Known Windows Gotchas — Handle These Proactively

### InsightFace model download path
InsightFace downloads to C:\Users\<username>\.insightface by default.
Always redirect to the project models/ folder using the root parameter:

CORRECT:
  from pathlib import Path
  MODELS_DIR = Path(__file__).resolve().parents[4] / "models"
  app = FaceAnalysis(name="buffalo_l", root=str(MODELS_DIR))

WRONG (omitting root):
  app = FaceAnalysis(name="buffalo_l")

### pgvector SQLAlchemy — exact import
CORRECT:
  from pgvector.sqlalchemy import Vector
  face_embedding: Mapped[Optional[list]] = mapped_column(Vector(512), nullable=True)

WRONG:
  from sqlalchemy import Vector  # does not exist

### pgvector cosine search — exact query pattern
  from sqlalchemy import select
  stmt = (
      select(Employee,
             (1 - Employee.face_embedding.cosine_distance(query_vector)).label("similarity"))
      .where(Employee.face_embedding.isnot(None))
      .where(Employee.is_active == True)
      .order_by(Employee.face_embedding.cosine_distance(query_vector))
      .limit(1)
  )
  result = await session.execute(stmt)
  row = result.first()
  if row:
      employee, similarity = row

### Alembic uses psycopg2 NOT asyncpg — CRITICAL
The app uses asyncpg (async) but Alembic MUST use psycopg2 (sync).
In alembic/env.py always convert the URL:

  from app.core.config import settings
  url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
  config.set_main_option("sqlalchemy.url", url)

Never pass an asyncpg URL to alembic — it will hang forever.

### numpy array must be converted to list for pgvector storage
CORRECT:
  employee.face_embedding = embedding.tolist()

WRONG:
  employee.face_embedding = embedding  # numpy array — raises type error

### query vector must also be a plain list
  query_vector = embedding.tolist()  # convert numpy to list before passing to cosine_distance

---

## 3. Project Stack

Layer            | Technology              | Notes
-----------------|-------------------------|----------------------------------------
Language         | Python 3.11             | Everything backend is Python
API              | FastAPI                 | All routes async def
ORM              | SQLAlchemy 2.0          | Async mode, AsyncSession
DB driver (app)  | asyncpg                 | Async PostgreSQL for the running app
DB driver (alembic)| psycopg2-binary       | Sync, migrations only
Migrations       | Alembic                 | backend/alembic.ini
Face detection   | InsightFace buffalo_l   | SCRFD — auto-downloads ~300MB on first run
Face recognition | ArcFace R50             | Bundled in buffalo_l — no separate install
Embedding dims   | 512                     | Vector(512) column in pgvector
Liveness         | MiniFASNetV2-SE         | V2 ONLY — V1 uses always-pass stub
Vector search    | pgvector                | Extension on existing local PostgreSQL
Cache            | Redis 7                 | Docker container, port 6379
Object storage   | Minio                   | Docker container, port 9000
Frontend         | Next.js 14              | Runs in Docker container, port 3000
Auth             | JWT via python-jose     | Admin panel only — NOT on /checkin in V1

---

## 4. Folder Structure

attendance_tracker/
├── run_me.ps1                    ALL terminal commands go here — append only
├── SKILL.md                      this file
├── PROJECT_BRIEF.md
├── .env                          real secrets — git ignored
├── .env.example                  template — committed
├── docker-compose.yml
├── nginx/
│   └── nginx.conf
│
├── backend/
│   ├── venv/                     THE only Python venv
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py                imports models, uses psycopg2 URL
│   │   └── versions/             migration files land here
│   └── app/
│       ├── main.py               FastAPI entry, lifespan, router mounts
│       ├── core/
│       │   ├── config.py         pydantic BaseSettings loads .env
│       │   ├── database.py       async engine, AsyncSession, get_db()
│       │   └── auth.py           JWT helpers
│       ├── models/
│       │   ├── base.py           DeclarativeBase + TimestampMixin
│       │   ├── employee.py       Employee with Vector(512)
│       │   └── attendance.py     AttendanceLog
│       ├── ai/
│       │   ├── detector.py       FaceDetector — InsightFace SCRFD
│       │   ├── recognizer.py     FaceRecognizer — ArcFace via buffalo_l
│       │   ├── liveness.py       LivenessChecker — V1 always-pass stub
│       │   └── pipeline.py       AttendancePipeline — orchestrates all three
│       ├── api/
│       │   ├── checkin.py        POST /api/checkin and /api/checkin/enroll
│       │   └── employees.py      GET POST DELETE /api/employees
│       └── services/
│           └── attendance.py     find_matching_employee(), log_checkin()
│
├── frontend/
│   ├── Dockerfile
│   └── [Next.js app files]
│
└── models/
    └── buffalo_l/                InsightFace weights download here automatically

---

## 5. .env Variables — Full Reference

DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/attendance_db
REDIS_URL=redis://localhost:6379/0
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=attendance-photos
JWT_SECRET_KEY=changeme_use_openssl_rand_hex_32
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=480
WORK_START_TIME=09:00
CONFIDENCE_THRESHOLD=0.6

---

## 6. Core Code Patterns — Copy These Exactly

### main.py structure
  from contextlib import asynccontextmanager
  from fastapi import FastAPI
  from fastapi.middleware.cors import CORSMiddleware
  from app.ai.pipeline import AttendancePipeline
  from app.api import checkin, employees

  pipeline = AttendancePipeline()

  @asynccontextmanager
  async def lifespan(app: FastAPI):
      pipeline.load_models()
      app.state.pipeline = pipeline
      yield

  app = FastAPI(title="Attendance Tracker API", lifespan=lifespan)
  app.add_middleware(CORSMiddleware, allow_origins=["*"],
                     allow_methods=["*"], allow_headers=["*"])
  app.include_router(checkin.router, prefix="/api")
  app.include_router(employees.router, prefix="/api")

  @app.get("/health")
  async def health():
      return {"status": "ok", "models_loaded": pipeline._loaded}

### database.py pattern
  from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
  from app.core.config import settings

  engine = create_async_engine(settings.DATABASE_URL, echo=False)
  AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

  async def get_db():
      async with AsyncSessionLocal() as session:
          yield session

### config.py pattern
  from pydantic_settings import BaseSettings

  class Settings(BaseSettings):
      DATABASE_URL: str
      REDIS_URL: str = "redis://localhost:6379/0"
      JWT_SECRET_KEY: str = "dev-secret-change-me"
      JWT_ALGORITHM: str = "HS256"
      CONFIDENCE_THRESHOLD: float = 0.6

      class Config:
          env_file = ".env"
          env_file_encoding = "utf-8"

  settings = Settings()

### Image bytes to OpenCV numpy array
  import cv2
  import numpy as np

  def bytes_to_cv2(image_bytes: bytes):
      arr = np.frombuffer(image_bytes, np.uint8)
      img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
      if img is None:
          raise ValueError("Could not decode image — check JPEG format")
      return img

---

## 7. V1 Scope

### BUILD in V1
- POST /api/checkin — JPEG in, employee name out, target under 1 second
- POST /api/checkin/enroll — assign a face to an existing employee
- GET /api/checkin/recent — last 20 check-in events
- GET POST DELETE /api/employees — manage employee records
- DB models: Employee (with Vector(512)), AttendanceLog
- AI pipeline: detect face, get embedding, cosine match against DB
- Liveness: stub only — always returns is_live=True
- Startup health check logging: DB, Redis, pgvector
- Duplicate check-in guard: Redis key with 10-second TTL
- /health endpoint

### DO NOT BUILD in V1
- Real liveness / MiniFASNetV2-SE — that is V2
- Analytics, morale index, punctuality scores — V2
- Celery background jobs — V2
- JWT auth on /api/checkin — V2
- Mobile app — V2
- Notification service — V2

---

## 8. Current State of the Project

File or Item              | Status    | Notes
--------------------------|-----------|------------------------------------------
backend/venv/             | DONE      | All packages installed
requirements.txt          | DONE      | Complete
docker-compose.yml        | DONE      | redis minio frontend nginx
.env and .env.example     | DONE      | Check DATABASE_URL is set correctly
app/main.py               | DONE      | Minimal, has /health
app/core/config.py        | DONE      | pydantic-settings working
alembic initialized       | DONE      | env.py not wired to models yet
nginx/nginx.conf          | DONE      |
app/models/               | NOT DONE  | Only empty __init__.py
app/ai/                   | NOT DONE  | Only empty __init__.py
app/api/                  | NOT DONE  | Only empty __init__.py
app/services/             | NOT DONE  | Only empty __init__.py
alembic/versions/         | NOT DONE  | No migrations generated yet
pgvector extension in PG  | UNKNOWN   | Needs manual psql command
Next.js app               | NOT DONE  | Only Dockerfile exists no package.json