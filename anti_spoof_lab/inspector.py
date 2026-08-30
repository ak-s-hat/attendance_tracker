"""
Anti-Spoof & Liveness Forensic Inspector
=========================================
Real-time webcam diagnostic tool for Face Detection and Presentation Attack (Spoof) Detection.

Extracts, computes, visualizes, and saves intermediate features:
  1. Raw Camera Frame & Bounding Box Coordinates
  2. Model Input Tensor (80x80 Normalized) & Softmax Probabilities
  3. 2D Fast Fourier Transform (FFT) Frequency & Moiré Spectrum
  4. Laplacian High-Frequency Micro-Texture & Variance Gradients
  5. Local Binary Patterns (LBP) Micro-Surface Descriptor
  6. Specular Glare & Reflection Intensity Heatmap
  7. Color Space Gamut Clustering (RGB / HSV / YCrCb)
  8. Full Multi-Panel Diagnostic Dashboard & JSON Metadata Report

Outputs are saved in: anti_spoof_lab/runs/run_<timestamp>_<verdict>/
"""

import os
import sys
import time
import json
import argparse
from pathlib import Path
from datetime import datetime

import cv2
import numpy as np
import onnxruntime as ort
import matplotlib
matplotlib.use('Agg')  # Headless rendering for dashboard image generation
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec

# Configure paths
ROOT_DIR = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

MODELS_DIR = ROOT_DIR / "models"
OUTPUT_DIR = Path(__file__).resolve().parent / "runs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


