# Attendance Tracker — Project Brief

## Stack
- Backend: Python 3.11, FastAPI, SQLAlchemy, Alembic, Celery
- AI pipeline: InsightFace (ArcFace + SCRFD), MiniFASNetV2-SE liveness, ONNX Runtime
- Database: PostgreSQL (existing local install, port 5432) + pgvector extension
- Cache / queue broker: Redis (Docker container, port 6379)
- Object storage: Minio (Docker container, ports 9000/9001)
- Frontend: Next.js 14 — runs INSIDE Docker, no local Node needed
- Reverse proxy: Nginx (Docker container)

## Scale
200 employees. Single office. 1 kiosk device + mobile app + admin web panel.

## Folder structure
attendance-tracker/
├── PROJECT_BRIEF.md
├── docker-compose.yml
├── .env / .env.example
├── backend/          ← FastAPI app + AI pipeline
│   ├── app/
│   │   ├── main.py
│   │   ├── api/       ← route handlers
│   │   ├── services/  ← business logic
│   │   ├── ai/        ← detector.py, recognizer.py, liveness.py
│   │   ├── models/    ← SQLAlchemy ORM models
│   │   └── core/      ← config, auth, utils
│   ├── alembic/
│   ├── requirements.txt
│   └── tests/
├── frontend/         ← Next.js (containerized)
└── models/           ← ONNX weights (git-ignored)

## Key rules for agents
- All Python runs in backend/venv (activate with: source backend/venv/bin/activate)
- Never install packages globally
- Never hardcode secrets — always use .env
- Use async/await throughout FastAPI
- PostgreSQL connection string from env var DATABASE_URL
- All Docker services defined in root docker-compose.yml
