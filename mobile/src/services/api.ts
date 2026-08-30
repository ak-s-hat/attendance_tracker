import axios from 'axios';

// ---------------------------------------------------------------------------
// JWT Auth Token State Management
// ---------------------------------------------------------------------------
let currentAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  currentAuthToken = token;
}

export function getAuthToken(): string | null {
  return currentAuthToken;
}

function getAuthHeaders(token?: string) {
  const activeToken = token || currentAuthToken;
  const headers: Record<string, string> = {
    'ngrok-skip-browser-warning': 'true',
  };
  if (activeToken) {
    headers['Authorization'] = `Bearer ${activeToken}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------
export interface CheckinEmbeddingPayload {
  embedding: number[];
  device_id?: string;
  check_type?: string;
  liveness_score?: number;
}

export interface CheckinEmbeddingResponse {
  success: boolean;
  message?: string;
  employee_id?: string;
  employee_name?: string;
  confidence?: number;
  check_type?: string;
  reason?: string;
  bbox?: number[];
  debug_metadata?: {
    liveness_score?: number | null;
    liveness_threshold?: number | null;
    detection_score?: number | null;
    bounding_box?: number[] | null;
    latency_ms?: number | null;
    status?: string | null;
  };
}

export interface RecentCheckinItem {
  id?: string;
  employee_name: string;
  department?: string | null;
  check_type: string;
  timestamp: string;
  confidence_score: number;
  status: string;
  device_id: string;
  failure_reason?: string | null;
  liveness_score?: number | null;
  detection_score?: number | null;
}

export interface SystemSettings {
  rapid_scan_debounce_minutes: number;
  work_start_time: string;
  half_day_cutoff_time: string;
  valid_checkout_time: string;
  duplicate_face_threshold: number;
  auto_deduct_absent_leave: boolean;
}

export interface DatabaseStats {
  total_employees: number;
  enrolled_employees: number;
  total_logs: number;
  unknown_logs: number;
  spoof_logs: number;
  total_users: number;
  db_size_mb: number;
  status: string;
  last_cleanup_days_ago: number;
}

export interface DailyMatrixItem {
  employee_id: string;
  name: string;
  department?: string;
  job_title?: string | null;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | string;
  first_check_in?: string | null;
  last_check_out?: string | null;
  total_hours?: number | null;
  late_minutes: number;
  leave_balance: number;
  confidence_score?: number | null;
  liveness_score?: number | null;
}

export interface EmployeeItem {
  id: string;
  name: string;
  email?: string | null;
  department?: string;
  job_title?: string;
  is_enrolled: boolean;
  is_active: boolean;
  leave_balance?: number;
  present_days?: number;
  late_count?: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  role: 'super_admin' | 'admin' | 'employee';
  user_id: string;
  username?: string;
  employee_id?: string | null;
}

export interface DepartmentStat {
  present: number;
  absent: number;
  late: number;
}

export interface AttendanceSummaryResponse {
  date: string;
  total_employees: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  departments: Record<string, DepartmentStat>;
}

export interface AttendanceLogEntry {
  timestamp: string | null;
  check_type: string;
  status: string;
  confidence_score: number | null;
  device_id: string;
}

export interface EmployeeAttendanceResponse {
  employee_id: string;
  name: string;
  department?: string;
  leave_balance: number;
  present_days: number;
  late_count: number;
  logs: AttendanceLogEntry[];
}

export interface LeaveAdjustmentRequest {
  action: 'add' | 'deduct' | 'set';
  amount: number;
}

export interface LeaveAdjustmentResponse {
  employee_id: string;
  new_leave_balance: number;
  message?: string;
}

export interface RegistrationTokenResponse {
  token: string;
  registration_url: string;
  expires_at: string;
}

export interface UserItem {
  id: string;
  username: string;
  role: 'super_admin' | 'admin' | 'employee';
  employee_id?: string | null;
}

// ---------------------------------------------------------------------------
// API Methods
// ---------------------------------------------------------------------------

/**
 * Sign in user and retrieve JWT access token & user role.
 */
export async function loginUser(baseUrl: string, payload: LoginRequest): Promise<LoginResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/auth/login`;
  const response = await axios.post<LoginResponse>(url, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 8000,
  });
  if (response.data?.access_token) {
    setAuthToken(response.data.access_token);
  }
  return response.data;
}

export const login = loginUser;

/**
 * Fetch daily attendance summary metrics and department breakdown.
 */
