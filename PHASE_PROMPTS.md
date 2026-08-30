# Attendance Tracker — V1 Baseline Phase Prompts
# Feed these to Antigravity Agent Manager in order.
# Wait for each phase to complete + verify before starting the next.
# Model recommendation: Claude Sonnet 4.6, Plan Mode for phases 1-3, Fast Mode for 4-5.

---

## PHASE 1 — Database foundation
### When to run: First. Nothing else works without this.
### Mode: Plan Mode
### Verification: `run_me.ps1` section runs without errors, alembic upgrade head succeeds

```
Read SKILL.md in the project root before doing anything. Follow every rule there.

Your job is to build the database foundation for the attendance tracker.
This is a Windows machine — write ALL terminal commands to run_me.ps1, never use run_command.

Create these files:

1. backend/app/models/base.py
   - SQLAlchemy declarative Base using DeclarativeBase
   - Import pgvector: from pgvector.sqlalchemy import Vector
   - A TimestampMixin with created_at and updated_at columns (both with timezone, server_default=func.now())

2. backend/app/models/employee.py
   - Employee model extending Base and TimestampMixin
   - Columns:
     id: UUID primary key, default=uuid4
     name: String(100), not null
     email: String(200), unique, not null, index=True
     department: String(100), nullable
     job_title: String(100), nullable
     face_embedding: Vector(512), nullable (null until enrolled)
     enrollment_photo_key: String(500), nullable (Minio object key)
     is_active: Boolean, default=True, not null
   - Table name: "employees"

3. backend/app/models/attendance_log.py
   - AttendanceLog model extending Base and TimestampMixin
   - Columns:
     id: UUID primary key, default=uuid4
     employee_id: UUID ForeignKey("employees.id"), not null, index=True
     check_type: SQLAlchemy Enum("CHECK_IN", "CHECK_OUT"), not null
     timestamp: DateTime(timezone=True), not null, default=func.now()
     confidence_score: Float, nullable
     device_id: String(100), nullable
     status: SQLAlchemy Enum("SUCCESS", "FAILED", "UNKNOWN"), default="SUCCESS"
     failure_reason: String(200), nullable (populated on failed attempts)
   - Table name: "attendance_logs"
   - relationship: employee = relationship("Employee", back_populates="attendance_logs")
   - Add back_populates="attendance_logs" on Employee model too

4. backend/app/models/__init__.py
   - Import and export all models: Employee, AttendanceLog, Base

5. backend/app/core/database.py
   - Async SQLAlchemy engine using asyncpg
   - Read DATABASE_URL from settings (core/config.py)
   - AsyncSessionLocal factory
   - get_db() async dependency function for FastAPI Depends()
   - create_all_tables() async function (used for testing only — production uses alembic)

6. Wire alembic to use async models:
   Edit backend/alembic/env.py:
   - Import Base from app.models
   - Import all models so autogenerate sees them
   - Set target_metadata = Base.metadata
   - Configure to read DATABASE_URL from .env using python-dotenv
   - Use synchronous psycopg2 URL for alembic (replace asyncpg with psycopg2 in URL)
     because alembic migrations run sync even if app is async

7. Edit backend/alembic.ini:
   - Set sqlalchemy.url = placeholder (env.py will override it)

8. Update backend/requirements.txt to add:
   psycopg2-binary  (needed for alembic sync migrations)

9. Write run_me.ps1 section "PHASE 1 - Database":
   # Install psycopg2 for alembic
   .\backend\venv\Scripts\pip install psycopg2-binary

   # Create the database (if it doesn't exist)
   psql -U postgres -c "CREATE DATABASE attendance_db;"

   # Enable pgvector extension
   psql -U postgres -d attendance_db -c "CREATE EXTENSION IF NOT EXISTS vector;"

   # Generate first migration
   cd backend
   .\venv\Scripts\activate
   alembic revision --autogenerate -m "initial_schema"

   # Apply migration
   alembic upgrade head

   # Verify tables exist
   psql -U postgres -d attendance_db -c "\dt"
```

---

## PHASE 2 — AI pipeline (core of V1)
### When to run: After Phase 1 is verified (tables exist in DB).
### Mode: Plan Mode
### Verification: Run test_pipeline.py manually — it should detect a face and return a 512-d vector

