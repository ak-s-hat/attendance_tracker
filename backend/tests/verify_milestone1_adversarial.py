"""
Adversarial Verification Harness for Milestone 1
Location: backend/tests/verify_milestone1_adversarial.py
"""

import math
import sys
import unittest
from pathlib import Path

# Add backend/ to sys.path
backend_dir = Path(__file__).resolve().parents[1]
if not (backend_dir / "app").exists():
    backend_dir = Path(__file__).resolve().parents[2] / "backend"
sys.path.insert(0, str(backend_dir))

import numpy as np
from pydantic import ValidationError
from app.api.checkin import EmbeddingCheckinRequest, EmbeddingCheckinResponse
from app.models.employee import Employee
from app.models.attendance_log import AttendanceLog
from app.services.attendance import AttendanceService


class TestEmbeddingSchema(unittest.TestCase):
    """1. Verify vector embedding dimensionality checks in Pydantic schema."""

    def test_valid_512_dimensions(self):
        vec = [0.1] * 512
        req = EmbeddingCheckinRequest(embedding=vec, device_id="kiosk-1", liveness_score=0.9)
        self.assertEqual(len(req.embedding), 512)
        self.assertEqual(req.device_id, "kiosk-1")
        self.assertEqual(req.liveness_score, 0.9)

    def test_invalid_short_dimensions(self):
        vec = [0.1] * 511
        with self.assertRaises(ValidationError) as ctx:
            EmbeddingCheckinRequest(embedding=vec)
        self.assertIn("Embedding vector must have exactly 512 dimensions", str(ctx.exception))

    def test_invalid_long_dimensions(self):
        vec = [0.1] * 513
        with self.assertRaises(ValidationError) as ctx:
            EmbeddingCheckinRequest(embedding=vec)
        self.assertIn("Embedding vector must have exactly 512 dimensions", str(ctx.exception))

    def test_empty_vector(self):
        with self.assertRaises(ValidationError) as ctx:
            EmbeddingCheckinRequest(embedding=[])
        self.assertIn("Embedding vector must have exactly 512 dimensions", str(ctx.exception))

    def test_nan_vector_behavior(self):
        """Check if NaN floats pass schema validation or trigger ValidationError."""
        vec = [float("nan")] * 512
        with self.assertRaises(ValidationError) as ctx:
            EmbeddingCheckinRequest(embedding=vec)
        self.assertIn("Embedding vector contains NaN", str(ctx.exception))


class TestCosineSimilarityAndTolerance(unittest.TestCase):
    """2. Verify cosine similarity calculation correctness and tolerance handling."""

    def test_unit_vector_dot_product_identical(self):
        vec_a = np.random.randn(512).astype(np.float32)
        vec_a /= np.linalg.norm(vec_a)
        sim = float(np.dot(vec_a, vec_a))
        self.assertAlmostEqual(sim, 1.0, places=5)

    def test_unit_vector_dot_product_orthogonal(self):
        vec_a = np.zeros(512, dtype=np.float32)
        vec_a[0] = 1.0
        vec_b = np.zeros(512, dtype=np.float32)
        vec_b[1] = 1.0
        sim = float(np.dot(vec_a, vec_b))
        self.assertAlmostEqual(sim, 0.0, places=5)

    def test_unit_vector_dot_product_opposite(self):
        vec_a = np.zeros(512, dtype=np.float32)
        vec_a[0] = 1.0
        vec_b = np.zeros(512, dtype=np.float32)
        vec_b[0] = -1.0
        sim = float(np.dot(vec_a, vec_b))
        self.assertAlmostEqual(sim, -1.0, places=5)

    def test_tolerance_rounding_display(self):
        """Check if similarity score near boundary rounds predictably."""
        sim_near_threshold = 0.59999
        rounded = round(sim_near_threshold, 3)
        self.assertEqual(rounded, 0.6)
        # Note: 0.59999 < 0.6 threshold -> rejected, but rounded display shows 0.6


class TestDatabaseLogRetentionSchema(unittest.TestCase):
    """3. Verify log retention / AttendanceLog database write correctness."""

    def test_attendance_log_employee_id_nullability(self):
        """Check whether AttendanceLog employee_id column allows None."""
        column = AttendanceLog.__table__.columns["employee_id"]
        # CRITICAL ADVERSARIAL CHECK: employee_id MUST be nullable=True to store FAILED and UNKNOWN check-ins
        print(f"AttendanceLog.employee_id nullable: {column.nullable}")
        self.assertTrue(
            column.nullable,
            "CRITICAL BUG: AttendanceLog.employee_id is nullable=False! "
            "Failed check-ins (employee_id=None) will cause DB NOT NULL constraint violation (IntegrityError)."
        )


if __name__ == "__main__":
    unittest.main()
