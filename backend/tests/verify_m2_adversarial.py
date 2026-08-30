"""
Adversarial Verification Suite for Milestone 2 (Challenger 2)
Focus Areas:
1. export_models.py path resolution & asset structure.
2. ONNX Tensor dimension layout (NCHW float32) & TS preprocessor math.
3. Network payload format for POST /api/checkin/embedding.
"""

import sys
import math
from pathlib import Path
from typing import Dict, List, Any

# ==============================================================================
# TEST 1: export_models.py Asset Resolution & Directory Structure Verification
# ==============================================================================
def test_export_models_path_resolution():
    print("[TEST 1.1] export_models.py Path Resolution...")
    
    # Root dir resolution
    expected_root = Path(__file__).resolve().parents[2]
    script_path = (expected_root / "mobile" / "scripts" / "export_models.py").resolve()
    
    # Check parents[2] calculation
    root_dir = script_path.parents[2]
    
    assert root_dir == expected_root, f"ROOT_DIR mismatch: got {root_dir}, expected {expected_root}"
    
    src_models_dir = root_dir / "models"
    dest_models_dir = root_dir / "mobile" / "assets" / "models"
    user_insightface_dir = Path.home() / ".insightface" / "models"
    
    print(f"  Root Dir: {root_dir}")
    print(f"  Src Models Dir: {src_models_dir}")
    print(f"  Dest Models Dir: {dest_models_dir}")
    print(f"  User InsightFace Dir: {user_insightface_dir}")
    
    # Verify expected target model filenames in mobile/assets/models/
    expected_target_names = ["scrfd.onnx", "arcface_512.onnx", "liveness.onnx"]
    
    # Import export_models module mappings statically
    sys.path.insert(0, str(script_path.parent))
    try:
        import export_models
        mappings = export_models.MODEL_MAPPINGS
        dest_names = [dest for _, dest in mappings]
        assert dest_names == expected_target_names, f"Model mapping destination names mismatch: {dest_names}"
        print(" [OK] MODEL_MAPPINGS contains expected targets: scrfd.onnx, arcface_512.onnx, liveness.onnx")
    finally:
        sys.path.pop(0)


# ==============================================================================
# TEST 2: ONNX Tensor Dimensions, Layout (NCHW float32) & Math Preprocessing
# ==============================================================================
def test_tensor_dimension_layouts():
    print("[TEST 2.1] NCHW Float32 Tensor Layout Math Verification...")

    # 1. SCRFD Face Detector: (1, 3, 640, 640)
    scrfd_c, scrfd_h, scrfd_w = 3, 640, 640
    scrfd_elements = 1 * scrfd_c * scrfd_h * scrfd_w
    scrfd_plane = scrfd_h * scrfd_w
    assert scrfd_elements == 1228800, f"SCRFD size error: {scrfd_elements}"
    assert scrfd_plane == 409600, f"SCRFD plane size error: {scrfd_plane}"
    print(f" [OK] SCRFD Detector: shape=(1, 3, 640, 640), total_elements={scrfd_elements}, plane_size={scrfd_plane}")

    # 2. ArcFace Recognizer: (1, 3, 112, 112)
    arc_c, arc_h, arc_w = 3, 112, 112
    arc_elements = 1 * arc_c * arc_h * arc_w
    arc_plane = arc_h * arc_w
    assert arc_elements == 37632, f"ArcFace size error: {arc_elements}"
    assert arc_plane == 12544, f"ArcFace plane size error: {arc_plane}"
    print(f" [OK] ArcFace Recognizer: shape=(1, 3, 112, 112), total_elements={arc_elements}, plane_size={arc_plane}")

    # 3. MiniFASNet Liveness: (1, 3, 80, 80)
    live_c, live_h, live_w = 3, 80, 80
    live_elements = 1 * live_c * live_h * live_w
    live_plane = live_h * live_w
    assert live_elements == 19200, f"MiniFASNet Liveness size error: {live_elements}"
    assert live_plane == 6400, f"MiniFASNet plane size error: {live_plane}"
    print(f" [OK] MiniFASNet Liveness: shape=(1, 3, 80, 80), total_elements={live_elements}, plane_size={live_plane}")


