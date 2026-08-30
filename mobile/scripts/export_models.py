import shutil
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_MODELS_DIR = ROOT_DIR / "models"
DEST_MODELS_DIR = ROOT_DIR / "mobile" / "assets" / "models"
USER_INSIGHTFACE_DIR = Path.home() / ".insightface" / "models"

DEST_MODELS_DIR.mkdir(parents=True, exist_ok=True)

MODEL_MAPPINGS = [
    # (candidate source relative paths list, destination file name)
    (
        [
            SRC_MODELS_DIR / "buffalo_l" / "det_10g.onnx",
            USER_INSIGHTFACE_DIR / "buffalo_l" / "det_10g.onnx",
            SRC_MODELS_DIR / "det_10g.onnx",
        ],
        "scrfd.onnx",
    ),
    (
        [
            SRC_MODELS_DIR / "buffalo_l" / "w600k_r50.onnx",
            USER_INSIGHTFACE_DIR / "buffalo_l" / "w600k_r50.onnx",
            SRC_MODELS_DIR / "w600k_r50.onnx",
        ],
        "arcface_512.onnx",
    ),
    (
        [
            SRC_MODELS_DIR / "2.7_80x80_MiniFASNetV2.onnx",
            SRC_MODELS_DIR / "minifasnet_v2_se.onnx",
            SRC_MODELS_DIR / "liveness.onnx",
        ],
        "liveness.onnx",
    ),
]

def export_models():
    print("==> Preparing ONNX model assets for mobile/assets/models/...")
    copied_count = 0
    missing_count = 0

    for candidates, dest_name in MODEL_MAPPINGS:
        dest_path = DEST_MODELS_DIR / dest_name
        found_source = None

        for cand in candidates:
            if cand.exists():
                found_source = cand
                break

        if found_source:
            shutil.copy2(found_source, dest_path)
            print(f"  [COPIED] {found_source} -> {dest_path.name}")
            copied_count += 1
        elif dest_path.exists():
            print(f"  [EXISTS] {dest_path.name}")
            copied_count += 1
        else:
            print(f"  [MISSING] No source found for {dest_name}")
            missing_count += 1

    print(f"==> Export finished: {copied_count} present/copied, {missing_count} missing.")

if __name__ == "__main__":
    export_models()