```
Read SKILL.md in the project root before doing anything. Follow every rule there.

Build the AI inference pipeline. This is the core of V1.
Windows machine — write commands to run_me.ps1, never use run_command.

The goal: given a JPEG image, return a 512-d face embedding vector.
Latency target: detect + embed in under 300ms on CPU.

Create these files:

1. backend/app/ai/detector.py
   Class: FaceDetector

   __init__(self):
     self.app = None  (loaded lazily)
     self.model_name = "buffalo_l"

   load(self):
     from insightface.app import FaceAnalysis
     self.app = FaceAnalysis(name=self.model_name, root="../../models")
     self.app.prepare(ctx_id=-1, det_size=(640, 640))
     # ctx_id=-1 = CPU. ctx_id=0 = GPU. Use CPU for now.

   detect(self, image_bytes: bytes) -> dict:
     # Convert bytes to numpy array via cv2
     # Run self.app.get(img) — returns list of Face objects
     # If no faces: return {"success": False, "reason": "no_face_detected"}
     # If multiple faces: return {"success": False, "reason": "multiple_faces"}
     # If exactly one face: return {
     #   "success": True,
     #   "bbox": face.bbox.tolist(),
     #   "landmarks": face.kps.tolist(),  (5-point landmarks)
     #   "det_score": float(face.det_score),
     #   "face_object": face  (raw InsightFace Face object — needed for embedding)
     # }
     # Minimum detection score threshold: 0.7 (reject low-confidence detections)

2. backend/app/ai/recognizer.py
   Class: FaceRecognizer

   Note: InsightFace buffalo_l pack includes BOTH the detector AND the ArcFace recognizer.
   The FaceAnalysis object used in detector.py already runs recognition internally.
   So FaceRecognizer wraps the embedding extraction from the Face object.

   get_embedding(self, face_object) -> np.ndarray:
     # face_object is the InsightFace Face returned by detector
     # face.embedding is already the 512-d ArcFace vector (InsightFace computes it automatically)
     # Normalize it: embedding / np.linalg.norm(embedding)
     # Return normalized numpy array shape (512,)

   @staticmethod
   cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
     # np.dot(vec_a, vec_b) — since both are L2-normalized, dot product = cosine similarity
     # Return float between -1 and 1

3. backend/app/ai/liveness.py
   Class: LivenessChecker (STUB for V1 — always returns live)

   check(self, image_bytes: bytes, bbox: list) -> dict:
     # V1 STUB — always passes
     # Return {"is_live": True, "score": 1.0, "note": "liveness_stub_v1"}
     # TODO V2: implement MiniFASNetV2-SE here

4. backend/app/ai/pipeline.py
   Class: AttendancePipeline

   This is the single object that main.py loads at startup and injects everywhere.

   __init__(self):
     self.detector = FaceDetector()
     self.recognizer = FaceRecognizer()
     self.liveness = LivenessChecker()
     self._loaded = False

   load_models(self):
     self.detector.load()
     self._loaded = True
     logging.info("AttendancePipeline: models loaded")

   process(self, image_bytes: bytes) -> dict:
     # Step 1: detect
     detection = self.detector.detect(image_bytes)
     if not detection["success"]:
         return {"status": "failed", "reason": detection["reason"], "embedding": None}

     # Step 2: liveness (V1 stub — always passes)
     liveness = self.liveness.check(image_bytes, detection["bbox"])
     if not liveness["is_live"]:
         return {"status": "failed", "reason": "spoof_detected", "embedding": None}

     # Step 3: get embedding
     embedding = self.recognizer.get_embedding(detection["face_object"])

     return {
         "status": "ready_for_matching",
         "embedding": embedding,       # numpy array (512,)
         "bbox": detection["bbox"],
         "det_score": detection["det_score"],
         "liveness_score": liveness["score"]
     }

5. Update backend/app/main.py:
   - Import AttendancePipeline
   - Create a global instance: pipeline = AttendancePipeline()
   - Use lifespan context manager to call pipeline.load_models() at startup
   - Expose pipeline via app.state.pipeline so routes can access it

6. backend/tests/test_pipeline.py
   A standalone test script (not pytest — just a runnable script):

   - Download a sample face image from the web using requests (a public domain face photo)
     OR create a test with a solid colored rectangle (to test no_face path)
   - Instantiate AttendancePipeline, call load_models(), call process(image_bytes)
   - Print the result dict
   - Assert status == "ready_for_matching"
   - Assert embedding shape == (512,)
   - Print "PASS: pipeline working, embedding shape:", embedding.shape

7. Write run_me.ps1 section "PHASE 2 - Test AI pipeline":
   cd backend
   .\venv\Scripts\activate
   python tests/test_pipeline.py
   # Expected output: PASS: pipeline working, embedding shape: (512,)
   # Note: First run downloads ~300MB InsightFace models to models/ folder. Be patient.
```

---

## PHASE 3 — Checkin endpoint + pgvector matching
### When to run: After Phase 2 test passes (embedding shape (512,) confirmed).
### Mode: Plan Mode
### Verification: curl POST to /api/checkin returns JSON with employee name