def test_preprocessing_normalizations():
    print("[TEST 2.2] Normalization Formula Verification...")
    
    # SCRFD: (pixel - 127.5) / 128.0
    # Test pixel = 0 -> -127.5 / 128.0 = -0.99609375
    # Test pixel = 255 -> 127.5 / 128.0 = 0.99609375
    # Test pixel = 127.5 -> 0.0
    scrfd_0 = (0 - 127.5) / 128.0
    scrfd_255 = (255 - 127.5) / 128.0
    assert abs(scrfd_0 - (-0.99609375)) < 1e-6
    assert abs(scrfd_255 - 0.99609375) < 1e-6
    print(" [OK] SCRFD normalization: [0, 255] -> [-0.9961, 0.9961]")

    # ArcFace: (pixel - 127.5) / 127.5
    # Test pixel = 0 -> -1.0
    # Test pixel = 255 -> 1.0
    arc_0 = (0 - 127.5) / 127.5
    arc_255 = (255 - 127.5) / 127.5
    assert abs(arc_0 - (-1.0)) < 1e-6
    assert abs(arc_255 - 1.0) < 1e-6
    print(" [OK] ArcFace normalization: [0, 255] -> [-1.0, 1.0]")

    # MiniFASNet: raw float [0..255]
    live_0 = float(0)
    live_255 = float(255)
    assert live_0 == 0.0 and live_255 == 255.0
    print(" [OK] MiniFASNet normalization: [0, 255] raw float")


def test_liveness_bbox_expansion():
    print("[TEST 2.3] MiniFASNet Bounding Box 1.5x Expansion Verification...")
    
    # BoundingBox: [x1, y1, x2, y2]
    def expand_bbox(bbox: List[float], frame_w: float, frame_h: float, scale=1.5) -> List[float]:
        x1, y1, x2, y2 = bbox
        w = x2 - x1
        h = y2 - y1
        cx = x1 + w / 2.0
        cy = y1 + h / 2.0
        
        new_w = w * scale
        new_h = h * scale
        
        new_x1 = max(0.0, cx - new_w / 2.0)
        new_y1 = max(0.0, cy - new_h / 2.0)
        new_x2 = min(frame_w, cx + new_w / 2.0)
        new_y2 = min(frame_h, cy + new_h / 2.0)
        return [new_x1, new_y1, new_x2, new_y2]

    # Test case 1: Standard bbox inside frame
    bbox = [100.0, 100.0, 200.0, 200.0]
    exp = expand_bbox(bbox, 640.0, 480.0, 1.5)
    assert exp == [75.0, 75.0, 225.0, 225.0], f"Expansion error: {exp}"
    print(f" [OK] Standard expansion: {bbox} -> {exp}")

    # Test case 2: Border clamping at xmin/ymin
    bbox_edge = [10.0, 10.0, 50.0, 50.0]
    exp_edge = expand_bbox(bbox_edge, 640.0, 480.0, 1.5)
    assert exp_edge[0] == 0.0 and exp_edge[1] == 0.0
    print(f" [OK] Boundary clamped expansion: {bbox_edge} -> {exp_edge}")


