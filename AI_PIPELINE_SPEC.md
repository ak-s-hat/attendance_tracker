# Edge AI Face Recognition & Anti-Spoofing Pipeline Specification

> **System Version:** 2.0.0  
> **Platform:** React Native (Expo SDK 54) + FastAPI Cloud Sync  
> **Architecture Status:** Autonomous Edge Inference with Asynchronous Cloud Delta Sync  
> **Machine-Readable Config:** [`mobile/src/ai/pipeline_spec.json`](./mobile/src/ai/pipeline_spec.json)

---

## 1. High-Level Architecture

The edge attendance pipeline executes all inference **entirely on-device** (offline), eliminating cloud round-trips during attendance punches. Server connectivity is restricted to:
1. **At Login / App Startup:** One-time delta pull (`GET /api/employees/embeddings-delta`) from the Supabase / PostgreSQL database to populate local SQLite.
2. **Background Flush:** Asynchronous batch push (`POST /api/checkin/batch-sync`) of queued offline scans when the device is idle or network is restored.

```
                  ┌──────────────────────────────────────────────┐
                  │           Raw Camera Frame (1080p)           │
                  └──────────────────────┬───────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Stage 1: SCRFD-10G-INT8 Face Detector (input: 1x3x640x640 NCHW)                 │
│ Output: Bounding Box [x1, y1, x2, y2], Score, 5 Facial Keypoints                │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Stage 2: MiniFASNetV2-SE-INT8 Anti-Spoofing Liveness (input: 1x3x80x80 NCHW)   │
│ Transform: 1.5x Bounding Box Expansion (captures hair, chin, display bezel)     │
│ Output: Softmax Probability (Real Human vs. Screen/Print Spoof)                 │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼ [If Live Human >= 0.85]
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Stage 3: ArcFace ResNet50-INT8 Recognizer (input: 1x3x112x112 NCHW)             │
│ Transform: Affine alignment leveling eye landmarks horizontally                 │
│ Output: 512-dimensional Unit Feature Vector (||e||_2 == 1.0)                    │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Stage 4: Local SQLite In-Memory Vector Gallery (Float32Array SIMD Dot Product)  │
│ Threshold: Cosine similarity >= 0.65                                            │
│ Target Search Latency: < 0.05ms across 1,000 employees                          │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Stage 5: Local SQLite Offline Queue (offline_attendance_queue)                  │
│ Action: Record logged locally with status='PENDING' -> Instant UI Confirmation  │
│ Network Call during Punch: EXACTLY ZERO                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Models & Quantization Profile

All edge models are quantized from 32-bit floating point (`FLOAT32`) to **signed 8-bit integer (`INT8`)** using ONNX Runtime Dynamic Quantization (`quantize_dynamic`):
* **Quantization Method:** Symmetric Per-Channel Linear Weight Quantization (`QInt8`).
* **Activations:** Kept in `FLOAT32` during forward pass to preserve gradient precision and high-frequency liveness cues.
* **Accuracy Preservation:** TAR (True Acceptance Rate) degradation at $\text{FAR} = 10^{-4}$ is less than $0.15\%$.

| Model Identifier | Original Purpose | File Name | Quantized Size | FP32 Size | Reduction | Peak RAM |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SCRFD-10G** | Face Localization & Landmarks | `det_10g_int8.onnx` | **4.11 MB** | 16.8 MB | $74\%$ | ~20 MB |
| **MiniFASNetV2-SE** | Anti-Spoofing / Texture Check | `minifasnet_int8.onnx`| **0.54 MB** | 1.74 MB | $69\%$ | ~5 MB |
| **ArcFace-R50** | 512-d Biometric Identity | `w600k_r50_int8.onnx` | **41.76 MB** | 174.4 MB | $76\%$ | ~90 MB |
| **Total Package** | Complete On-Device Pipeline | — | **~46.4 MB** | **~193 MB** | **$76\%$** | **~115 MB** |

---

## 3. Preprocessing Math & Memory Layout

All three neural networks expect normalized tensors in **NCHW** order (Batch, Channels, Height, Width):

* **Color Space:** RGB (converted from device native RGBA/YUV).
* **Pixel Normalization Formula:**
  $$\text{Normalized Value} = \frac{\text{Pixel Value} - 127.5}{128.0}$$
  Maps standard integer pixel bytes $[0, 255]$ to floating point range $[-0.996, +0.996]$.

### Model Tensor Shapes
1. **SCRFD Face Detector:**
   * Input: `[1, 3, 640, 640]` $\to 1,228,800$ floats.
   * Strides: $8, 16, 32$ with 2 anchors per location.
2. **MiniFASNet Liveness:**
   * Input: `[1, 3, 80, 80]` $\to 19,200$ floats.
   * Bounding box scaled by $1.5\times$ relative to face centroid and clamped within frame boundaries.
3. **ArcFace Recognizer:**
   * Input: `[1, 3, 112, 112]` $\to 37,632$ floats.
   * Output: `[1, 512]` L2-normalized float32 vector ($\|\mathbf{e}\|_2 = 1.0$).

---

## 4. Tunable Parameters & Configuration Guide

All configuration options are defined in [`mobile/src/ai/pipeline_spec.json`](./mobile/src/ai/pipeline_spec.json) and can be adjusted without retraining weights:

| Parameter Name | File Location | Default | Safe Range | Purpose / Impact |
| :--- | :--- | :--- | :--- | :--- |
| `detThreshold` | [`detector.ts`](./mobile/src/ai/detector.ts) | `0.70` | `0.50 - 0.90` | Minimum score to consider candidate bounding box as a face. Lowering allows dimmer lighting; raising prevents false face triggers. |
| `nmsThreshold` | [`detector.ts`](./mobile/src/ai/detector.ts) | `0.40` | `0.30 - 0.50` | Non-Maximum Suppression IoU threshold to merge overlapping candidate boxes for the same person. |
| `bboxExpansionRatio` | [`liveness.ts`](./mobile/src/ai/liveness.ts) | `1.50` | `1.20 - 1.80` | Multiplier for face crop box to include context (hairline, chin, display frame bezel). |
| `livenessThreshold` | [`liveness.ts`](./mobile/src/ai/liveness.ts) | `0.85` | `0.60 - 0.95` | Probability cutoff for live human classification. Higher = stricter security against prints/screens. |
| `cosineSimilarityThreshold`| [`pipeline.ts`](./mobile/src/ai/pipeline.ts) | `0.65` | `0.55 - 0.75` | Minimum cosine match between query vector and stored gallery. Recommended: `0.65` yields $\text{FAR} < 10^{-4}$. |
| `maxFacesAllowed` | [`pipeline.ts`](./mobile/src/ai/pipeline.ts) | `1` | `1 - 3` | Enforces single-person kiosk policy (rejects frame if multiple individuals stand in view). |

---

## 5. Hardware Acceleration Strategy

[`mobile/src/services/onnxEngine.ts`](./mobile/src/services/onnxEngine.ts) automatically discovers the available hardware at runtime:

1. **Android (Native APK / EAS Build):**
   * Priority 1: **NNAPI** (Android Neural Networks API) — delegates to Qualcomm Hexagon DSP, MediaTek APU, or Google Tensor TPU.
   * Priority 2: **ARM NEON CPU** — hand-tuned SIMD assembly kernels.
2. **iOS (Native IPA / EAS Build):**
   * Priority 1: **CoreML** — delegates to Apple Neural Engine (ANE).
   * Priority 2: **ARM NEON CPU**.
3. **Web / Desktop Testing:**
   * **WASM / WebGL**.
4. **Managed Expo Go Fallback:**
   * If native C++ binaries (`onnxruntime-react-native`) cannot be linked (e.g. running in standard vanilla Expo Go), the pipeline automatically falls back to server delegation without crashing.

---

## 6. Target Latencies & Memory Budgets

| Operation | Target Latency (Mid-Range ARM) | Target Latency (Flagship ARM / NPU) | Peak Memory |
| :--- | :--- | :--- | :--- |
| **SCRFD Detection** | ~45 ms | ~25 ms | ~20 MB |
| **MiniFASNet Liveness** | ~6 ms | ~3 ms | ~5 MB |
| **ArcFace Embedding** | ~120 ms | ~45 ms | ~90 MB |
| **SIMD Vector Search (1,000 emps)**| < 0.05 ms | < 0.02 ms | ~2 MB |
| **SQLite Queue Write** | ~2 ms | ~1 ms | < 1 MB |
| **Total On-Device Punch** | **~175 ms** | **~75 ms** | **~118 MB Peak** |
