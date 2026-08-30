"""
End-to-end test for the check-in API.

Run from backend/ directory (venv active):
    python tests/test_checkin.py
"""

import sys
import json
import time
import uuid
import asyncio
from pathlib import Path

# Fix Windows console UTF-8 output
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

import requests
from fastapi.testclient import TestClient

from app.main import app, pipeline as main_pipeline
from app.core.database import create_all_tables, engine
from manage import create_superadmin

BASE_URL = "http://localhost:8000"


class UnifiedClient:
    """HTTP client that tries live server at http://localhost:8000 first, falling back to TestClient(app)."""

    def __init__(self):
        self.test_client = None
        self.use_live = False
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=2)
            if r.status_code == 200:
                self.use_live = True
                print("  [Client] Connected to live server at http://localhost:8000")
        except Exception:
            print("  [Client] Live server not reachable; using in-process TestClient")

        if not self.use_live:
            if not getattr(main_pipeline, "_loaded", False):
                main_pipeline.load_models()
            app.state.pipeline = main_pipeline
            self.test_client = TestClient(app)

    def request(self, method: str, path: str, **kwargs):
        headers = kwargs.get("headers", None)
        json_data = kwargs.get("json", None)
        params = kwargs.get("params", None)
        files = kwargs.get("files", None)
        data = kwargs.get("data", None)

        if self.use_live:
            url = f"{BASE_URL}{path}"
            req_kwargs = {"timeout": 15}
            if headers is not None:
                req_kwargs["headers"] = headers
            if json_data is not None:
                req_kwargs["json"] = json_data
            if params is not None:
                req_kwargs["params"] = params
            if files is not None:
                req_kwargs["files"] = files
            if data is not None:
                req_kwargs["data"] = data
            resp = requests.request(method, url, **req_kwargs)

            class ResponseWrapper:
                def __init__(self, r):
                    self.status_code = r.status_code
                    self._r = r

                def json(self):
                    return self._r.json()

            return ResponseWrapper(resp)
        else:
            tc_method = getattr(self.test_client, method.lower())
            kwargs_tc = {}
            if headers is not None:
                kwargs_tc["headers"] = headers
            if json_data is not None:
                kwargs_tc["json"] = json_data
            if params is not None:
                kwargs_tc["params"] = params
            if files is not None:
                kwargs_tc["files"] = files
            if data is not None:
                kwargs_tc["data"] = data
            resp = tc_method(path, **kwargs_tc)
            return resp

    def get(self, path: str, **kwargs):
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs):
        return self.request("POST", path, **kwargs)

    def patch(self, path: str, **kwargs):
        return self.request("PATCH", path, **kwargs)

    def delete(self, path: str, **kwargs):
        return self.request("DELETE", path, **kwargs)


def pp(label: str, data: dict):
    print(f"\n{'─'*50}")
    print(f"  {label}")
    print(f"{'─'*50}")
    print(json.dumps(data, indent=2))


async def setup_database():
    """Single async setup call to avoid event loop / connection pool conflicts."""
    await create_all_tables()
    await create_superadmin("admin", "admin123", create_tables=False)
    await engine.dispose()


def get_test_face_image() -> bytes:
    """Generate a test face image 100% offline."""
    try:
        import insightface
        import cv2

        inf_img_path = (
            Path(insightface.__file__).parent / "data" / "images" / "t1.jpg"
        )
        if inf_img_path.exists():
            img = cv2.imread(str(inf_img_path))
            if img is not None:
                h, w, _ = img.shape
                pad = 50
                crop = img[
                    max(0, 268 - pad) : min(h, 415 + pad),
                    max(0, 466 - pad) : min(w, 573 + pad),
                ]
                _, buf = cv2.imencode(".jpg", crop)
                return buf.tobytes()
    except Exception:
        pass

    from PIL import Image, ImageDraw
    import io

    img = Image.new("RGB", (640, 640), (220, 220, 220))
    draw = ImageDraw.Draw(img)
    draw.ellipse([170, 100, 470, 500], fill=(220, 190, 170), outline=(100, 50, 50))
    draw.ellipse([230, 220, 290, 260], fill=(50, 50, 50))
    draw.ellipse([350, 220, 410, 260], fill=(50, 50, 50))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