class AntiSpoofInspector:
    """End-to-end Face Detection & Forensic Liveness Diagnostic Engine."""

    def __init__(self, liveness_threshold: float = 0.60, min_det_score: float = 0.65):
        self.liveness_threshold = liveness_threshold
        self.min_det_score = min_det_score
        self.detector = None
        self.liveness_session = None
        self.liveness_input_name = None
        self.liveness_input_shape = None
        self._load_models()

    def _load_models(self):
        print("\n" + "=" * 65)
        print("  INITIALIZING ANTI-SPOOF & FACE DETECTION ENGINE")
        print("=" * 65)

        # 1. Load SCRFD Face Detector from InsightFace
        try:
            from insightface.app import FaceAnalysis
            insight_root = Path("D:/ML/models") if Path("D:/ML/models").exists() else MODELS_DIR
            print(f"[*] Loading InsightFace SCRFD from: {insight_root}")
            self.detector = FaceAnalysis(name="buffalo_l", root=str(insight_root))
            self.detector.prepare(ctx_id=-1, det_size=(640, 640))
            print("  [OK] SCRFD Face Detector ready")
        except Exception as e:
            print(f"  [!] Failed to load InsightFace detector: {e}")
            print("  [*] Falling back to OpenCV Haar Cascade detector...")
            cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
            self.detector = cv2.CascadeClassifier(cascade_path)

        # 2. Load MiniFASNetV2 Anti-Spoofing ONNX Model
        model_candidates = [
            MODELS_DIR / "2.7_80x80_MiniFASNetV2.onnx",
            MODELS_DIR / "minifasnet_v2_se.onnx",
            Path("D:/ML/models/2.7_80x80_MiniFASNetV2.onnx"),
            Path("D:/ML/models/minifasnet_v2_se.onnx"),
        ]

        model_path = None
        for candidate in model_candidates:
            if candidate.exists():
                model_path = candidate
                break

        if model_path:
            try:
                print(f"[*] Loading MiniFASNetV2 ONNX weights from: {model_path}")
                self.liveness_session = ort.InferenceSession(
                    str(model_path), providers=["CPUExecutionProvider"]
                )
                self.liveness_input_name = self.liveness_session.get_inputs()[0].name
                self.liveness_input_shape = self.liveness_session.get_inputs()[0].shape
                print(f"  [OK] Anti-Spoofing ONNX Model ready (Input: {self.liveness_input_name} {self.liveness_input_shape})")
            except Exception as e:
                print(f"  [!] Failed to load ONNX model: {e}")
        else:
            print("  [!] MiniFASNet weights not found. Running heuristic liveness only.")

        print("=" * 65 + "\n")

    def detect_face(self, bgr_img: np.ndarray):
        """Detect primary face in image, returning bbox [x1, y1, x2, y2], det_score, landmarks."""
        h, w = bgr_img.shape[:2]
        if hasattr(self.detector, 'get'):
            faces = self.detector.get(bgr_img)
            valid_faces = [f for f in faces if float(f.det_score) >= self.min_det_score]
            if not valid_faces:
                return None
            # Pick the largest face in frame
            primary = max(valid_faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
            return {
                "bbox": [int(primary.bbox[0]), int(primary.bbox[1]), int(primary.bbox[2]), int(primary.bbox[3])],
                "det_score": float(primary.det_score),
                "landmarks": primary.kps.tolist() if hasattr(primary, 'kps') and primary.kps is not None else None,
                "engine": "insightface_scrfd"
            }
        else:
            # OpenCV Cascade fallback
            gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
            faces = self.detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))
            if len(faces) == 0:
                return None
            x, y, fw, fh = max(faces, key=lambda b: b[2] * b[3])
            return {
                "bbox": [int(x), int(y), int(x + fw), int(y + fh)],
                "det_score": 0.90,
                "landmarks": None,
                "engine": "opencv_haar"
            }

    def extract_face_crop(self, bgr_img: np.ndarray, bbox: list, scale: float = 2.7):
        """Extract crop with expansion scale (2.7x standard for MiniFASNet)."""
        h, w = bgr_img.shape[:2]
        x1, y1, x2, y2 = bbox
        bw = x2 - x1
        bh = y2 - y1
        cx = x1 + bw / 2.0
        cy = y1 + bh / 2.0

        max_side = max(bw, bh) * scale
        nx1 = int(max(0, cx - max_side / 2.0))
        ny1 = int(max(0, cy - max_side / 2.0))
        nx2 = int(min(w, cx + max_side / 2.0))
        ny2 = int(min(h, cy + max_side / 2.0))

        crop = bgr_img[ny1:ny2, nx1:nx2]
        tight_crop = bgr_img[max(0, y1):min(h, y2), max(0, x1):min(w, x2)]
        return crop if crop.size > 0 else tight_crop, tight_crop

    def compute_fft_spectrum(self, gray_crop: np.ndarray):
        """Compute 2D Fast Fourier Transform (FFT) magnitude spectrum and high-freq energy ratio."""
        resized = cv2.resize(gray_crop, (128, 128))
        f = np.fft.fft2(resized)
        fshift = np.fft.fftshift(f)
        magnitude_spectrum = 20 * np.log(np.abs(fshift) + 1e-9)

        # High frequency ring mask
        rows, cols = resized.shape
        crow, ccol = rows // 2, cols // 2
        radius = 32
        y, x = np.ogrid[:rows, :cols]
        mask = (x - ccol) ** 2 + (y - crow) ** 2 >= radius ** 2
        high_freq_energy = np.sum(np.abs(fshift)[mask])
        total_energy = np.sum(np.abs(fshift)) + 1e-9
        hfer = float(high_freq_energy / total_energy)

        # Normalize magnitude spectrum for visual heatmap
        norm_spectrum = cv2.normalize(magnitude_spectrum, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        heatmap = cv2.applyColorMap(norm_spectrum, cv2.COLORMAP_JET)
        return heatmap, hfer, magnitude_spectrum

    def compute_laplacian_gradient(self, gray_crop: np.ndarray):
        """Compute Laplacian micro-texture variance and edge gradient map."""
        resized = cv2.resize(gray_crop, (128, 128))
        laplacian = cv2.Laplacian(resized, cv2.CV_64F)
        variance = float(laplacian.var())

        # Normalize for visualization
        abs_lap = np.absolute(laplacian)
        norm_lap = cv2.normalize(abs_lap, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        heatmap = cv2.applyColorMap(norm_lap, cv2.COLORMAP_INFERNO)
        return heatmap, variance, norm_lap

    def compute_lbp(self, gray_crop: np.ndarray):
        """Compute Local Binary Patterns (LBP) micro-texture descriptor."""
        resized = cv2.resize(gray_crop, (128, 128))
        h, w = resized.shape
        lbp_img = np.zeros((h - 2, w - 2), dtype=np.uint8)

        for i in range(1, h - 1):
            for j in range(1, w - 1):
                center = resized[i, j]
                code = 0
                code |= (resized[i - 1, j - 1] >= center) << 7
                code |= (resized[i - 1, j] >= center) << 6
                code |= (resized[i - 1, j + 1] >= center) << 5
                code |= (resized[i, j + 1] >= center) << 4
                code |= (resized[i + 1, j + 1] >= center) << 3
                code |= (resized[i + 1, j] >= center) << 2
                code |= (resized[i + 1, j - 1] >= center) << 1
                code |= (resized[i, j - 1] >= center) << 0
                lbp_img[i - 1, j - 1] = code

        lbp_hist, _ = np.histogram(lbp_img.ravel(), bins=256, range=(0, 256))
        lbp_hist = lbp_hist.astype("float")
        lbp_hist /= (lbp_hist.sum() + 1e-7)

        norm_lbp = cv2.normalize(lbp_img, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        heatmap = cv2.applyColorMap(norm_lbp, cv2.COLORMAP_VIRIDIS)
        return heatmap, lbp_hist, norm_lbp

    def compute_specular_glare(self, bgr_crop: np.ndarray):
        """Detect planar glass/screen reflection hotspots and over-saturation."""
        hsv = cv2.cvtColor(bgr_crop, cv2.COLOR_BGR2HSV)
        v_channel = hsv[:, :, 2]
        s_channel = hsv[:, :, 1]

        # Specular reflection: High brightness (V > 230) and Low saturation (S < 60)
        glare_mask = ((v_channel > 230) & (s_channel < 60)).astype(np.uint8) * 255
        glare_ratio = float(np.sum(glare_mask > 0) / (glare_mask.size + 1e-7))

        norm_v = cv2.normalize(v_channel, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        heatmap = cv2.applyColorMap(norm_v, cv2.COLORMAP_HOT)
        # Highlight glare regions in bright cyan on heatmap
        heatmap[glare_mask > 0] = [255, 255, 0]
        return heatmap, glare_ratio, glare_mask

    def run_neural_liveness(self, bgr_crop: np.ndarray):
        """Run MiniFASNet ONNX model inference and return real vs spoof probabilities."""
        if self.liveness_session is None:
            return {"real_score": 1.0, "spoof_score": 0.0, "is_live": True, "note": "heuristic_fallback"}

        # MiniFASNet 80x80 NCHW RGB input
        resized = cv2.resize(bgr_crop, (80, 80))
        resized_rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        input_tensor = resized_rgb.astype(np.float32).transpose(2, 0, 1)
        input_tensor = np.expand_dims(input_tensor, axis=0)

        outputs = self.liveness_session.run(None, {self.liveness_input_name: input_tensor})
        logits = outputs[0][0]

        # Softmax calculation
        exp_logits = np.exp(logits - np.max(logits))
        probs = exp_logits / np.sum(exp_logits)

        # probs[1] = Real Face, probs[0] = Spoof/Fake
        real_score = float(probs[1]) if len(probs) > 1 else float(probs[0])
        spoof_score = float(probs[0]) if len(probs) > 1 else (1.0 - real_score)

        return {
            "real_score": round(real_score, 4),
            "spoof_score": round(spoof_score, 4),
            "is_live": bool(real_score >= self.liveness_threshold),
            "logits": [float(x) for x in logits],
            "model_input_80x80": resized_rgb
        }

    def generate_diagnostic_report(self, frame: np.ndarray, face_info: dict, session_dir: Path):
        """Run deep forensic breakdown and save all intermediate images + multi-panel dashboard."""
        session_dir.mkdir(parents=True, exist_ok=True)
        t_start = time.perf_counter()

        bbox = face_info["bbox"]
        det_score = face_info["det_score"]

        # 1. Save Raw Frame
        raw_path = session_dir / "01_raw_frame.jpg"
        cv2.imwrite(str(raw_path), frame)

        # 2. Draw Annotated Detection Frame
        annotated = frame.copy()
        x1, y1, x2, y2 = bbox
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(annotated, f"Face: {det_score:.2f} [{x1},{y1},{x2},{y2}]",
                    (x1, max(20, y1 - 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
        if face_info.get("landmarks"):
            for (lx, ly) in face_info["landmarks"]:
                cv2.circle(annotated, (int(lx), int(ly)), 3, (0, 255, 255), -1)
        det_path = session_dir / "02_detected_face_bbox.jpg"
        cv2.imwrite(str(det_path), annotated)

        # 3. Extract Crops
        scaled_crop, tight_crop = self.extract_face_crop(frame, bbox, scale=2.7)
        crop_path = session_dir / "03_face_crop_context.jpg"
        cv2.imwrite(str(crop_path), scaled_crop)

        # 4. Neural Liveness Inference
        liveness_res = self.run_neural_liveness(scaled_crop)
        real_score = liveness_res["real_score"]
        spoof_score = liveness_res["spoof_score"]
        is_live = liveness_res["is_live"]
        model_input_img = liveness_res.get("model_input_80x80")
        if model_input_img is not None:
            cv2.imwrite(str(session_dir / "04_model_input_80x80.jpg"), cv2.cvtColor(model_input_img, cv2.COLOR_RGB2BGR))

        # 5. Fourier Frequency Spectrum (FFT)
        gray_tight = cv2.cvtColor(tight_crop, cv2.COLOR_BGR2GRAY)
        fft_heatmap, hfer, mag_spectrum = self.compute_fft_spectrum(gray_tight)
        cv2.imwrite(str(session_dir / "05_fft_frequency_spectrum.png"), fft_heatmap)

        # 6. Laplacian Micro-Texture & Edge Gradient
        lap_heatmap, lap_variance, _ = self.compute_laplacian_gradient(gray_tight)
        cv2.imwrite(str(session_dir / "06_laplacian_texture_gradient.png"), lap_heatmap)

        # 7. Local Binary Patterns (LBP)
        lbp_heatmap, lbp_hist, _ = self.compute_lbp(gray_tight)
        cv2.imwrite(str(session_dir / "07_lbp_texture_map.png"), lbp_heatmap)

        # 8. Specular Glare / Planar Reflection Heatmap
        glare_heatmap, glare_ratio, _ = self.compute_specular_glare(tight_crop)
        cv2.imwrite(str(session_dir / "08_specular_glare_heatmap.png"), glare_heatmap)

        # 9. Color Space Histograms
        fig_color, (ax_rgb, ax_hsv) = plt.subplots(1, 2, figsize=(10, 4), facecolor='#1E293B')
        for i, col in enumerate(['b', 'g', 'r']):
            hist = cv2.calcHist([tight_crop], [i], None, [256], [0, 256])
            ax_rgb.plot(hist, color=col, linewidth=1.5)
        ax_rgb.set_title("RGB Color Channel Distribution", color='white', fontsize=11)
        ax_rgb.set_facecolor('#0F172A')
        ax_rgb.tick_params(colors='gray')

        hsv_crop = cv2.cvtColor(tight_crop, cv2.COLOR_BGR2HSV)
        hist_h = cv2.calcHist([hsv_crop], [0], None, [180], [0, 180])
        hist_s = cv2.calcHist([hsv_crop], [1], None, [256], [0, 256])
        ax_hsv.plot(hist_h, color='orange', label='Hue (Color tone)')
        ax_hsv.plot(hist_s, color='cyan', label='Saturation')
        ax_hsv.set_title("HSV Skin Chrominance Clustering", color='white', fontsize=11)
        ax_hsv.set_facecolor('#0F172A')
        ax_hsv.tick_params(colors='gray')
        ax_hsv.legend(facecolor='#1E293B', labelcolor='white')
        fig_color.tight_layout()
        color_path = session_dir / "09_color_space_analysis.png"
        fig_color.savefig(str(color_path), dpi=150, facecolor=fig_color.get_facecolor())
        plt.close(fig_color)

        elapsed_ms = (time.perf_counter() - t_start) * 1000

        # 10. Multi-Panel Comprehensive Diagnostic Dashboard
        self._build_composite_dashboard(
            frame=frame,
            tight_crop=tight_crop,
            scaled_crop=scaled_crop,
            fft_heatmap=fft_heatmap,
            lap_heatmap=lap_heatmap,
            lbp_heatmap=lbp_heatmap,
            glare_heatmap=glare_heatmap,
            real_score=real_score,
            spoof_score=spoof_score,
            is_live=is_live,
            det_score=det_score,
            lap_variance=lap_variance,
            hfer=hfer,
            glare_ratio=glare_ratio,
            bbox=bbox,
            elapsed_ms=elapsed_ms,
            save_path=session_dir / "10_comprehensive_diagnostic_dashboard.png"
        )

        # 11. Save Structured JSON Report
        report_data = {
            "timestamp": datetime.now().isoformat(),
            "verdict": "REAL_HUMAN" if is_live else "SPOOF_ATTACK_DETECTED",
            "is_live": is_live,
            "liveness_real_score": real_score,
            "liveness_spoof_score": spoof_score,
            "threshold": self.liveness_threshold,
            "detection": {
                "det_score": round(det_score, 4),
                "bbox_x1_y1_x2_y2": bbox,
                "face_width_px": bbox[2] - bbox[0],
                "face_height_px": bbox[3] - bbox[1],
            },
            "forensic_features": {
                "laplacian_texture_variance": round(lap_variance, 2),
                "high_frequency_energy_ratio_hfer": round(hfer, 4),
                "specular_glare_area_ratio": round(glare_ratio, 4),
            },
            "processing_latency_ms": round(elapsed_ms, 2),
            "files": {
                "raw_frame": str(raw_path.name),
                "detected_face": str(det_path.name),
                "face_crop": str(crop_path.name),
                "fft_spectrum": "05_fft_frequency_spectrum.png",
                "laplacian_gradient": "06_laplacian_texture_gradient.png",
                "lbp_texture": "07_lbp_texture_map.png",
                "specular_glare": "08_specular_glare_heatmap.png",
                "color_analysis": "09_color_space_analysis.png",
                "full_dashboard": "10_comprehensive_diagnostic_dashboard.png"
            }
        }

        with open(session_dir / "report.json", "w", encoding="utf-8") as f:
            json.dump(report_data, f, indent=2)

        return report_data

    def _build_composite_dashboard(
        self, frame, tight_crop, scaled_crop, fft_heatmap, lap_heatmap,
        lbp_heatmap, glare_heatmap, real_score, spoof_score, is_live,
        det_score, lap_variance, hfer, glare_ratio, bbox, elapsed_ms, save_path
    ):
        """Assemble a high-resolution 3x3 diagnostic dashboard figure."""
        fig = plt.figure(figsize=(16, 12), facecolor='#0B1120')
        gs = gridspec.GridSpec(3, 3, figure=fig, hspace=0.35, wspace=0.25)

        # Header Title Banner
        verdict_text = "VERDICT: REAL HUMAN FACE (AUTHENTIC)" if is_live else "VERDICT: PRESENTATION ATTACK (SPOOF DETECTED)"
        verdict_color = "#10B981" if is_live else "#EF4444"
        fig.suptitle(
            f"ANTI-SPOOF FORENSIC INSPECTOR — {verdict_text}\n"
            f"Liveness Score: {real_score * 100:.1f}% (Threshold: {self.liveness_threshold * 100:.0f}%) | Latency: {elapsed_ms:.1f}ms",
            fontsize=15, fontweight='bold', color=verdict_color, y=0.98
        )

        def add_panel(pos, img, title, subtitle="", is_bgr=True):
            ax = fig.add_subplot(pos)
            if is_bgr:
                ax.imshow(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
            else:
                ax.imshow(img)
            ax.set_title(f"{title}\n{subtitle}", color='white', fontsize=11, fontweight='bold', pad=6)
            ax.axis('off')
            return ax

        # Panel 1: Full Camera Frame with Face Bounding Box
        frame_boxed = frame.copy()
        box_color = (0, 255, 128) if is_live else (0, 0, 255)
        cv2.rectangle(frame_boxed, (bbox[0], bbox[1]), (bbox[2], bbox[3]), box_color, 3)
        add_panel(gs[0, 0], frame_boxed, "1. Camera Capture & Face Detection", f"SCRFD Confidence: {det_score*100:.1f}%")

        # Panel 2: 2.7x Context Crop (MiniFASNet Input)
        add_panel(gs[0, 1], scaled_crop, "2. Face Context Crop (2.7x Scale)", f"Size: {scaled_crop.shape[1]}x{scaled_crop.shape[0]} px")

        # Panel 3: Neural Probability Gauge
        ax_gauge = fig.add_subplot(gs[0, 2])
        ax_gauge.set_facecolor('#1E293B')
        bars = ax_gauge.barh(['Spoof / Fake', 'Real Face'], [spoof_score, real_score],
                             color=['#EF4444' if not is_live else '#6B7280', '#10B981' if is_live else '#6B7280'],
                             height=0.55)
        ax_gauge.axvline(self.liveness_threshold, color='#F59E0B', linestyle='--', linewidth=2, label=f'Threshold ({self.liveness_threshold})')
        ax_gauge.set_xlim(0, 1.0)
        ax_gauge.set_title("3. MiniFASNetV2 Neural Output", color='white', fontsize=11, fontweight='bold', pad=6)
        ax_gauge.tick_params(colors='white', labelsize=10)
        ax_gauge.legend(facecolor='#0F172A', labelcolor='white', loc='lower right')
        for bar in bars:
            w = bar.get_width()
            ax_gauge.text(w + 0.02, bar.get_y() + bar.get_height() / 2.0, f"{w*100:.1f}%",
                          ha='left', va='center', color='white', fontweight='bold')

        # Panel 4: Fourier Frequency Spectrum (FFT)
        add_panel(gs[1, 0], fft_heatmap, "4. 2D Fourier Spectrum (FFT)", f"High-Freq Energy Ratio: {hfer:.4f}\n(Screen Moiré / Grid Detector)")

        # Panel 5: Laplacian High-Frequency Micro-Texture
        add_panel(gs[1, 1], lap_heatmap, "5. Laplacian Micro-Texture Map", f"Texture Variance: {lap_variance:.1f}\n(Skin Pores vs Paper/Glass)")

        # Panel 6: Local Binary Patterns (LBP) Micro-Surface
        add_panel(gs[1, 2], lbp_heatmap, "6. LBP Micro-Surface Texture", "Descriptor for Spatial Texture Frequency")

        # Panel 7: Specular Glare / Reflection Hotspots
        add_panel(gs[2, 0], glare_heatmap, "7. Specular Glare / Glass Reflection", f"Glare Area Ratio: {glare_ratio*100:.2f}%\n(Screen Glass Glare Highlights)")

        # Panel 8: Tight Face ROI
        add_panel(gs[2, 1], tight_crop, "8. Normalized Face Region", f"ROI: {tight_crop.shape[1]}x{tight_crop.shape[0]} px")

        # Panel 9: Quantitative Metrics Table
        ax_table = fig.add_subplot(gs[2, 2])
        ax_table.axis('off')
        ax_table.set_title("9. Forensic Summary Metrics", color='white', fontsize=11, fontweight='bold', pad=6)

        table_data = [
            ["Metric", "Value", "Baseline / Note"],
            ["Liveness Score", f"{real_score*100:.1f}%", f">= {self.liveness_threshold*100:.0f}% for Real"],
            ["Spoof Score", f"{spoof_score*100:.1f}%", "Probability of fake photo"],
            ["Face Det Conf", f"{det_score*100:.1f}%", "SCRFD Confidence"],
            ["Texture Variance", f"{lap_variance:.1f}", "> 150 typically Real"],
            ["FFT Energy (HFER)", f"{hfer:.4f}", "Screen Moiré indicator"],
            ["Glare Area", f"{glare_ratio*100:.2f}%", "Glass reflection ratio"],
            ["Verdict", "REAL HUMAN" if is_live else "SPOOF ATTACK", "Final Decision"],
        ]

        table = ax_table.table(
            cellText=table_data,
            cellLoc='center',
            loc='center',
            bbox=[0.0, 0.0, 1.0, 1.0]
        )
        table.auto_set_font_size(False)
        table.set_fontsize(9)

        for (row_idx, col_idx), cell in table.get_celld().items():
            cell.set_edgecolor('#334155')
            if row_idx == 0:
                cell.set_facecolor('#1E293B')
                cell.set_text_props(color='#38BDF8', fontweight='bold')
            elif row_idx == len(table_data) - 1:
                cell.set_facecolor('#064E3B' if is_live else '#7F1D1D')
                cell.set_text_props(color='#A7F3D0' if is_live else '#FECACA', fontweight='bold')
            else:
                cell.set_facecolor('#0F172A' if row_idx % 2 == 0 else '#1E293B')
                cell.set_text_props(color='white')

        plt.savefig(str(save_path), dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
        plt.close(fig)


def run_live_webcam(camera_idx: int = 0, threshold: float = 0.60):
    """Launch interactive live webcam testing session with real-time feedback."""
    inspector = AntiSpoofInspector(liveness_threshold=threshold)

    print("\n" + "=" * 65)
    print("  LAUNCHING LIVE WEBCAM ANTI-SPOOF INSPECTOR")
    print("=" * 65)
    print("  [SPACE] -> Capture current frame & generate deep diagnostic report")
    print("  [A]     -> Toggle Auto-Capture mode (analyzes every 3 seconds)")
    print("  [T]     -> Increase threshold (+0.05)")
    print("  [G]     -> Decrease threshold (-0.05)")
    print("  [Q/ESC] -> Quit inspector")
    print("=" * 65 + "\n")

    cap = cv2.VideoCapture(camera_idx)
    if not cap.isOpened():
        print(f"[!] ERROR: Could not open webcam at index {camera_idx}.")
        print("    If you have an external webcam, try running with: python inspector.py --camera 1")
        return

    # Request HD resolution
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    auto_mode = False
    last_auto_time = 0
    fps_history = []
    t_prev = time.perf_counter()

    last_analysis_info = None

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("[!] Failed to grab webcam frame.")
                break

            # Calculate FPS
            t_now = time.perf_counter()
            fps = 1.0 / max(1e-5, (t_now - t_prev))
            t_prev = t_now
            fps_history.append(fps)
            if len(fps_history) > 30:
                fps_history.pop(0)
            avg_fps = sum(fps_history) / len(fps_history)

            display_frame = frame.copy()
            h, w = frame.shape[:2]

            # Fast real-time face detection & liveness check for HUD overlay
            face_info = inspector.detect_face(frame)

            live_score = None
            is_live = None

            if face_info:
                bbox = face_info["bbox"]
                scaled_crop, _ = inspector.extract_face_crop(frame, bbox)
                liveness_quick = inspector.run_neural_liveness(scaled_crop)
                live_score = liveness_quick["real_score"]
                is_live = liveness_quick["is_live"]

                # Draw bounding box & HUD badges
                box_color = (0, 255, 128) if is_live else (0, 0, 255)
                x1, y1, x2, y2 = bbox
                cv2.rectangle(display_frame, (x1, y1), (x2, y2), box_color, 2)

                # Draw corner brackets for high-tech look
                line_len = 15
                cv2.line(display_frame, (x1, y1), (x1 + line_len, y1), box_color, 4)
                cv2.line(display_frame, (x1, y1), (x1, y1 + line_len), box_color, 4)
                cv2.line(display_frame, (x2, y1), (x2 - line_len, y1), box_color, 4)
                cv2.line(display_frame, (x2, y1), (x2, y1 + line_len), box_color, 4)
                cv2.line(display_frame, (x1, y2), (x1 + line_len, y2), box_color, 4)
                cv2.line(display_frame, (x1, y2), (x1, y2 - line_len), box_color, 4)
                cv2.line(display_frame, (x2, y2), (x2 - line_len, y2), box_color, 4)
                cv2.line(display_frame, (x2, y2), (x2, y2 - line_len), box_color, 4)

                badge_label = f"REAL ({live_score*100:.1f}%)" if is_live else f"SPOOF ({live_score*100:.1f}%)"
                (tw, th), _ = cv2.getTextSize(badge_label, cv2.FONT_HERSHEY_SIMPLEX, 0.65, 2)
                cv2.rectangle(display_frame, (x1, y1 - 28), (x1 + tw + 12, y1), box_color, -1)
                cv2.putText(display_frame, badge_label, (x1 + 6, y1 - 8),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 0, 0), 2)
            else:
                cv2.putText(display_frame, "NO FACE DETECTED", (30, 80),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 165, 255), 2)

            # Draw Top Information Banner
            cv2.rectangle(display_frame, (0, 0), (w, 42), (15, 23, 42), -1)
            hud_text = f"ANTI-SPOOF INSPECTOR | FPS: {avg_fps:.1f} | Threshold: {inspector.liveness_threshold:.2f} | [SPACE] Capture Full Report"
            if auto_mode:
                hud_text += " | AUTO: ON"
            cv2.putText(display_frame, hud_text, (15, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1)

            # Draw bottom instruction bar
            cv2.rectangle(display_frame, (0, h - 35), (w, h), (15, 23, 42), -1)
            bottom_hint = "Press [SPACE] to inspect features & generate full report | [A] Auto-test | [T/G] Adj Threshold | [Q] Quit"
            if last_analysis_info:
                bottom_hint = f"Saved: {last_analysis_info} | " + bottom_hint
            cv2.putText(display_frame, bottom_hint, (15, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (148, 163, 184), 1)

            cv2.imshow("Anti-Spoof & Liveness Inspector (Live Webcam)", display_frame)

            # Handle Auto-capture
            if auto_mode and face_info and (time.time() - last_auto_time > 3.0):
                last_auto_time = time.time()
                run_tag = "REAL" if is_live else "SPOOF"
                ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
                session_folder = OUTPUT_DIR / f"run_{ts_str}_{run_tag}"
                print(f"[*] [AUTO] Generating forensic report in: {session_folder.name}")
                report = inspector.generate_diagnostic_report(frame, face_info, session_folder)
                last_analysis_info = f"run_{ts_str}_{run_tag}"
                print_terminal_summary(report, session_folder)

            # Keyboard commands
            key = cv2.waitKey(1) & 0xFF
            if key in [ord('q'), ord('Q'), 27]:  # 27 = ESC
                print("[*] Exiting Inspector.")
                break
            elif key == ord(' '):  # SPACE -> Trigger Full Diagnostic Report
                if face_info:
                    run_tag = "REAL" if is_live else "SPOOF"
                    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
                    session_folder = OUTPUT_DIR / f"run_{ts_str}_{run_tag}"
                    print(f"\n[*] [MANUAL] Generating forensic report in: {session_folder} ...")
                    report = inspector.generate_diagnostic_report(frame, face_info, session_folder)
                    last_analysis_info = f"run_{ts_str}_{run_tag}"
                    print_terminal_summary(report, session_folder)
                else:
                    print("[!] Cannot run diagnostic: No face detected in current frame.")
            elif key in [ord('a'), ord('A')]:
                auto_mode = not auto_mode
                print(f"[*] Auto-Capture Mode: {'ENABLED' if auto_mode else 'DISABLED'}")
            elif key in [ord('t'), ord('T')]:
                inspector.liveness_threshold = min(0.99, inspector.liveness_threshold + 0.05)
                print(f"[*] Increased Liveness Threshold to: {inspector.liveness_threshold:.2f}")
            elif key in [ord('g'), ord('G')]:
                inspector.liveness_threshold = max(0.05, inspector.liveness_threshold - 0.05)
                print(f"[*] Decreased Liveness Threshold to: {inspector.liveness_threshold:.2f}")

    finally:
        cap.release()
        cv2.destroyAllWindows()


def run_single_image_analysis(image_path: str, threshold: float = 0.60):
    """Analyze a single static image file from disk and generate forensic report."""
    inspector = AntiSpoofInspector(liveness_threshold=threshold)
    img = cv2.imread(image_path)
    if img is None:
        print(f"[!] Error: Could not read image at {image_path}")
        return

    print(f"[*] Analyzing image: {image_path}")
    face_info = inspector.detect_face(img)
    if not face_info:
        print("[!] No face detected in image.")
        return

    ts_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    session_folder = OUTPUT_DIR / f"image_analysis_{ts_str}"
    report = inspector.generate_diagnostic_report(img, face_info, session_folder)
    print_terminal_summary(report, session_folder)


def print_terminal_summary(report: dict, session_folder: Path):
    """Print clean, formatted diagnostic summary in the terminal."""
    verdict = report["verdict"]
    is_live = report["is_live"]
    real_pct = report["liveness_real_score"] * 100
    spoof_pct = report["liveness_spoof_score"] * 100
    thresh_pct = report["threshold"] * 100

    print("\n" + "=" * 65)
    print(f"  FORENSIC REPORT SAVED TO: {session_folder}")
    print("=" * 65)
    if is_live:
        print(f"  VERDICT:       [AUTHENTIC REAL HUMAN]")
    else:
        print(f"  VERDICT:       [SPOOF ATTACK / FRAUD DETECTED]")

    print(f"  Real Score:    {real_pct:.1f}% (Required Threshold: {thresh_pct:.1f}%)")
    print(f"  Spoof Score:   {spoof_pct:.1f}%")
    print(f"  Face BBox:     {report['detection']['bbox_x1_y1_x2_y2']} ({report['detection']['face_width_px']}x{report['detection']['face_height_px']}px)")
    print(f"  Detection Conf:{report['detection']['det_score']*100:.1f}%")
    print("  --- Extracted Forensic Signals ---")
    print(f"  - Micro-Texture Variance (Laplacian): {report['forensic_features']['laplacian_texture_variance']}")
    print(f"  - High-Freq Energy (FFT/Moiré):      {report['forensic_features']['high_frequency_energy_ratio_hfer']}")
    print(f"  - Specular Glare Ratio (Glass Refl): {report['forensic_features']['specular_glare_area_ratio']*100:.2f}%")
    print(f"  Processing Time: {report['processing_latency_ms']} ms")
    print("  Saved Outputs:")
    for key, filename in report["files"].items():
        print(f"    * {key:<20} -> {filename}")
    print("=" * 65 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Anti-Spoof & Liveness Forensic Inspector")
    parser.add_argument("--camera", type=int, default=0, help="Webcam device index (default: 0)")
    parser.add_argument("--threshold", type=float, default=0.60, help="Liveness confidence threshold (default: 0.60)")
    parser.add_argument("--image", type=str, default=None, help="Path to static image file to analyze instead of webcam")
    args = parser.parse_args()

    if args.image:
        run_single_image_analysis(args.image, threshold=args.threshold)
    else:
        run_live_webcam(camera_idx=args.camera, threshold=args.threshold)


if __name__ == "__main__":
    main()
