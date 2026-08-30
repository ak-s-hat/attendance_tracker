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

# Models are mounted as a volume (not copied) — see docker-compose.yml
# This keeps the image small (~300MB models stay on host)

EXPOSE 8000

# Run with uvicorn — reload is off in production container
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
