# Anti-Spoof & Liveness Forensic Lab 🔬

Interactive diagnostic environment to inspect and test Face Detection (SCRFD) and Anti-Spoof / Presentation Attack Detection (MiniFASNetV2) using your laptop's webcam in real time.

---

## 🚀 How to Run

Run this command in PowerShell from the project root:

```powershell
.\anti_spoof_lab\run_inspector.ps1
```

Or directly via python:

```powershell
.\backend\venv\Scripts\python.exe anti_spoof_lab\inspector.py
```

### Options:
* `--camera <index>`: Select webcam index (default: `0`)
* `--threshold <float>`: Adjust real vs spoof cutoff threshold (default: `0.60`)
* `--image <path>`: Run full analysis on a saved image file instead of live webcam

Example:
```powershell
.\backend\venv\Scripts\python.exe anti_spoof_lab\inspector.py --threshold 0.65 --camera 0
```

---

## 🎮 Interactive Controls in Live Webcam Window

| Key | Action | Description |
| :--- | :--- | :--- |
| **`[SPACE]`** | **Deep Forensic Capture** | Freezes current frame, extracts all micro-features, and generates complete diagnostic report subfolder. |
| **`[A]`** | **Toggle Auto-Test** | Automatically captures and analyzes a frame every 3 seconds. |
| **`[T]`** | **Increase Threshold** | Raises liveness threshold by `+0.05` on the fly. |
| **`[G]`** | **Decrease Threshold** | Lowers liveness threshold by `-0.05` on the fly. |
| **`[Q]` / `[ESC]`** | **Quit** | Closes camera feed and exits. |

---

## 📂 Output Structure

Every time you press **`[SPACE]`** (or in auto mode), a new folder is created in `anti_spoof_lab/runs/run_<timestamp>_<REAL|SPOOF>/` containing:

1. `01_raw_frame.jpg` — Exact original camera frame
2. `02_detected_face_bbox.jpg` — Frame with SCRFD bounding box `[x1, y1, x2, y2]`, confidence, and 5 facial landmarks
3. `03_face_crop_context.jpg` — 2.7x scaled contextual face crop
4. `04_model_input_80x80.jpg` — Normalized 80x80 RGB tensor fed into MiniFASNet
5. `05_fft_frequency_spectrum.png` — 2D Fast Fourier Transform (FFT) frequency spectrum & High-Frequency Energy Ratio (HFER) for Moiré screen grid detection
6. `06_laplacian_texture_gradient.png` — 2nd-derivative Laplacian micro-texture gradient & surface variance
7. `07_lbp_texture_map.png` — Local Binary Patterns (LBP) micro-surface descriptor
8. `08_specular_glare_heatmap.png` — Glass/screen reflection & highlight saturation hotspot heatmap
9. `09_color_space_analysis.png` — RGB & HSV color gamut histograms and skin chrominance clustering
10. `10_comprehensive_diagnostic_dashboard.png` — High-resolution 9-panel visual forensic dashboard summarizing all extracted signals, probabilities, and verdict
11. `report.json` — Structured machine-readable metrics, thresholds, and latency data
