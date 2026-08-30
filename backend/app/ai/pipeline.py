"""AttendancePipeline — orchestrates detection, liveness, and recognition.

This is the single object that main.py loads at startup and injects into
app.state so every route handler can use it.
"""

import logging
import time

from app.ai.detector import FaceDetector
from app.ai.recognizer import FaceRecognizer
from app.ai.liveness import LivenessChecker

logger = logging.getLogger(__name__)


class AttendancePipeline:
    """Full face-processing pipeline: detect → liveness → embed."""

    def __init__(self) -> None:
        self.detector = FaceDetector()
        self.recognizer = FaceRecognizer()
        self.liveness = LivenessChecker()
        self._loaded = False

    def load_models(self) -> None:
        """Load all AI models. Call once at application startup or on first frame."""
        if self._loaded:
            return
        logger.info("AttendancePipeline: loading models...")
        self.detector.load()
        self._loaded = True
        logger.info("AttendancePipeline: models loaded")

    def process(self, image_bytes: bytes) -> dict:
        """
        Full pipeline: detect face → check liveness → extract embedding.

        Args:
            image_bytes: raw JPEG image bytes

        Returns:
            dict with status, embedding (numpy 512-d or None), bbox, scores
        """
        if not self._loaded:
            self.load_models()

        t_start = time.perf_counter()

        # Step 1: detect
        detection = self.detector.detect(image_bytes)
        if not detection["success"]:
            return {
                "status": "failed",
                "reason": detection["reason"],
                "embedding": None,
            }

        # Step 2: liveness (V1 stub — always passes)
        liveness = self.liveness.check(image_bytes, detection["bbox"])
        if not liveness["is_live"]:
            return {
                "status": "failed",
                "reason": "spoof_detected",
                "embedding": None,
            }

        # Step 3: get embedding
        embedding = self.recognizer.get_embedding(detection["face_object"])

        elapsed_ms = (time.perf_counter() - t_start) * 1000
        logger.info("AttendancePipeline.process: %.1fms", elapsed_ms)

        return {
            "status": "ready_for_matching",
            "embedding": embedding,  # numpy array (512,)
            "bbox": detection["bbox"],
            "det_score": detection["det_score"],
            "liveness_score": liveness["score"],
            "latency_ms": round(elapsed_ms, 1),
        }