# ── Test steps ───────────────────────────────────────────────────────────────


def step1_health_check(client: UnifiedClient):
    print("\n[1/5] Health check...")
    resp = client.get("/health")
    data = resp.json()
    pp("GET /health", data)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    assert data["status"] == "ok", "Health check failed"
    assert data["models_loaded"] is True, "Models not loaded — pipeline startup failed"
    print("  ✓ Server healthy, models loaded")


def step2_create_employee(client: UnifiedClient, headers: dict) -> str:
    print("\n[2/5] Creating test employee...")
    emp_email = f"testperson_{uuid.uuid4().hex[:6]}@example.com"
    payload = {
        "name": "Test Person",
        "email": emp_email,
        "department": "Engineering",
        "job_title": "Test Engineer",
    }
    resp = client.post("/api/employees", json=payload, headers=headers)

    if resp.status_code == 409:
        print("  Employee already exists — fetching existing...")
        list_resp = client.get("/api/employees")
        employees = list_resp.json()
        for emp in employees:
            if emp["email"] == payload["email"]:
                pp("Existing employee", emp)
                return emp["id"]
        raise RuntimeError("Could not find existing test employee")

    data = resp.json()
    pp("POST /api/employees", data)
    assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {data}"
    employee_id = data["id"]
    print(f"  ✓ Created employee: {data['name']} ({employee_id})")
    return employee_id


def step3_enroll_face(client: UnifiedClient, employee_id: str, image_bytes: bytes):
    print("\n[3/5] Enrolling face...")
    resp = client.post(
        "/api/checkin/enroll",
        files={"image": ("face.jpg", image_bytes, "image/jpeg")},
        data={"employee_id": employee_id},
    )
    data = resp.json()
    pp("POST /api/checkin/enroll", data)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {data}"
    assert data.get("success") is True, f"Enrollment failed: {data}"
    print("  ✓ Face enrolled successfully")


def step4_checkin(client: UnifiedClient, image_bytes: bytes) -> dict:
    print("\n[4/5] Performing check-in...")
    resp = client.post(
        "/api/checkin",
        files={"image": ("face.jpg", image_bytes, "image/jpeg")},
        data={"device_id": "test-terminal"},
    )
    data = resp.json()
    pp("POST /api/checkin", data)
    return data


def step5_recent_logs(client: UnifiedClient):
    print("\n[5/5] Fetching recent logs...")
    resp = client.get("/api/checkin/recent")
    data = resp.json()
    print(f"  Got {len(data)} recent log(s)")
    if data:
        pp("Most recent log", data[0])
    return data


# ── Main ─────────────────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("  FULL PIPELINE E2E TEST")
    print("=" * 60)

    # Initialize DB tables and superadmin
    asyncio.run(setup_database())

    client = UnifiedClient()

    # Admin Login to get token for employee creation
    login_resp = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"}
    )
    assert login_resp.status_code == 200, f"Admin login failed: {login_resp.json()}"
    admin_token = login_resp.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # Pre-flight
    print("\n[0/5] Fetching test face image...")
    image_bytes = get_test_face_image()

    step1_health_check(client)
    employee_id = step2_create_employee(client, admin_headers)

    # Wait a moment for any DB commit to settle
    time.sleep(0.5)

    step3_enroll_face(client, employee_id, image_bytes)

    # Brief pause before check-in
    time.sleep(1)

    checkin_result = step4_checkin(client, image_bytes)
    recent = step5_recent_logs(client)

    print("\n" + "=" * 60)
    if checkin_result.get("success") is True:
        print(f"  FULL PIPELINE PASS ✅")
        print(f"  Employee: {checkin_result['employee_name']}")
        print(f"  Type:     {checkin_result['check_type']}")
        print(f"  Confidence: {checkin_result['confidence']}")
    else:
        reason = checkin_result.get("reason", "unknown")
        print(f"  PIPELINE CHECK-IN FAILED ❌ — reason: {reason}")
        print("  Note: If reason='employee_not_recognized', the face image")
        print("  may not match well enough. Try with a clearer face photo.")
        sys.exit(1)
    print("=" * 60)


if __name__ == "__main__":
    main()
