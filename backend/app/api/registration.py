"""Registration token management and Web Facial Data Ingestion Portal."""

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import require_admin
from app.models.employee import Employee
from app.models.user import RegistrationToken, User

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Registration"])


class TokenCreateRequest(BaseModel):
    expires_in_hours: int = 24


class TokenCreateResponse(BaseModel):
    token: str
    registration_url: str
    expires_at: str


class TokenValidateResponse(BaseModel):
    valid: bool
    expires_at: Optional[str] = None
    message: str


@router.post("/registration/token", response_model=TokenCreateResponse)
async def create_registration_token(
    request: Request,
    payload: TokenCreateRequest = TokenCreateRequest(),
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """POST /api/registration/token — Generate signed registration token (Admin only)."""
    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=payload.expires_in_hours)

    reg_token = RegistrationToken(
        token=raw_token,
        created_by_user_id=current_user.id,
        expires_at=expires_at,
        is_used=False,
    )
    db.add(reg_token)
    await db.commit()

    proto = request.headers.get("x-forwarded-proto") or request.url.scheme
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or request.url.netloc
    public_base = f"{proto}://{host}".rstrip("/")
    reg_url = f"{public_base}/register?token={raw_token}"

    return TokenCreateResponse(
        token=raw_token,
        registration_url=reg_url,
        expires_at=expires_at.isoformat(),
    )


