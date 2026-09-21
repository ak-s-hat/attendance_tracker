# Backend Dockerfile — FastAPI + InsightFace + ONNX Runtime
# Handles ALL Python dependencies inside the container.
FROM python:3.11-slim

# System dependencies for OpenCV and InsightFace
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY . .

# Pre-download lightweight buffalo_sc models (~14MB) during docker build
# so the container NEVER downloads model weights at runtime on cold starts
RUN python -c "from insightface.app import FaceAnalysis; app = FaceAnalysis(name='buffalo_sc', allowed_modules=['detection', 'recognition']); app.prepare(ctx_id=-1, det_size=(320, 320))"


EXPOSE 8000

# Run with uvicorn — reload is off in production container
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