```
Read SKILL.md in the project root before doing anything. Follow every rule there.

Build the /api/checkin endpoint and employee CRUD.
This completes the V1 baseline loop.
Windows machine — write commands to run_me.ps1, never use run_command.

1. backend/app/services/attendance.py
   Class: AttendanceService

   async def find_matching_employee(
       self,
       session: AsyncSession,
       query_embedding: np.ndarray,
       threshold: float = 0.6
   ) -> tuple[Employee | None, float]:
     # Use pgvector cosine distance to find closest employee
     # Only search employees where face_embedding IS NOT NULL and is_active = True
     # SQL pattern:
     #   SELECT *, 1 - (face_embedding <=> :vec) as similarity
     #   FROM employees
     #   WHERE face_embedding IS NOT NULL AND is_active = true
     #   ORDER BY face_embedding <=> :vec
     #   LIMIT 1
     # If no employees enrolled: return (None, 0.0)
     # If best match similarity < threshold: return (None, best_similarity)
     # Else: return (employee, similarity)

   async def log_checkin(
       self,
       session: AsyncSession,
       employee_id: UUID | None,
       confidence: float,
       device_id: str,
       status: str,
       failure_reason: str | None = None
   ) -> AttendanceLog:
     # Create and persist AttendanceLog record
     # check_type logic: if last log for this employee today was CHECK_IN → use CHECK_OUT
     #                   otherwise → use CHECK_IN
     # Always log even failed attempts (status="FAILED")

2. backend/app/api/checkin.py
   FastAPI router, prefix="/api"

   POST /api/checkin
   - Accept: multipart/form-data
     Fields: image (UploadFile, JPEG), device_id (str, default="default")
   - Inject: db session via Depends(get_db), pipeline via request.app.state.pipeline

   Logic:
     a. Read image bytes from upload
     b. Call pipeline.process(image_bytes)
     c. If status == "failed": log failed attempt, return:
        {"success": False, "reason": result["reason"], "employee_name": None, "timestamp": now}
     d. If status == "ready_for_matching":
        - Call attendance_service.find_matching_employee(session, embedding)
        - If no match: log unknown attempt, return:
          {"success": False, "reason": "employee_not_recognized", "confidence": score}
        - If match found:
          - Log successful checkin
          - Return:
            {"success": True, "employee_name": emp.name, "employee_id": str(emp.id),
             "confidence": round(score, 3), "check_type": "CHECK_IN" or "CHECK_OUT",
             "timestamp": datetime.now(UTC).isoformat()}

   POST /api/checkin/enroll
   - Accept: multipart/form-data
     Fields: image (UploadFile), employee_id (UUID str)
   - Load the image, run pipeline.process() to get embedding
   - If no face detected: return error
   - Update employee.face_embedding = embedding in DB
   - Return {"success": True, "message": "Face enrolled successfully"}

3. backend/app/api/employees.py
   FastAPI router, prefix="/api"

   GET /api/employees
   - Returns list of all active employees
   - Response: [{id, name, email, department, job_title, is_enrolled (bool: face_embedding != null)}]

   POST /api/employees
   - Body: JSON {name, email, department, job_title}
   - Creates employee WITHOUT embedding (enrollment is separate step)
   - Returns created employee

   GET /api/employees/{employee_id}
   - Returns single employee

   DELETE /api/employees/{employee_id}
   - Soft delete: set is_active = False

4. Wire routers into backend/app/main.py:
   - app.include_router(checkin_router)
   - app.include_router(employees_router)
   - Add CORS middleware allowing all origins (development mode)

5. backend/tests/test_checkin.py
   Standalone test script:

   - Start assumption: FastAPI is running at localhost:8000
   - Step 1: POST /api/employees to create a test employee
   - Step 2: Download a public domain face image
   - Step 3: POST /api/checkin/enroll with the image + employee_id
   - Step 4: POST /api/checkin with the same image
   - Step 5: Assert response contains employee name
   - Print full response JSON at each step
   - Print "FULL PIPELINE PASS" if step 4 returns success=True

6. Write run_me.ps1 section "PHASE 3 - Start server and test":
   # Terminal 1 — start FastAPI (run this first, keep it running)
   cd backend
   .\venv\Scripts\activate
   uvicorn app.main:app --reload --port 8000

   # Terminal 2 — run the E2E test (after server is up)
   cd backend
   .\venv\Scripts\activate
   python tests/test_checkin.py
```

---

## PHASE 4 — Employee enrollment UI (minimal)
### When to run: After Phase 3 test passes (full pipeline confirmed).
### Mode: Fast Mode (Gemini Flash is fine for this)
### Verification: Browser opens localhost:3000, can enroll a face and check in

