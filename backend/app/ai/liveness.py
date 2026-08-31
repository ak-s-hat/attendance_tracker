"""Liveness checker using MiniFASNetV2-SE ONNX anti-spoofing model with fallback stub."""

import logging
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

import os

import os
from app.core.config import settings

logger = logging.getLogger(__name__)


def _find_models_dir() -> Path:
    target = settings.MODELS_DIR or os.environ.get("MODELS_DIR")
    if target:
        return Path(target)
    default_ml = Path("D:/ML/models")
    if default_ml.exists():
        return default_ml
    current = Path(__file__).resolve()
    for parent in current.parents:
        candidate = parent / "models"
        if candidate.is_dir():
            return candidate
    return current.parents[3] / "models" if len(current.parents) > 3 else Path("models")


MODELS_DIR = _find_models_dir()


class LivenessChecker:
    """MiniFASNetV2-SE ONNX anti-spoofing checker with graceful fallback."""

    def __init__(
        self,
        model_path: Optional[str] = None,
        threshold: Optional[float] = None,
    ) -> None:
        self.threshold = threshold if threshold is not None else getattr(settings, "LIVENESS_THRESHOLD", 0.6)
        self.session = None
        self.input_name = None
        self.input_shape = None
        self.model_loaded = False

        # Resolution order for model file
        candidates = [
            Path(model_path) if model_path else None,
            MODELS_DIR / "minifasnet_v2_se.onnx",
            MODELS_DIR / "minifasnet_int8.onnx",
            MODELS_DIR / "2.7_80x80_MiniFASNetV2.onnx",
            Path(__file__).resolve().parents[2] / "models" / "minifasnet_v2_se.onnx",
            Path(__file__).resolve().parents[2] / "models" / "minifasnet_int8.onnx",
        ]
        target_path = None
        for cand in candidates:
            if cand and cand.exists():
                target_path = cand
                break

        if target_path and target_path.exists():
            try:
                import onnxruntime as ort

                self.session = ort.InferenceSession(
                    str(target_path), providers=["CPUExecutionProvider"]
                )
                self.input_name = self.session.get_inputs()[0].name
                self.input_shape = self.session.get_inputs()[0].shape
                self.model_loaded = True
                logger.info("LivenessChecker: ONNX model loaded from %s (threshold=%.2f)", target_path, self.threshold)
            except Exception as e:
                logger.warning(
                    "LivenessChecker: Failed to load ONNX model (%s). Falling back to stub mode.",
                    e,
                )
                self.model_loaded = False
        else:
            logger.info(
                "LivenessChecker: ONNX weights not found at %s. Operating in stub mode.",
                target_path,
            )

    def check(self, image_bytes: bytes, bbox: list) -> dict:
        """
        Evaluate face image for liveness.

        Returns dict with is_live (bool), score (float), and note (str).
        """
        if not self.model_loaded or self.session is None:
            return {
                "is_live": True,
                "score": 1.0,
                "note": "liveness_stub_fallback",
            }

        try:
            arr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if img is None:
                return {"is_live": False, "score": 0.0, "note": "decode_failed"}

            h, w, _ = img.shape
            x1, y1, x2, y2 = map(int, bbox)

            # MiniFASNet requires 2.7x expanded context crop for accurate spatial feature analysis
            bw = x2 - x1
            bh = y2 - y1
            cx = x1 + bw / 2.0
            cy = y1 + bh / 2.0
            max_side = max(bw, bh) * 2.7
            nx1 = int(max(0, cx - max_side / 2.0))
            ny1 = int(max(0, cy - max_side / 2.0))
            nx2 = int(min(w, cx + max_side / 2.0))
            ny2 = int(min(h, cy + max_side / 2.0))

            crop = img[ny1:ny2, nx1:nx2]
            if crop.size == 0:
                crop = img[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]
            if crop.size == 0:
                return {"is_live": False, "score": 0.0, "note": "invalid_crop"}

            # Standard MiniFASNet 80x80 input preprocessing
            target_h = (
                self.input_shape[2]
                if self.input_shape and len(self.input_shape) >= 4 and isinstance(self.input_shape[2], int)
                else 80
            )
            target_w = (
                self.input_shape[3]
                if self.input_shape and len(self.input_shape) >= 4 and isinstance(self.input_shape[3], int)
                else 80
            )

            resized = cv2.resize(crop, (target_w, target_h))
            resized_rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            input_tensor = resized_rgb.astype(np.float32).transpose(2, 0, 1)
            input_tensor = np.expand_dims(input_tensor, axis=0)

            outputs = self.session.run(None, {self.input_name: input_tensor})
            logits = outputs[0][0]
            exp_logits = np.exp(logits - np.max(logits))
            probs = exp_logits / np.sum(exp_logits)

            real_score = float(probs[1]) if len(probs) > 1 else float(probs[0])
            is_live = real_score >= self.threshold

            return {
                "is_live": is_live,
                "score": round(real_score, 4),
                "note": "minifasnet_v2_se_onnx",
            }
        except Exception as e:
            logger.error("LivenessChecker inference error: %s", e)
            return {
                "is_live": False,
                "score": 0.0,
                "note": "liveness_inference_error",
            }
