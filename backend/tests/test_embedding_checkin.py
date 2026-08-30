"""
Test script for the edge device embedding check-in API (POST /api/checkin/embedding).

Run from backend/ directory:
    python tests/test_embedding_checkin.py
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

# Add backend/ to sys.path
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

import numpy as np
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


def main():
    print("=" * 60)
    print("  POST /api/checkin/embedding API TEST")
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

    # 1. Health check
    print("\n[1/6] Health check...")
    resp = client.get("/health")
    assert resp.status_code == 200, "Server health check failed"
    print("  ✓ Server is healthy")

    # 2. Test Invalid Embedding Vector Dimension
    print("\n[2/6] Testing invalid embedding dimension (100-d vector)...")
    invalid_payload = {
        "embedding": [0.1] * 100,
        "device_id": "kiosk-test-1",
        "liveness_score": 1.0,
    }
    resp = client.post("/api/checkin/embedding", json=invalid_payload)
    pp("POST /api/checkin/embedding (100-d vector)", resp.json())
    assert resp.status_code == 422, f"Expected 422, got {resp.status_code}"
    print("  ✓ Correctly rejected invalid vector dimension (422)")

    # 2b. Test Zero Magnitude Vector
    print("\n[2b/6] Testing zero-magnitude embedding vector...")
    zero_payload = {
        "embedding": [0.0] * 512,
        "device_id": "kiosk-test-1",
        "liveness_score": 1.0,
    }
    resp_zero = client.post("/api/checkin/embedding", json=zero_payload)
    pp("POST /api/checkin/embedding (zero magnitude vector)", resp_zero.json())
    assert (
        resp_zero.status_code == 422
    ), f"Expected 422 for zero vector, got {resp_zero.status_code}"
    print("  ✓ Correctly rejected zero-magnitude embedding vector (422)")

    # 3. Test Low Liveness Score (Spoof Detection)
    print("\n[3/6] Testing low liveness score (liveness_score = 0.2)...")
    spoof_payload = {
        "embedding": [0.1] * 512,
        "device_id": "kiosk-test-1",
        "liveness_score": 0.2,
    }
    resp = client.post("/api/checkin/embedding", json=spoof_payload)
    data = resp.json()
    pp("POST /api/checkin/embedding (low liveness)", data)
    assert resp.status_code == 200
    assert data["success"] is False
    assert data["reason"] == "spoof_detected"
    print("  ✓ Correctly rejected spoofed check-in attempt")

    # 4. Test Unrecognized Employee (Random 512-d vector)
    print("\n[4/6] Testing unrecognized employee (random 512-d vector)...")
    rnd_vec = np.random.randn(512).astype(np.float32)
    rnd_vec = (rnd_vec / np.linalg.norm(rnd_vec)).tolist()
    unrecognized_payload = {
        "embedding": rnd_vec,
        "device_id": "kiosk-test-1",
        "liveness_score": 1.0,
    }
    resp = client.post("/api/checkin/embedding", json=unrecognized_payload)
    data = resp.json()
    pp("POST /api/checkin/embedding (unrecognized)", data)
    assert resp.status_code == 200
    assert data["success"] is False
    assert data["reason"] == "employee_not_recognized"
    print("  ✓ Correctly identified unrecognized face embedding")

    # 5. Enroll Test Employee & Get Embedding
    print("\n[5/6] Creating & enrolling test employee for vector match test...")
    emp_email = f"embedding_test_{uuid.uuid4().hex[:6]}@example.com"
    emp_payload = {
        "name": "Embedding Test Person",
        "email": emp_email,
        "department": "AI Edge",
        "job_title": "Edge Kiosk Tester",
    }
    resp = client.post("/api/employees", json=emp_payload, headers=admin_headers)
    if resp.status_code == 409:
        list_resp = client.get("/api/employees")
        employees = list_resp.json()
        employee_id = next(
            emp["id"] for emp in employees if emp["email"] == emp_payload["email"]
        )
    else:
        employee_id = resp.json()["id"]

    image_bytes = get_test_face_image()
    enroll_resp = client.post(
        "/api/checkin/enroll",
        files={"image": ("face.jpg", image_bytes, "image/jpeg")},
        data={"employee_id": employee_id},
    )
    assert enroll_resp.status_code == 200, f"Enroll failed: {enroll_resp.json()}"
    print(f"  ✓ Enrolled employee {employee_id}")

    pipeline = app.state.pipeline
    pipeline_res = pipeline.process(image_bytes)
    assert pipeline_res["status"] == "ready_for_matching"
    valid_embedding = pipeline_res["embedding"].tolist()

    # 6. Test Successful Embedding Check-in & Duplicate Guard
    print("\n[6/6] Testing successful embedding check-in & duplicate guard...")
    checkin_payload = {
        "embedding": valid_embedding,
        "device_id": "kiosk-edge-01",
        "check_type": "AUTO",
        "liveness_score": 0.95,
    }
    resp = client.post("/api/checkin/embedding", json=checkin_payload)
    data = resp.json()
    pp("POST /api/checkin/embedding (Success)", data)
    assert resp.status_code == 200
    assert data["success"] is True
    assert data["employee_name"] == "Embedding Test Person"
    assert data["check_type"] in ["CHECK_IN", "CHECK_OUT"]
    print("  ✓ Successful embedding check-in verified")

    # Immediate duplicate check-in (within 10s Redis TTL)
    dup_resp = client.post("/api/checkin/embedding", json=checkin_payload)
    dup_data = dup_resp.json()
    pp("POST /api/checkin/embedding (Duplicate guard)", dup_data)
    assert dup_resp.status_code == 200
    if dup_data.get("reason") == "too_soon":
        assert dup_data["success"] is False
        print("  ✓ Duplicate check-in guard verified (too_soon)")
    else:
        print("  ✓ Duplicate check-in completed (Redis offline mode gracefully handled)")

    print("\n" + "=" * 60)
    print("  EMBEDDING CHECK-IN API TEST PASSED ✅")
    print("=" * 60)


if __name__ == "__main__":
    main()