@router.get("/registration/validate", response_model=TokenValidateResponse)
async def validate_registration_token(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    """GET /api/registration/validate?token=... — Validate web registration token."""
    stmt = select(RegistrationToken).where(RegistrationToken.token == token)
    res = await db.execute(stmt)
    reg_token = res.scalar_one_or_none()

    if not reg_token:
        return TokenValidateResponse(
            valid=False, message="Registration token not found"
        )
    if reg_token.is_used:
        return TokenValidateResponse(
            valid=False, message="Registration token has already been used"
        )

    now = datetime.now(timezone.utc)
    exp_time = reg_token.expires_at
    if exp_time.tzinfo is None:
        exp_time = exp_time.replace(tzinfo=timezone.utc)

    if exp_time < now:
        return TokenValidateResponse(
            valid=False, message="Registration token has expired"
        )

    return TokenValidateResponse(
        valid=True,
        expires_at=exp_time.isoformat(),
        message="Registration token is valid",
    )


@router.post("/registration/submit")
async def submit_web_registration(
    request: Request,
    token: str = Form(..., description="Invite registration token"),
    name: str = Form(..., description="Employee full name"),
    department: Optional[str] = Form("General", description="Department"),
    job_title: Optional[str] = Form(None, description="Job title"),
    email: Optional[str] = Form(None, description="Optional email"),
    image: UploadFile = File(..., description="Captured face image"),
    db: AsyncSession = Depends(get_db),
):
    """POST /api/registration/submit — Token-authorized public web registration with face ingestion."""
    # 1. Validate Token
    stmt = select(RegistrationToken).where(RegistrationToken.token == token)
    res = await db.execute(stmt)
    reg_token = res.scalar_one_or_none()

    if not reg_token:
        raise HTTPException(status_code=400, detail="Invalid registration token")
    if reg_token.is_used:
        raise HTTPException(status_code=400, detail="Registration token has already been used")

    now = datetime.now(timezone.utc)
    exp_time = reg_token.expires_at
    if exp_time.tzinfo is None:
        exp_time = exp_time.replace(tzinfo=timezone.utc)
    if exp_time < now:
        raise HTTPException(status_code=400, detail="Registration token has expired")

    # 2. Check if updating existing employee or creating new
    clean_email = email.strip().lower() if (email and email.strip()) else None
    existing_employee = None
    if clean_email:
        existing_res = await db.execute(
            select(Employee).where(Employee.email == clean_email, Employee.is_active == True)
        )
        existing_employee = existing_res.scalar_one_or_none()

    # 3. Read image and run AI face detection & embedding extraction
    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty image file provided")

    pipeline = request.app.state.pipeline
    ai_result = pipeline.process(image_bytes)

    if ai_result["status"] != "ready_for_matching":
        error_msg = {
            "no_face_detected": "No face detected in image. Please ensure your face is well-lit and centered.",
            "multiple_faces_detected": "Multiple faces detected. Please ensure only one person is in the frame.",
            "spoof_detected": "Liveness check failed. Please submit a real live camera photo.",
            "low_quality_face": "Face image quality is too low. Please move closer and improve lighting.",
        }.get(ai_result["status"], f"Face processing failed: {ai_result.get('status')}")
        raise HTTPException(status_code=422, detail=error_msg)

    embedding = ai_result["embedding"]
    if embedding is None:
        raise HTTPException(status_code=422, detail="Failed to extract facial embedding vector.")

    # 4. Duplicate Face Collision Check against OTHER employees (Item 3)
    from app.api.settings import get_or_create_settings
    from app.services.attendance import AttendanceService
    attendance_service = AttendanceService()
    sys_settings = await get_or_create_settings(db)

    existing_match, match_sim = await attendance_service.find_matching_employee(
        session=db,
        query_embedding=embedding,
        threshold=sys_settings.duplicate_face_threshold,
    )
    if existing_match and (not existing_employee or existing_match.id != existing_employee.id):
        raise HTTPException(
            status_code=409,
            detail=f"This face is already registered under employee '{existing_match.name}'. Each employee must have a unique facial identity.",
        )

    # 5. Update existing employee or create new (Item 6)
    if existing_employee:
        existing_employee.name = name.strip()
        existing_employee.department = department.strip() if department else existing_employee.department
        if job_title:
            existing_employee.job_title = job_title.strip()
        existing_employee.face_embedding = embedding.tolist()
        employee = existing_employee
        action_msg = f"Successfully updated facial biometrics for {employee.name}!"
    else:
        employee = Employee(
            id=uuid4(),
            name=name.strip(),
            email=clean_email,
            department=department.strip() if department else "General",
            job_title=job_title.strip() if job_title else None,
            face_embedding=embedding.tolist(),
            is_active=True,
            leave_balance=15.0,
        )
        db.add(employee)
        action_msg = f"Successfully registered {employee.name}!"

    # 5. Mark token as used
    reg_token.is_used = True
    await db.commit()
    await db.refresh(employee)

    logger.info("Successfully registered employee %s (%s) via token", employee.name, employee.id)

    return {
        "success": True,
        "message": f"Successfully enrolled {employee.name}!",
        "employee_id": str(employee.id),
        "employee_name": employee.name,
    }


@router.get("/", response_class=HTMLResponse)
@router.get("/register", response_class=HTMLResponse)
async def serve_web_registration_page(token: Optional[str] = None):
    """GET / or GET /register?token=... — Standalone Web Facial Ingestion & Registration Portal."""
    token_str = token or ""
    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Employee Face Registration — Attendance Tracker</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #0F172A;
      color: #F8FAFC;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 16px;
    }}
    .card {{
      background: #1E293B;
      border: 1px solid #334155;
      border-radius: 16px;
      width: 100%;
      max-width: 480px;
      padding: 24px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }}
    h1 {{ font-size: 20px; font-weight: 700; margin-bottom: 6px; text-align: center; }}
    .subtitle {{ color: #94A3B8; font-size: 13px; text-align: center; margin-bottom: 20px; }}
    .step-indicator {{
      display: flex;
      justify-content: space-between;
      margin-bottom: 20px;
      padding: 0 8px;
    }}
    .step-dot {{
      width: 32%;
      height: 4px;
      background: #334155;
      border-radius: 2px;
      transition: background 0.3s;
    }}
    .step-dot.active {{ background: #3B82F6; }}
    .step-dot.done {{ background: #10B981; }}
    .form-group {{ margin-bottom: 14px; }}
    label {{ display: block; font-size: 12px; font-weight: 600; color: #CBD5E1; margin-bottom: 6px; }}
    input, select {{
      width: 100%;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #334155;
      background: #0F172A;
      color: #F8FAFC;
      font-size: 14px;
      outline: none;
    }}
    input:focus, select:focus {{ border-color: #3B82F6; }}
    .btn {{
      width: 100%;
      padding: 14px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: opacity 0.2s;
    }}
    .btn-primary {{ background: #3B82F6; color: #FFFFFF; }}
    .btn-success {{ background: #10B981; color: #FFFFFF; }}
    .btn-secondary {{ background: #334155; color: #F8FAFC; margin-top: 8px; }}
    .btn:disabled {{ opacity: 0.5; cursor: not-allowed; }}
    .camera-box {{
      position: relative;
      width: 100%;
      height: 320px;
      background: #0F172A;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 16px;
      border: 2px solid #334155;
    }}
    video, canvas, img.preview {{
      width: 100%;
      height: 100%;
      object-fit: cover;
      transform: scaleX(-1);
    }}
    .face-guide {{
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 180px;
      height: 230px;
      border: 2px dashed #3B82F6;
      border-radius: 50%;
      pointer-events: none;
    }}
    .status-badge {{
      display: inline-block;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 14px;
      text-align: center;
      width: 100%;
    }}
    .badge-error {{ background: rgba(239, 68, 68, 0.2); color: #EF4444; border: 1px solid #EF4444; }}
    .badge-success {{ background: rgba(16, 185, 129, 0.2); color: #10B981; border: 1px solid #10B981; }}
    .badge-info {{ background: rgba(59, 130, 246, 0.2); color: #60A5FA; border: 1px solid #3B82F6; }}
    .success-icon {{ font-size: 48px; text-align: center; margin: 20px 0; color: #10B981; }}
  </style>
</head>
<body>
  <div class="card" id="app">
    <h1>Face Registration Portal</h1>
    <p class="subtitle">Complete your profile and enroll for kiosk face check-in</p>
    
    <div class="step-indicator">
      <div class="step-dot active" id="dot1"></div>
      <div class="step-dot" id="dot2"></div>
      <div class="step-dot" id="dot3"></div>
    </div>

    <div id="statusMessage"></div>

    <!-- TOKEN INPUT SECTION (If not in URL) -->
    <div id="tokenPromptSection" style="display:none; margin-bottom: 16px;">
      <div class="form-group">
        <label>Invitation Token / Code</label>
        <input type="text" id="manualTokenInput" placeholder="Paste your invite token here..." />
      </div>
      <button class="btn btn-primary" onclick="verifyManualToken()">Verify Invitation Code ➡️</button>
    </div>

    <!-- STEP 1: METADATA -->
    <div id="step1">
      <div class="form-group">
        <label>Full Name *</label>
        <input type="text" id="empName" placeholder="e.g. Rahul Sharma" required />
      </div>
      <div class="form-group">
        <label>Department</label>
        <input type="text" id="empDept" placeholder="e.g. Engineering, Sales" value="General" />
      </div>
      <div class="form-group">
        <label>Job Title</label>
        <input type="text" id="empTitle" placeholder="e.g. Senior Associate" />
      </div>
      <div class="form-group">
        <label>Email Address (Optional)</label>
        <input type="email" id="empEmail" placeholder="e.g. rahul@company.com" />
      </div>
      <button class="btn btn-primary" onclick="goToStep2()">Next: Camera Face Capture ➡️</button>
    </div>

    <!-- STEP 2: CAMERA CAPTURE -->
    <div id="step2" style="display:none;">
      <div class="camera-box">
        <video id="video" autoplay playsinline></video>
        <div class="face-guide" id="guide"></div>
        <canvas id="canvas" style="display:none;"></canvas>
        <img id="photoPreview" class="preview" style="display:none;" />
      </div>
      <p style="font-size:12px; color:#94A3B8; text-align:center; margin-bottom:12px;">
        Align your face inside the blue oval with good lighting.
      </p>
      <button class="btn btn-primary" id="snapBtn" onclick="capturePhoto()">📸 Snap Photo</button>
      <button class="btn btn-secondary" id="retakeBtn" style="display:none;" onclick="retakePhoto()">🔄 Retake Photo</button>
      <button class="btn btn-success" id="submitBtn" style="display:none; margin-top:8px;" onclick="submitRegistration()">🚀 Submit & Complete Registration</button>
      <button class="btn btn-secondary" onclick="goToStep1()">⬅️ Back to Info</button>
    </div>

    <!-- STEP 3: SUCCESS -->
    <div id="step3" style="display:none; text-align:center;">
      <div class="success-icon">✅</div>
      <h2 style="font-size:18px; margin-bottom:8px;">Registration Complete!</h2>
      <p style="font-size:13px; color:#94A3B8; margin-bottom:16px;">
        Your facial biometric embedding has been securely registered in the system. You can now use any company kiosk for instant face check-in.
      </p>
      <div class="status-badge badge-success" id="successEmpName"></div>
    </div>
  </div>

  <script>
    let activeToken = "{token_str}" || new URLSearchParams(window.location.search).get('token') || '';
    let videoStream = null;
    let capturedBlob = null;

    window.addEventListener('DOMContentLoaded', async () => {{
      if (!activeToken) {{
        document.getElementById('tokenPromptSection').style.display = 'block';
        document.getElementById('step1').style.display = 'none';
        showStatus('Please enter or paste your invitation code to proceed.', 'info');
        return;
      }}
      await validateToken(activeToken);
    }});

    async function validateToken(tok) {{
      try {{
        const res = await fetch(`/api/registration/validate?token=${{encodeURIComponent(tok)}}`);
        const data = await res.json();
        if (data.valid) {{
          showStatus('✅ Valid invitation. Please complete your registration below.', 'success');
          document.getElementById('tokenPromptSection').style.display = 'none';
          document.getElementById('step1').style.display = 'block';
        }} else {{
          showStatus(`⚠️ ${{data.message || 'Invitation link is invalid or expired.'}}`, 'error');
          document.getElementById('tokenPromptSection').style.display = 'block';
          document.getElementById('step1').style.display = 'none';
        }}
      }} catch (e) {{
        // If validation endpoint can't be reached directly, allow proceed
        document.getElementById('step1').style.display = 'block';
      }}
    }}

    async function verifyManualToken() {{
      const val = document.getElementById('manualTokenInput').value.trim();
      if (!val) {{
        showStatus('Please enter an invitation token.', 'error');
        return;
      }}
      activeToken = val;
      await validateToken(activeToken);
    }}

    function showStatus(msg, type) {{
      const el = document.getElementById('statusMessage');
      if (!msg) {{ el.innerHTML = ''; return; }}
      const cls = type === 'error' ? 'badge-error' : (type === 'success' ? 'badge-success' : 'badge-info');
      el.innerHTML = `<div class="status-badge ${{cls}}">${{msg}}</div>`;
    }}

    function goToStep2() {{
      const name = document.getElementById('empName').value.trim();
      if (!name) {{
        showStatus('Please enter your full name.', 'error');
        return;
      }}
      showStatus('', '');
      document.getElementById('step1').style.display = 'none';
      document.getElementById('step2').style.display = 'block';
      document.getElementById('dot2').classList.add('active');
      startCamera();
    }}

    function goToStep1() {{
      stopCamera();
      document.getElementById('step2').style.display = 'none';
      document.getElementById('step1').style.display = 'block';
      document.getElementById('dot2').classList.remove('active');
    }}

    async function startCamera() {{
      try {{
        videoStream = await navigator.mediaDevices.getUserMedia({{
          video: {{ facingMode: 'user', width: {{ ideal: 1280 }}, height: {{ ideal: 720 }} }},
          audio: false
        }});
        const video = document.getElementById('video');
        video.srcObject = videoStream;
        video.style.display = 'block';
        document.getElementById('photoPreview').style.display = 'none';
        document.getElementById('guide').style.display = 'block';
        document.getElementById('snapBtn').style.display = 'block';
        document.getElementById('retakeBtn').style.display = 'none';
        document.getElementById('submitBtn').style.display = 'none';
      }} catch (err) {{
        showStatus('Camera permission denied or camera unavailable.', 'error');
      }}
    }}

    function stopCamera() {{
      if (videoStream) {{
        videoStream.getTracks().forEach(t => t.stop());
        videoStream = null;
      }}
    }}

    function capturePhoto() {{
      const video = document.getElementById('video');
      const canvas = document.getElementById('canvas');
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob((blob) => {{
        capturedBlob = blob;
        const preview = document.getElementById('photoPreview');
        preview.src = URL.createObjectURL(blob);
        preview.style.display = 'block';
        video.style.display = 'none';
        document.getElementById('guide').style.display = 'none';
        document.getElementById('snapBtn').style.display = 'none';
        document.getElementById('retakeBtn').style.display = 'block';
        document.getElementById('submitBtn').style.display = 'block';
      }}, 'image/jpeg', 0.9);
    }}

    function retakePhoto() {{
      capturedBlob = null;
      startCamera();
    }}

    async function submitRegistration() {{
      if (!capturedBlob) {{
        showStatus('Please snap your photo first.', 'error');
        return;
      }}

      const name = document.getElementById('empName').value.trim();
      const dept = document.getElementById('empDept').value.trim() || 'General';
      const title = document.getElementById('empTitle').value.trim();
      const email = document.getElementById('empEmail').value.trim();

      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.innerText = '⏳ Processing Face Biometrics...';
      showStatus('Extracting facial embedding and registering...', 'info');

      const formData = new FormData();
      formData.append('token', activeToken);
      formData.append('name', name);
      formData.append('department', dept);
      if (title) formData.append('job_title', title);
      if (email) formData.append('email', email);
      formData.append('image', capturedBlob, 'face.jpg');

      try {{
        const res = await fetch('/api/registration/submit', {{
          method: 'POST',
          body: formData
        }});
        const data = await res.json();

        if (res.ok && data.success) {{
          stopCamera();
          document.getElementById('step2').style.display = 'none';
          document.getElementById('step3').style.display = 'block';
          document.getElementById('dot2').classList.add('done');
          document.getElementById('dot3').classList.add('done');
          document.getElementById('successEmpName').innerText = `Registered: ${{data.employee_name}}`;
          showStatus('', '');
        }} else {{
          showStatus(`❌ ${{data.detail || 'Enrollment failed. Please ensure your face is clearly visible.'}}`, 'error');
          btn.disabled = false;
          btn.innerText = '🚀 Submit & Complete Registration';
        }}
      }} catch (err) {{
        showStatus('Network error while submitting registration.', 'error');
        btn.disabled = false;
        btn.innerText = '🚀 Submit & Complete Registration';
      }}
    }}
  </script>
</body>
</html>
"""
    return HTMLResponse(content=html_content)
