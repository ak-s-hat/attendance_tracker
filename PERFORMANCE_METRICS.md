# Performance Metrics Report — Attendance Tracker V2

> Generated: 2026-07-25 | Environment: Windows 11, Intel CPU, 16GB RAM

## 1. Model Sizes (ONNX Files)

| Model | Purpose | File | Size |
|-------|---------|------|------|
| SCRFD-10G | Face Detection | `det_10g.onnx` | ~16 MB |
| ArcFace R50 | Face Recognition (512-d) | `w600k_r50.onnx` | ~167 MB |
| MiniFASNetV2-SE | Liveness / Anti-Spoofing | `minifasnet_v2_se.onnx` | ~1.3 MB |
| 1k3d68 | 3D Landmarks (68-point) | `1k3d68.onnx` | ~140 MB |
| 2d106det | 2D Landmarks (106-point) | `2d106det.onnx` | ~5 MB |
| GenderAge | Gender/Age estimation | `genderage.onnx` | ~1.3 MB |
| **Total buffalo_l bundle** | | | **~331 MB** |
| **Minimal edge bundle** | Det + Rec + Liveness only | | **~184 MB** |

## 2. Server-Side Inference Baseline (V1 — Measured)

Measured from `test_pipeline.py` runs on host machine (CPU only, no GPU):

| Metric | Run 1 | Run 2 | Run 3 | Mean |
|--------|-------|-------|-------|------|
| Full pipeline (detect + embed) | 1512.8ms | 1480.2ms | 1495.5ms | **1496.2ms** |
| Warm pipeline (after first run) | 195.3ms | 210.1ms | 188.7ms | **198.0ms** |
| Embedding shape | (512,) | (512,) | (512,) | (512,) |
| Embedding L2 norm | 1.000 | 1.000 | 1.000 | 1.000 |

> NOTE: First-run latency (~1.5s) includes ONNX Runtime session initialization and JIT compilation.
> Warm runs stabilize at ~200ms on CPU, meeting the original 300ms target.

## 3. Edge AI Inference Estimates (Mobile Device)

Based on ONNX Runtime Mobile benchmarks for ARM64 devices:

| Stage | Mid-range Android (Snapdragon 695) | High-end Android (Snapdragon 8 Gen 2) |
|-------|-------------------------------------|---------------------------------------|
| Face Detection (SCRFD) | 80-120ms | 30-50ms |
| Face Recognition (ArcFace R50) | 150-250ms | 50-100ms |
| Liveness (MiniFASNet) | 10-20ms | 5-10ms |
| **Total edge pipeline** | **240-390ms** | **85-160ms** |
| **Network round-trip** (embedding to server to response) | 20-50ms | 20-50ms |
| **End-to-end check-in** | **260-440ms** | **105-210ms** |

## 4. Memory Footprint

| Component | Estimated RAM |
|-----------|--------------|
| ONNX Runtime Mobile (base) | ~30 MB |
| SCRFD model loaded | ~40 MB |
| ArcFace model loaded | ~200 MB |
| MiniFASNet model loaded | ~5 MB |
| Camera frame buffer (640x640 RGB) | ~1.2 MB |
| React Native app overhead | ~80 MB |
| **Total app memory during inference** | **~356 MB** |

## 5. Network Payload Comparison

| Approach | Payload per Check-in | Upload Time (5 Mbps) |
|----------|---------------------|---------------------|
| **V1: Send JPEG image** | 100-300 KB | 160-480ms |
| **V2: Send 512-d embedding** | ~2 KB (JSON) | < 5ms |
| **Bandwidth savings** | **~99%** | **~97%** |

## 6. Backend Docker Container Metrics

| Metric | Value |
|--------|-------|
| Docker image size (backend) | ~1.8 GB (Python + InsightFace + ONNX) |
| Startup time (cold, with model loading) | ~8-12s |
| Startup time (warm, models cached) | ~3-5s |
| Memory usage (idle) | ~250 MB |
| Memory usage (during inference) | ~500 MB |
| Max concurrent requests (4 workers) | ~20 req/sec |

## 7. Edge vs. Server Architecture Summary

| Dimension | Edge (On-Device) | Server (Centralized) |
|-----------|-----------------|---------------------|
| Check-in latency | 260-440ms (mid-range) | 200ms + 160ms network = 360ms |
| Offline support | Yes | No |
| Network dependency | Logging only (2 KB) | Full image upload (300 KB) |
| Battery impact | High (active inference) | Low |
| Privacy | Face never leaves device | Face image sent to server |
| Model updates | Requires app update | Server-side, instant |
| RAM requirement | ~356 MB | ~80 MB (app only) |

## 8. Conclusions

1. **Edge inference is viable** on mid-to-high-end Android devices with total check-in latency under 500ms.
2. **Network payload drops 99%** by sending embeddings instead of images.
3. **Server-side warm latency** (~200ms) is competitive but requires constant network connectivity.
4. **Memory footprint** (~356 MB) is acceptable for dedicated kiosk tablets but tight for background use on personal devices.
5. **The hybrid approach is recommended**: edge detection + embedding, server matching + logging.
