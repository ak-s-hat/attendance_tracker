-- =============================================================================
-- Attendance Tracker — Supabase Cloud PostgreSQL + pgvector Schema
-- Execute this script in your Supabase Project SQL Editor (supabase.com -> SQL Editor)
-- =============================================================================

-- 1. Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Create Employees Table (with 512-dimensional vector embedding)
CREATE TABLE IF NOT EXISTS employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    email VARCHAR(200) UNIQUE,
    department VARCHAR(100) DEFAULT 'General',
    job_title VARCHAR(100),
    face_embedding VECTOR(512),
    enrollment_photo_key VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT true,
    leave_balance DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    work_start_time VARCHAR(5) DEFAULT '09:00',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Vector HNSW Index for ultra-fast cosine similarity matching
CREATE INDEX IF NOT EXISTS idx_employees_face_embedding_hnsw 
ON employees 
USING hnsw (face_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- 4. Create Attendance Logs Table
CREATE TABLE IF NOT EXISTS attendance_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    check_type VARCHAR(20) NOT NULL DEFAULT 'CHECK_IN',
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    confidence_score DOUBLE PRECISION,
    device_id VARCHAR(100) DEFAULT 'kiosk-01',
    failure_reason VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_timestamp ON attendance_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_employee ON attendance_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_status ON attendance_logs(status);

-- 5. Create Users Table (Authentication & RBAC)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'employee',
    employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 6. Create Registration Tokens Table (Time-limited self-enrollment invites)
CREATE TABLE IF NOT EXISTS registration_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token VARCHAR(255) UNIQUE NOT NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT false,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registration_tokens_token ON registration_tokens(token);

-- 7. Create System Settings Table (Dynamic HR Rules & Debounce)
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rapid_scan_debounce_minutes DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    work_start_time VARCHAR(10) NOT NULL DEFAULT '09:00',
    half_day_cutoff_time VARCHAR(10) NOT NULL DEFAULT '13:00',
    valid_checkout_time VARCHAR(10) NOT NULL DEFAULT '17:00',
    duplicate_face_threshold DOUBLE PRECISION NOT NULL DEFAULT 0.65,
    auto_deduct_absent_leave BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Seed Default System Settings (if not present)
INSERT INTO system_settings (
    rapid_scan_debounce_minutes,
    work_start_time,
    half_day_cutoff_time,
    valid_checkout_time,
    duplicate_face_threshold,
    auto_deduct_absent_leave
)
SELECT 2.0, '09:00', '13:00', '17:00', 0.65, false
WHERE NOT EXISTS (SELECT 1 FROM system_settings);

-- 9. Seed Default SuperAdmin Account (username: admin, password: password123)
-- bcrypt hash for 'password123': $2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW
INSERT INTO users (username, password_hash, role, is_active)
SELECT 'admin', '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'super_admin', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');

-- Verification query
SELECT 'Supabase Schema Initialized Successfully!' AS status,
       (SELECT COUNT(*) FROM system_settings) AS settings_count,
       (SELECT COUNT(*) FROM users) AS users_count;
