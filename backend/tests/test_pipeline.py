"""
Standalone test script for the AI pipeline.
Run from backend/ directory:
    python tests/test_pipeline.py

First run will download ~300MB InsightFace buffalo_l models.
"""

import sys
import time
from pathlib import Path

# Add backend/ to sys.path so `from app.ai...` imports work
backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

from app.ai.pipeline import AttendancePipeline
from app.ai.recognizer import FaceRecognizer


def get_test_face_image() -> bytes:
    """
    Download a public-domain face photo for testing.
    Tries multiple reliable URLs. Falls back to a synthetic face-like image.
    """
    import requests

    # Public-domain / CC0 face images from Wikimedia Commons (direct file URLs)
    urls = [
        # Wikimedia Commons portrait photos — public domain
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/320px-Camponotus_flavomarginatus_ant.jpg",  # placeholder — replaced below
        "https://upload.wikimedia.org/wikipedia/commons/4/4c/Brad_Pitt_2019_by_Glenn_Francis.jpg",
        "https://upload.wikimedia.org/wikipedia/commons/1/14/Gatto_europeo4.jpg",  # cat — will fail face detection, but tests the path
    ]

    # Better: use a well-known sample face dataset image
    urls = [
        "https://raw.githubusercontent.com/opencv/opencv/master/samples/data/lena.jpg",
        "https://upload.wikimedia.org/wikipedia/en/7/7d/Lenna_%28test_image%29.png",
        "https://www.planwallpaper.com/static/images/Face-Wallpaper.jpg",
    ]

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/131.0.0.0 Safari/537.36"
        )
    }

    for url in urls:
        print(f"  Trying: {url[:80]}...")
        try:
            resp = requests.get(url, timeout=15, headers=headers)
            resp.raise_for_status()

            content_type = resp.headers.get("Content-Type", "")
            if "image" not in content_type and "octet-stream" not in content_type:
                raise ValueError(f"Not an image: Content-Type={content_type}")
            if len(resp.content) < 5_000:
                raise ValueError(f"Too small ({len(resp.content)} bytes)")

            print(f"  Downloaded {len(resp.content):,} bytes")
            return resp.content
        except Exception as e:
            print(f"  Failed: {e}")
            continue

    # Last resort: generate a synthetic face-like image using OpenCV
    # Draw an oval (head) + circles (eyes) + line (mouth) — enough for SCRFD to maybe detect
    print("  All URLs failed. Generating synthetic face image...")
    import numpy as np
    import cv2

    img = np.full((640, 640, 3), 200, dtype=np.uint8)  # light gray background
    # Head oval
    cv2.ellipse(img, (320, 300), (150, 200), 0, 0, 360, (180, 150, 130), -1)
    # Left eye
    cv2.circle(img, (260, 260), 20, (60, 40, 30), -1)
    cv2.circle(img, (260, 260), 8, (255, 255, 255), -1)
    # Right eye
    cv2.circle(img, (380, 260), 20, (60, 40, 30), -1)
    cv2.circle(img, (380, 260), 8, (255, 255, 255), -1)
    # Nose
    cv2.line(img, (320, 280), (310, 340), (150, 120, 100), 3)
    # Mouth
    cv2.ellipse(img, (320, 380), (50, 20), 0, 0, 180, (150, 100, 100), 3)

    _, buf = cv2.imencode(".jpg", img)
    print("  Generated synthetic face image (detection may or may not work)")
    return buf.tobytes()


def test_pipeline():
    """Test the full AI pipeline: load → detect → embed."""
    print("=" * 60)
    print("ATTENDANCE PIPELINE TEST")
    print("=" * 60)

    # Step 1: instantiate and load models
    print("\n[1/4] Loading AttendancePipeline models...")
    t0 = time.perf_counter()
    pipeline = AttendancePipeline()
    pipeline.load_models()
    load_time = time.perf_counter() - t0
    print(f"  Models loaded in {load_time:.1f}s")

    # Step 2: get a test image
    print("\n[2/4] Getting test face image...")
    image_bytes = get_test_face_image()

    # Step 3: run the pipeline
    print("\n[3/4] Running pipeline.process()...")
    t0 = time.perf_counter()
    result = pipeline.process(image_bytes)
    proc_time = (time.perf_counter() - t0) * 1000
    print(f"  Pipeline returned in {proc_time:.1f}ms")
    print(f"  Status: {result['status']}")

    if result["status"] != "ready_for_matching":
        print(f"  Reason: {result.get('reason', 'unknown')}")
        print("\nFAIL: Pipeline did not return ready_for_matching.")
        print("      This may be expected if the test image had no face.")
        sys.exit(1)

    embedding = result["embedding"]
    print(f"  Embedding shape: {embedding.shape}")
    print(f"  Embedding dtype: {embedding.dtype}")
    print(f"  Bbox: {result['bbox']}")
    print(f"  Det score: {result['det_score']:.4f}")
    print(f"  Liveness score: {result['liveness_score']}")
    print(f"  Latency: {result['latency_ms']}ms")

    # Step 4: assertions
    print("\n[4/4] Running assertions...")
    assert result["status"] == "ready_for_matching", "Expected status 'ready_for_matching'"
    assert embedding.shape == (512,), f"Expected shape (512,), got {embedding.shape}"

    # Verify embedding is L2-normalized
    import numpy as np

    norm = float(np.linalg.norm(embedding))
    assert abs(norm - 1.0) < 1e-5, f"Embedding not normalized, norm={norm}"
    print(f"  Embedding L2 norm: {norm:.6f} (should be ~1.0)")

    # Verify cosine similarity of same embedding with itself is 1.0
    self_sim = FaceRecognizer.cosine_similarity(embedding, embedding)
    assert abs(self_sim - 1.0) < 1e-5, f"Self-similarity should be 1.0, got {self_sim}"
    print(f"  Self cosine-similarity: {self_sim:.6f} (should be ~1.0)")

    print("\n" + "=" * 60)
    print(f"PASS: pipeline working, embedding shape: {embedding.shape}")
    print(f"      Latency target: <300ms | Actual: {proc_time:.1f}ms")
    print("=" * 60)


if __name__ == "__main__":
    test_pipeline()
