"""Face detector using InsightFace SCRFD (bundled in buffalo_l)."""

import logging
from pathlib import Path

import cv2
import numpy as np

import os

import os
from app.core.config import settings

logger = logging.getLogger(__name__)

# Resolution:
# 1. settings.MODELS_DIR (loaded from .env or docker-compose)
# 2. os.environ.get("MODELS_DIR")
# 3. Path("D:/ML/models") if it exists
# 4. Fallback to project root models/
def _get_models_dir() -> Path:
    target = settings.MODELS_DIR or os.environ.get("MODELS_DIR")
    if target:
        return Path(target)
    return Path(__file__).resolve().parents[2] / "models"

MODELS_DIR = _get_models_dir()

# Reject detections below this confidence
MIN_DET_SCORE = 0.7


def bytes_to_cv2(image_bytes: bytes) -> np.ndarray:
    """Convert raw image bytes to an OpenCV BGR numpy array."""
    arr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image — check JPEG format")
    return img


class FaceDetector:
    """Wraps InsightFace FaceAnalysis for single-face detection."""

    def __init__(self) -> None:
        self.app = None  # loaded lazily
        self.model_name = os.environ.get("INSIGHTFACE_MODEL", "buffalo_sc")

    def load(self) -> None:
        """Download (first run) and prepare the SCRFD detector + ArcFace model with minimal RAM footprint."""
        from insightface.app import FaceAnalysis

        logger.info(
            "FaceDetector: loading %s from %s (modules: detection, recognition only)", self.model_name, MODELS_DIR
        )
        # allowed_modules prevents loading unused 2d106, 3d68, and genderage models into RAM (<120MB total)
        self.app = FaceAnalysis(
            name=self.model_name,
            root=str(MODELS_DIR),
            allowed_modules=["detection", "recognition"],
        )
        self.app.prepare(ctx_id=-1, det_size=(320, 320))  # CPU optimized resolution
        logger.info("FaceDetector: models ready")

    def detect(self, image_bytes: bytes) -> dict:
        """
        Detect faces in an image.

        Returns a dict with:
            success: bool
            reason: str (only if success is False)
            bbox, landmarks, det_score, face_object (only if success is True)
        """
        if self.app is None:
            raise RuntimeError("FaceDetector not loaded — call load() first")

        img = bytes_to_cv2(image_bytes)
        faces = self.app.get(img)

        # Filter by minimum detection score
        faces = [f for f in faces if float(f.det_score) >= MIN_DET_SCORE]

        if len(faces) == 0:
            return {"success": False, "reason": "no_face_detected"}

        if len(faces) > 1:
            return {"success": False, "reason": "multiple_faces"}

        face = faces[0]
        return {
            "success": True,
            "bbox": face.bbox.tolist(),
            "landmarks": face.kps.tolist(),  # 5-point landmarks
            "det_score": float(face.det_score),
            "face_object": face,  # raw InsightFace Face — needed for embedding
        }
