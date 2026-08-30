# Complete Cloud Deployment Guide (Supabase + Render.com)

This step-by-step guide walks you through deploying your Attendance Tracker to the cloud so it runs 24/7 without needing your local machine or ngrok.

---

## 🐘 Step 1: Create Free Supabase Cloud Database

1. Go to [supabase.com](https://supabase.com) and click **Start your project** (Free).
2. Choose a project name (e.g., `attendance-tracker-db`) and set a strong database password.
3. Select region: **South Asia (Mumbai - ap-south-1)** for lowest latency.
4. Once the project is created:
   - Click **SQL Editor** on the left menu.
   - Click **New Query**, copy the entire contents of [`supabase_schema.sql`](file:///d:/ML/attendance_tracker/supabase_schema.sql), paste it in, and click **Run**.
   - You will see `"Supabase Schema Initialized Successfully!"`.
5. Get your connection string:
   - Go to **Project Settings** $\rightarrow$ **Database** $\rightarrow$ **Connection string** $\rightarrow$ **URI**.
   - Copy the URI (replace `[YOUR-PASSWORD]` with your actual password).
   - Format for FastAPI:
     ```
     postgresql+asyncpg://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
     ```

---

## ⚡ Step 2: Deploy Backend to Render.com

1. Push your project code to a GitHub repository (e.g. `github.com/your-username/attendance_tracker`).
2. Go to [render.com](https://render.com) and sign in.
3. Click **New +** $\rightarrow$ **Blueprint** (or **Web Service**).
4. Select your GitHub repository. Render will automatically detect [`render.yaml`](file:///d:/ML/attendance_tracker/render.yaml).
5. In the Environment Variables settings, fill in:
   - `DATABASE_URL`: Your Supabase connection string from Step 1.
   - `JWT_SECRET_KEY`: Any long secret random string.
6. Click **Apply / Create Service**.
7. In ~3–4 minutes, Render will build the Docker container and give you a public HTTPS URL:
   ```
   https://attendance-tracker-backend.onrender.com
   ```
8. Verify it by visiting: `https://attendance-tracker-backend.onrender.com/health` in your browser. (Returns `{"status": "ok", "models_loaded": true}`).

---

## 📱 Step 3: Connect Mobile App & Build Cloud APK

1. In [`mobile/app.json`](file:///d:/ML/attendance_tracker/mobile/app.json), update `apiBaseUrl` under `extra`:
   ```json
   "extra": {
     "apiBaseUrl": "https://attendance-tracker-backend.onrender.com"
   }
   ```
2. In terminal, run:
   ```powershell
   cd d:\ML\attendance_tracker\mobile
   eas build --platform android --profile preview
   ```
3. EAS Cloud will build your standalone Android APK.
4. Download and install the `.apk` on any Android device!

---

## 🛡️ Key Cloud Advantages

1. **24/7 Availability**: The Web Registration Portal and admin management are accessible from anywhere in the world on HTTPS without ngrok.
2. **Offline-Resilient Kiosk**: Even if your kiosk phone loses cellular or Wi-Fi connectivity, employees can still scan their faces and check in locally using the on-device Edge AI. When connection resumes, scans sync automatically.
