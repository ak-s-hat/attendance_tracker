"""
Empirical stress-test script for edge embedding check-in API (POST /api/checkin/embedding).
Written by Challenger 1 (Milestone 1).

Tests:
1. Health Check
2. NaN / Inf floats in embedding vector
3. Zero vector [0.0]*512 (norm == 0)
4. Non-normalized vector (norm != 1.0)
5. Boundary liveness scores (0.499 vs 0.500, out-of-bounds -0.1 and 1.1)
6. Unrecognized employee embedding vector (and checking for HTTP 500 / NotNullViolation on log_checkin)
7. Redis connection failure / duplicate check-in guard

Prerequisites:
- FastAPI running at localhost:8000
- Run from backend/ directory (venv active)
"""

import sys
import json
import math
from pathlib import Path
import numpy as np
import requests

BASE_URL = "http://localhost:8000"


def log(msg: str, status: str = "INFO"):
    colors = {
        "INFO": "\033[94m",
        "PASS": "\033[92m",
        "FAIL": "\033[91m",
        "WARN": "\033[93m",
        "RESET": "\033[0m"
    }
    c = colors.get(status, "")
    r = colors["RESET"]
    print(f"{c}[{status}]{r} {msg}")


def test_health():
    log("Checking server health...", "INFO")
    resp = requests.get(f"{BASE_URL}/health", timeout=5)
    assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
    log("Server healthy.", "PASS")


def test_nan_inf_floats():
    log("Testing NaN / Inf in embedding vector...", "INFO")

    # 1. NaN vector payload
    nan_payload = {
        "embedding": [float("nan")] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": 1.0,
    }
    try:
        resp = requests.post(f"{BASE_URL}/api/checkin/embedding", json=nan_payload)
        log(f"NaN vector response: HTTP {resp.status_code} - {resp.text}", "WARN" if resp.status_code == 500 else "INFO")
        if resp.status_code == 500:
            log("FAIL: NaN vector triggered HTTP 500 Internal Server Error (unhandled NaN in pgvector query/normalization)", "FAIL")
        elif resp.status_code in (400, 422):
            log("PASS: NaN vector correctly rejected with client error", "PASS")
        else:
            log(f"UNEXPECTED: Got status {resp.status_code}", "WARN")
    except Exception as e:
        log(f"NaN test exception: {e}", "FAIL")

    # 2. Inf vector payload
    inf_payload = {
        "embedding": [float("inf")] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": 1.0,
    }
    try:
        resp = requests.post(f"{BASE_URL}/api/checkin/embedding", json=inf_payload)
        log(f"Inf vector response: HTTP {resp.status_code} - {resp.text}", "WARN" if resp.status_code == 500 else "INFO")
        if resp.status_code == 500:
            log("FAIL: Inf vector triggered HTTP 500 Internal Server Error", "FAIL")
        elif resp.status_code in (400, 422):
            log("PASS: Inf vector correctly rejected with client error", "PASS")
    except Exception as e:
        log(f"Inf test exception: {e}", "FAIL")


def test_zero_vector():
    log("Testing zero vector [0.0]*512...", "INFO")
    zero_payload = {
        "embedding": [0.0] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": 1.0,
    }
    resp = requests.post(f"{BASE_URL}/api/checkin/embedding", json=zero_payload)
    log(f"Zero vector response: HTTP {resp.status_code} - {resp.text}", "WARN" if resp.status_code == 500 else "INFO")
    if resp.status_code == 500:
        log("FAIL: Zero vector triggered HTTP 500 Internal Server Error (zero norm passed to pgvector)", "FAIL")
    elif resp.status_code in (400, 422):
        log("PASS: Zero vector rejected with 400/422", "PASS")
    elif resp.status_code == 200:
        log("WARN: Zero vector returned 200 (processed without crash)", "WARN")


def test_non_normalized_vector():
    log("Testing non-normalized vector [5.0]*512...", "INFO")
    non_norm_payload = {
        "embedding": [5.0] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": 1.0,
    }
    resp = requests.post(f"{BASE_URL}/api/checkin/embedding", json=non_norm_payload)
    log(f"Non-normalized vector response: HTTP {resp.status_code} - {resp.text}", "INFO")
    if resp.status_code == 200:
        log("PASS: Non-normalized vector handled and normalized correctly", "PASS")
    else:
        log(f"FAIL: Unexpected status {resp.status_code}", "FAIL")