```
Read SKILL.md in the project root before doing anything. Follow every rule there.

Build a minimal enrollment UI so we can test the system with real faces.
The Next.js app runs in Docker — no local Node. Use docker compose run for npm commands.
Windows machine — write commands to run_me.ps1, never use run_command.

1. First, check if frontend/ has package.json. If NOT, write to run_me.ps1:
   docker run --rm -v "%CD%\frontend:/app" -w /app node:20-alpine sh -c "npx create-next-app@14 . --typescript --tailwind --app --no-src-dir --import-alias '@/*' --yes"

2. Create frontend/src/app/page.tsx — simple dashboard with two cards:
   - "Enroll Employee" card with link to /enroll
   - "View Employees" card with link to /employees
   Clean Tailwind styling. No charts yet — just navigation.

3. Create frontend/src/app/enroll/page.tsx — enrollment page:
   - Form fields: Name, Email, Department, Job Title
   - Webcam preview using navigator.mediaDevices.getUserMedia
   - "Capture Photo" button — takes a snapshot from webcam
   - Preview of captured photo
   - "Enroll" button — does two API calls:
     a. POST /api/employees (JSON) → gets employee_id
     b. POST /api/checkin/enroll (multipart with image + employee_id)
   - Show success/error message
   - API base URL from process.env.NEXT_PUBLIC_API_URL

4. Create frontend/src/app/employees/page.tsx — employee list:
   - Fetch GET /api/employees on load
   - Table: Name, Email, Department, Enrolled (Yes/No badge)
   - If not enrolled: show "Enroll Face" button linking to /enroll

5. Create frontend/src/app/checkin/page.tsx — manual check-in test page:
   - Webcam live preview (continuous — like a kiosk)
   - "Check In" button — captures frame, POSTs to /api/checkin
   - Show result card: employee name + confidence + check_type
   - Auto-reset after 3 seconds, ready for next person

6. Create frontend/src/lib/api.ts:
   - axios instance with baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
   - Typed functions: enrollEmployee(), enrollFace(), getEmployees(), checkIn()

7. Write run_me.ps1 section "PHASE 4 - Start frontend":
   docker compose up frontend -d
   # Frontend available at http://localhost:3000
   # If docker compose up fails due to missing package.json, run the npx command above first
```

---

## PHASE 5 — Final wiring check
### When to run: After Phase 4 UI is visible at localhost:3000
### Mode: Fast Mode
### Verification: Full end-to-end test — enroll via UI → check-in via UI → see result

```
Read SKILL.md in the project root before doing anything. Follow every rule there.

Final wiring and edge case pass. Windows machine — commands to run_me.ps1 only.

1. Add startup validation to backend/app/main.py:
   On startup (in lifespan), check:
   a. DB connection — run "SELECT 1" via asyncpg
   b. Redis connection — ping via redis-py
   c. pgvector — run "SELECT '[1,2,3]'::vector" query
   If any check fails: log a clear WARNING (don't crash — let the server start)
   Print startup summary:
     "✅ DB connected" or "❌ DB connection failed: {error}"
     "✅ Redis connected" or "❌ Redis not reachable"
     "✅ pgvector available" or "❌ pgvector extension missing — run: CREATE EXTENSION vector"
     "✅ AI models loaded" or "❌ Model load failed: {error}"

2. Add duplicate check-in prevention:
   In the checkin endpoint, before writing to DB:
   - Check Redis key: "last_checkin:{employee_id}"
   - If key exists (set within last 10 seconds): return:
     {"success": False, "reason": "too_soon", "message": "Already checked in recently"}
   - After successful checkin: SET "last_checkin:{employee_id}" EX 10

3. Add a GET /api/checkin/recent endpoint:
   - Returns last 20 attendance_log records ordered by timestamp DESC
   - Join with employees to include name
   - Response: [{employee_name, check_type, timestamp, confidence_score, status}]
   - Used by the frontend live feed

4. Update frontend/src/app/checkin/page.tsx:
   - Add a live feed table below the webcam (last 10 check-ins)
   - Poll GET /api/checkin/recent every 5 seconds using setInterval
   - Show rows: Name | Type | Time | Confidence

5. Write final run_me.ps1 section "PHASE 5 - Full system check":
   # Verify all Docker services running
   docker ps

   # Verify FastAPI health
   curl http://localhost:8000/health

   # Verify pgvector
   psql -U postgres -d attendance_db -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"

   # Verify employee table exists with vector column
   psql -U postgres -d attendance_db -c "\d employees"

   # Run full pipeline test
   cd backend
   .\venv\Scripts\activate
   python tests/test_checkin.py
```
