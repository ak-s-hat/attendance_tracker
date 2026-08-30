import axios from 'axios'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const api = axios.create({ baseURL: API_BASE })

// ── Types ─────────────────────────────────────────────────────────────────

export interface Employee {
  id: string
  name: string
  email: string | null
  phone?: string | null
  department: string | null
  job_title: string | null
  is_enrolled: boolean
  is_active: boolean
}

export interface TokenValidateResponse {
  valid: boolean
  expires_at?: string | null
  message: string
}

export interface CheckInResult {
  success: boolean
  reason?: string
  employee_name?: string
  employee_id?: string
  confidence?: number
  check_type?: 'CHECK_IN' | 'CHECK_OUT'
  timestamp?: string
  message?: string
}

export interface RecentLog {
  employee_name: string
  check_type: string
  timestamp: string
  confidence_score: number | null
  status: string
  device_id: string | null
}

// ── API functions ─────────────────────────────────────────────────────────

export async function validateRegistrationToken(token: string): Promise<TokenValidateResponse> {
  try {
    const res = await api.get<TokenValidateResponse>(
      `/api/registration/validate?token=${encodeURIComponent(token)}`
    )
    return res.data
  } catch (err: any) {
    return {
      valid: false,
      expires_at: null,
      message: err?.response?.data?.message || err?.message || 'Invalid or expired invite token.',
    }
  }
}

export async function getEmployees(): Promise<Employee[]> {
  const res = await api.get<Employee[]>('/api/employees')
  return res.data
}

export async function createEmployee(payload: {
  name: string
  email?: string | null
  phone?: string | null
  department?: string
  job_title?: string
}): Promise<Employee> {
  const res = await api.post<Employee>('/api/employees', payload)
  return res.data
}

export const enrollEmployee = createEmployee

export async function enrollEmployeeFace(
  employeeId: string,
  imageBlob: Blob
): Promise<{ success: boolean; message: string }> {
  const form = new FormData()
  form.append('employee_id', employeeId)
  form.append('image', imageBlob, 'face.jpg')
  const res = await api.post<{ success: boolean; message: string }>('/api/checkin/enroll', form)
  return res.data
}

export const enrollFace = enrollEmployeeFace

export async function checkIn(imageBlob: Blob, deviceId = 'web-kiosk'): Promise<CheckInResult> {
  const form = new FormData()
  form.append('image', imageBlob, 'face.jpg')
  form.append('device_id', deviceId)
  const res = await api.post<CheckInResult>('/api/checkin', form)
  return res.data
}

export async function getRecentLogs(): Promise<RecentLog[]> {
  const res = await api.get<RecentLog[]>('/api/checkin/recent')
  return res.data
}

export default api