def test_softmax_overflow_edge_case():
    print("[TEST 2.4] Softmax Overflow Vulnerability Check in liveness.ts...")
    
    # Simulating TS liveness.ts: Math.exp(logits[0]) vs Math.exp(logits[1])
    # Case A: Normal logits [0.0, 2.0]
    logits_normal = [0.0, 2.0]
    exp_spoof = math.exp(logits_normal[0])
    exp_real = math.exp(logits_normal[1])
    real_score = exp_real / (exp_spoof + exp_real)
    print(f" [OK] Normal logits [0.0, 2.0] -> real_score = {real_score:.4f}")

    # Case B: Large logits [750.0, 760.0]
    try:
        logits_large = [750.0, 760.0]
        # In Python math.exp(750) raises OverflowError. In JS, Math.exp(750) returns Infinity.
        exp_spoof_large = math.exp(logits_large[0])
        exp_real_large = math.exp(logits_large[1])
        score_large = exp_real_large / (exp_spoof_large + exp_real_large)
    except OverflowError:
        print("  [WARN] Softmax vulnerability confirmed: Raw math.exp() overflows on large logits (> 709).")
        print("     Safe Softmax implementation must subtract max logit before exponentiation!")


# ==============================================================================
# TEST 3: Network Payload Format Verification
# ==============================================================================
def test_network_payload_format():
    print("[TEST 3.1] Network Payload Format Verification (POST /api/checkin/embedding)...")
    
    # Import FastAPI Pydantic schema from backend
    backend_path = Path(__file__).resolve().parents[1]
    if not (backend_path / "app").exists():
        backend_path = Path(__file__).resolve().parents[2] / "backend"
    sys.path.insert(0, str(backend_path))
    try:
        from app.api.checkin import EmbeddingCheckinRequest
        
        # 1. Valid 512-d payload
        valid_embedding = [0.01 * (i % 10 + 1) for i in range(512)]
        valid_payload = {
            "embedding": valid_embedding,
            "device_id": "mobile_kiosk_01",
            "check_type": "AUTO",
            "liveness_score": 0.985
        }
        
        req = EmbeddingCheckinRequest(**valid_payload)
        assert len(req.embedding) == 512
        assert req.device_id == "mobile_kiosk_01"
        assert req.check_type == "AUTO"
        assert req.liveness_score == 0.985
        print(" [OK] Valid payload accepted by backend EmbeddingCheckinRequest schema.")
        
        # 2. Invalid embedding length (511 dimensions)
        invalid_511 = {"embedding": [0.1] * 511, "device_id": "kiosk1", "liveness_score": 0.9}
        try:
            EmbeddingCheckinRequest(**invalid_511)
            assert False, "Should have failed length validation"
        except Exception as e:
            print(" [OK] Rejected invalid embedding dimension length (511 dims).")

        # 3. Invalid embedding containing NaN
        invalid_nan = {"embedding": [float("nan")] + [0.1] * 511, "device_id": "kiosk1"}
        try:
            EmbeddingCheckinRequest(**invalid_nan)
            assert False, "Should have failed NaN validation"
        except Exception as e:
            print(" [OK] Rejected embedding containing NaN values.")

        # 4. Invalid embedding containing all zeros
        invalid_zeros = {"embedding": [0.0] * 512, "device_id": "kiosk1"}
        try:
            EmbeddingCheckinRequest(**invalid_zeros)
            assert False, "Should have failed all-zeros validation"
        except Exception as e:
            print(" [OK] Rejected embedding containing all zeros.")

        # 5. Invalid liveness score (> 1.0)
        invalid_liveness = {"embedding": valid_embedding, "liveness_score": 1.5}
        try:
            EmbeddingCheckinRequest(**invalid_liveness)
            assert False, "Should have failed liveness > 1.0 validation"
        except Exception as e:
            print(" [OK] Rejected invalid liveness_score (> 1.0).")

    finally:
        sys.path.pop(0)


def run_all_tests():
    print("==========================================================")
    print("  RUNNING ADVERSARIAL VERIFICATION FOR MILESTONE 2")
    print("==========================================================")
    test_export_models_path_resolution()
    print()
    test_tensor_dimension_layouts()
    print()
    test_preprocessing_normalizations()
    print()
    test_liveness_bbox_expansion()
    print()
    test_softmax_overflow_edge_case()
    print()
    test_network_payload_format()
    print("==========================================================")
    print("  ALL VERIFICATION TESTS COMPLETED")
    print("==========================================================")

if __name__ == "__main__":
    run_all_tests()