export async function getAttendanceSummary(
  baseUrl: string,
  token?: string,
  date?: string
): Promise<AttendanceSummaryResponse> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/attendance/summary${date ? `?date=${date}` : ''}`;
  const response = await axios.get<AttendanceSummaryResponse>(url, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

/**
 * Fetch attendance logs and summary stats for a single employee.
 */
export async function getEmployeeAttendance(
  baseUrl: string,
  employeeId: string,
  token?: string
): Promise<EmployeeAttendanceResponse> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/employees/${employeeId}/attendance`;
  const response = await axios.get<EmployeeAttendanceResponse>(url, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

/**
 * Adjust employee leave balance (add, deduct, set).
 */
export async function adjustLeaveBalance(
  baseUrl: string,
  employeeId: string,
  payload: LeaveAdjustmentRequest,
  token?: string
): Promise<LeaveAdjustmentResponse> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/employees/${employeeId}/leave`;
  const response = await axios.patch<LeaveAdjustmentResponse>(url, payload, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

export const updateLeaveBalance = adjustLeaveBalance;

/**
 * Generate shareable registration link token.
 */
export async function generateRegistrationToken(
  baseUrl: string,
  token?: string,
  expiresInHours: number = 24
): Promise<RegistrationTokenResponse> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/registration/token`;
  const response = await axios.post<RegistrationTokenResponse>(
    url,
    { expires_in_hours: expiresInHours },
    {
      headers: getAuthHeaders(token),
      timeout: 8000,
    }
  );
  return response.data;
}

/**
 * Fetch all user accounts (Super Admin only).
 */
export async function getUsers(baseUrl: string, token?: string): Promise<UserItem[]> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/users`;
  const response = await axios.get<UserItem[]>(url, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

/**
 * Update user role (promote/demote admin <-> employee) (Super Admin only).
 */
export async function updateUserRole(
  baseUrl: string,
  userId: string,
  role: 'admin' | 'employee',
  token?: string
): Promise<{ user_id: string; role: string }> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/users/${userId}/role`;
  const response = await axios.patch<{ user_id: string; role: string }>(
    url,
    { role },
    {
      headers: getAuthHeaders(token),
      timeout: 8000,
    }
  );
  return response.data;
}

// ---------------------------------------------------------------------------
// Existing Kiosk & Employee Check-in Endpoints
// ---------------------------------------------------------------------------

export async function postEmbeddingCheckin(
  baseUrl: string,
  payload: CheckinEmbeddingPayload
): Promise<CheckinEmbeddingResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/checkin/embedding`;
  const response = await axios.post<CheckinEmbeddingResponse>(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    timeout: 10000,
  });
  return response.data;
}

export async function getRecentCheckins(
  baseUrl: string,
  token?: string,
  eventType?: string,
  search?: string
): Promise<RecentCheckinItem[]> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const params = new URLSearchParams();
  if (eventType && eventType !== 'ALL') params.append('event_type', eventType);
  if (search && search.trim()) params.append('search', search.trim());
  const queryString = params.toString() ? `?${params.toString()}` : '';
  const url = `${cleanBase}/api/checkin/recent${queryString}`;
  const response = await axios.get<RecentCheckinItem[]>(url, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

export async function deleteEmployee(
  baseUrl: string,
  employeeId: string,
  hard: boolean = false,
  token?: string
): Promise<{ success: boolean; message: string }> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/employees/${employeeId}${hard ? '?hard=true' : ''}`;
  const response = await axios.delete<{ success: boolean; message: string }>(url, {
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
  return response.data;
}

export async function getSystemSettings(baseUrl: string, token?: string): Promise<SystemSettings> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/settings`;
  const response = await axios.get<SystemSettings>(url, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

export async function updateSystemSettings(
  baseUrl: string,
  payload: Partial<SystemSettings>,
  token?: string
): Promise<SystemSettings> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/settings`;
  const response = await axios.patch<SystemSettings>(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    timeout: 10000,
  });
  return response.data;
}

export async function getDatabaseStats(baseUrl: string, token?: string): Promise<DatabaseStats> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/settings/db-stats`;
  const response = await axios.get<DatabaseStats>(url, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

export async function purgeLogs(
  baseUrl: string,
  purgeType: string = 'unknown',
  daysOlder: number = 30,
  token?: string
): Promise<{ success: boolean; deleted_count: number; message: string }> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/settings/purge-logs?purge_type=${purgeType}&days_older=${daysOlder}`;
  const response = await axios.delete<{ success: boolean; deleted_count: number; message: string }>(url, {
    headers: getAuthHeaders(token),
    timeout: 15000,
  });
  return response.data;
}