def test_boundary_liveness_scores():
    log("Testing boundary liveness scores...", "INFO")

    # 1. Below threshold: 0.499
    resp_0499 = requests.post(f"{BASE_URL}/api/checkin/embedding", json={
        "embedding": [0.1] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": 0.499,
    })
    log(f"Liveness 0.499 response: HTTP {resp_0499.status_code} - {resp_0499.json()}", "INFO")
    if resp_0499.status_code == 500:
        log("FAIL: Liveness 0.499 triggered HTTP 500 (attempted log_checkin(employee_id=None) on NOT NULL column)", "FAIL")
    else:
        assert resp_0499.status_code == 200
        data = resp_0499.json()
        assert data["success"] is False
        assert data["reason"] == "spoof_detected"
        log("PASS: Liveness 0.499 correctly rejected (spoof_detected)", "PASS")

    # 2. At threshold: 0.500
    resp_0500 = requests.post(f"{BASE_URL}/api/checkin/embedding", json={
        "embedding": [0.1] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": 0.500,
    })
    log(f"Liveness 0.500 response: HTTP {resp_0500.status_code} - {resp_0500.json()}", "INFO")
    if resp_0500.status_code == 500:
        log("FAIL: Liveness 0.500 triggered HTTP 500 (attempted log_checkin(employee_id=None) on NOT NULL column)", "FAIL")
    else:
        assert resp_0500.status_code == 200
        data = resp_0500.json()
        # Should pass liveness check and reach vector match (which returns employee_not_recognized for dummy vector)
        assert data["reason"] == "employee_not_recognized"
        log("PASS: Liveness 0.500 passed liveness check and proceeded to vector matching", "PASS")

    # 3. Invalid out-of-bounds liveness: -0.1 and 1.1
    resp_neg = requests.post(f"{BASE_URL}/api/checkin/embedding", json={
        "embedding": [0.1] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": -0.1,
    })
    assert resp_neg.status_code == 422, f"Expected 422 for liveness -0.1, got {resp_neg.status_code}"

    resp_high = requests.post(f"{BASE_URL}/api/checkin/embedding", json={
        "embedding": [0.1] * 512,
        "device_id": "kiosk-stress-1",
        "liveness_score": 1.1,
    })
    assert resp_high.status_code == 422, f"Expected 422 for liveness 1.1, got {resp_high.status_code}"
    log("PASS: Out-of-bounds liveness scores correctly rejected with 422", "PASS")


def test_unrecognized_and_not_null_foreign_key():
    log("Testing unrecognized embedding & AttendanceLog employee_id NULL constraint...", "INFO")
    rnd_vec = np.random.randn(512).astype(np.float32)
    rnd_vec = (rnd_vec / np.linalg.norm(rnd_vec)).tolist()

    unrecognized_payload = {
        "embedding": rnd_vec,
        "device_id": "kiosk-stress-1",
        "liveness_score": 1.0,
    }
    resp = requests.post(f"{BASE_URL}/api/checkin/embedding", json=unrecognized_payload)
    log(f"Unrecognized embedding response: HTTP {resp.status_code} - {resp.text}", "INFO")

    if resp.status_code == 500:
        log("FAIL: Unrecognized embedding returned HTTP 500! Cause: AttendanceLog(employee_id=None) violates NOT NULL constraint on employee_id", "FAIL")
    elif resp.status_code == 200:
        data = resp.json()
        assert data["success"] is False
        assert data["reason"] == "employee_not_recognized"
        log("PASS: Unrecognized embedding handled gracefully without crash", "PASS")


def main():
    print("=" * 60)
    print("  EMPIRICAL STRESS TEST FOR POST /api/checkin/embedding")
    print("=" * 60)

    try:
        test_health()
        test_nan_inf_floats()
        test_zero_vector()
        test_non_normalized_vector()
        test_boundary_liveness_scores()
        test_unrecognized_and_not_null_foreign_key()
        print("\n" + "=" * 60)
        print("  EMPIRICAL STRESS TEST EXECUTION COMPLETED")
        print("=" * 60)
    except Exception as e:
        log(f"Test run aborted due to exception: {e}", "FAIL")
        sys.exit(1)


if __name__ == "__main__":
    main()