export async function updateCheckinLogStatus(
  baseUrl: string,
  logId: string,
  payload: { check_type?: string; status?: string },
  token?: string
): Promise<{ success: boolean; message: string }> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/checkin/logs/${logId}`;
  const response = await axios.patch<{ success: boolean; message: string }>(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    timeout: 10000,
  });
  return response.data;
}

export async function getDailyAttendanceMatrix(
  baseUrl: string,
  date?: string,
  token?: string
): Promise<DailyMatrixItem[]> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/attendance/daily-matrix${date ? `?date=${date}` : ''}`;
  const response = await axios.get<DailyMatrixItem[]>(url, {
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
  return response.data;
}

export async function getEmployees(baseUrl: string, token?: string): Promise<EmployeeItem[]> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/employees`;
  const response = await axios.get<EmployeeItem[]>(url, {
    headers: getAuthHeaders(token),
    timeout: 8000,
  });
  return response.data;
}

export interface CreateEmployeePayload {
  name: string;
  email?: string | null;
  department?: string | null;
  job_title?: string | null;
}

export async function createEmployee(
  baseUrl: string,
  payload: CreateEmployeePayload,
  token?: string
): Promise<EmployeeItem> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/employees`;
  const response = await axios.post<EmployeeItem>(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(token),
    },
    timeout: 10000,
  });
  return response.data;
}

export async function enrollEmployeeFace(
  baseUrl: string,
  employeeId: string,
  imageUri: string,
  token?: string
): Promise<{ success: boolean; message: string; employee_id: string; employee_name: string }> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/checkin/enroll`;
  const formData = new FormData();
  formData.append('employee_id', employeeId);
  formData.append('image', {
    uri: imageUri,
    name: 'enroll.jpg',
    type: 'image/jpeg',
  } as any);

  const response = await axios.post(url, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...getAuthHeaders(token),
    },
    timeout: 15000,
  });
  return response.data;
}

export async function postImageCheckin(
  baseUrl: string,
  imageInput: string | Uint8Array,
  deviceId = 'mobile_kiosk_01'
): Promise<CheckinEmbeddingResponse> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/checkin`;
  const formData = new FormData();

  if (typeof imageInput === 'string' && imageInput.length > 0) {
    formData.append('image', {
      uri: imageInput,
      name: 'frame.jpg',
      type: 'image/jpeg',
    } as any);
  } else {
    try {
      const blob = new Blob([imageInput as any], { type: 'image/jpeg' });
      formData.append('image', blob as any, 'frame.jpg');
    } catch {
      formData.append('image', {
        uri: 'data:image/jpeg;base64,placeholder',
        name: 'frame.jpg',
        type: 'image/jpeg',
      } as any);
    }
  }

  formData.append('device_id', deviceId);

  const response = await axios.post<CheckinEmbeddingResponse>(url, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
      ...getAuthHeaders(),
    },
    timeout: 15000,
  });

  return response.data;
}

export interface CachedEmployeeDeltaItem {
  id: string;
  name: string;
  department: string;
  job_title?: string | null;
  embedding: number[];
  updated_at: string;
}

export interface BatchSyncPayloadItem {
  id: string;
  employee_id: string;
  check_type: string;
  timestamp: string;
  confidence_score: number;
  liveness_score: number;
}

export interface BatchSyncResponse {
  success: boolean;
  synced_count: number;
  synced_ids: string[];
  message: string;
}

/**
 * Download employee 512-d biometric embeddings delta from cloud
 */
export async function fetchEmployeeEmbeddingsDelta(
  baseUrl: string,
  since?: string,
  token?: string
): Promise<CachedEmployeeDeltaItem[]> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/employees/embeddings-delta${since ? `?since=${encodeURIComponent(since)}` : ''}`;
  const response = await axios.get<CachedEmployeeDeltaItem[]>(url, {
    headers: getAuthHeaders(token),
    timeout: 12000,
  });
  return response.data;
}

/**
 * Flush batched offline attendance logs to cloud backend
 */
export async function syncBatchAttendanceLogs(
  baseUrl: string,
  deviceId: string,
  events: BatchSyncPayloadItem[],
  token?: string
): Promise<BatchSyncResponse> {
  const cleanBase = baseUrl.replace(/\/$/, '');
  const url = `${cleanBase}/api/checkin/batch-sync`;
  const response = await axios.post<BatchSyncResponse>(
    url,
    {
      device_id: deviceId,
      events,
    },
    {
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(token),
      },
      timeout: 15000,
    }
  );
  return response.data;
}
