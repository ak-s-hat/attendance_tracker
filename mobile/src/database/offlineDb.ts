import * as SQLite from 'expo-sqlite';

export interface CachedEmployee {
  id: string;
  name: string;
  department: string;
  job_title?: string | null;
  embedding: number[]; // 512-d float array
  updated_at: string;
}

export interface OfflineAttendanceRecord {
  id: string; // client-generated UUID
  employee_id: string;
  employee_name: string;
  check_type: 'CHECK_IN' | 'CHECK_OUT' | 'HALF_DAY';
  timestamp: string;
  confidence_score: number;
  liveness_score: number;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
  error_message?: string | null;
}

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('attendance_offline.db');
    await initSchema(dbInstance);
  }
  return dbInstance;
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS cached_employees (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      job_title TEXT,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_attendance_queue (
      id TEXT PRIMARY KEY NOT NULL,
      employee_id TEXT NOT NULL,
      employee_name TEXT NOT NULL,
      check_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      confidence_score REAL NOT NULL,
      liveness_score REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cached_emp_name ON cached_employees(name);
    CREATE INDEX IF NOT EXISTS idx_offline_queue_status ON offline_attendance_queue(status);
  `);
}

/**
 * Bulk updates or replaces cached employees with their 512-d embeddings
 */
export async function saveOrUpdateCachedEmployees(employees: CachedEmployee[]): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const emp of employees) {
      if (!emp.embedding || emp.embedding.length === 0) continue;
      const embeddingJson = JSON.stringify(emp.embedding);
      await db.runAsync(
        `INSERT OR REPLACE INTO cached_employees (id, name, department, job_title, embedding_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [emp.id, emp.name, emp.department || 'General', emp.job_title || null, embeddingJson, emp.updated_at || new Date().toISOString()]
      );
    }
  });
}

/**
 * Retrieves all cached employees with their parsed 512-d embeddings
 */
export async function getAllCachedEmployees(): Promise<CachedEmployee[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    name: string;
    department: string;
    job_title: string | null;
    embedding_json: string;
    updated_at: string;
  }>('SELECT * FROM cached_employees ORDER BY name ASC');

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    department: r.department,
    job_title: r.job_title,
    embedding: JSON.parse(r.embedding_json),
    updated_at: r.updated_at,
  }));
}

/**
 * Enqueues a successful offline check-in scan
 */
export async function enqueueOfflineScan(record: Omit<OfflineAttendanceRecord, 'status'>): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO offline_attendance_queue 
     (id, employee_id, employee_name, check_type, timestamp, confidence_score, liveness_score, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
    [
      record.id,
      record.employee_id,
      record.employee_name,
      record.check_type,
      record.timestamp,
      record.confidence_score,
      record.liveness_score,
    ]
  );
}

/**
 * Returns all pending attendance scans waiting to be synced to cloud
 */
export async function getPendingScans(): Promise<OfflineAttendanceRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<any>(
    "SELECT * FROM offline_attendance_queue WHERE status = 'PENDING' ORDER BY timestamp ASC LIMIT 100"
  );
  return rows.map((r) => ({
    id: r.id,
    employee_id: r.employee_id,
    employee_name: r.employee_name,
    check_type: r.check_type,
    timestamp: r.timestamp,
    confidence_score: r.confidence_score,
    liveness_score: r.liveness_score,
    status: r.status,
    error_message: r.error_message,
  }));
}

/**
 * Marks a batch of attendance scans as synced
 */
export async function markScansAsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE offline_attendance_queue SET status = 'SYNCED' WHERE id IN (${placeholders})`,
    ids
  );
}

/**
 * Gets database statistics for offline status display
 */
export async function getOfflineDbStats(): Promise<{ cachedCount: number; pendingSyncCount: number }> {
  const db = await getDb();
  const empCountRow = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM cached_employees');
  const pendingCountRow = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM offline_attendance_queue WHERE status = 'PENDING'"
  );

  return {
    cachedCount: empCountRow?.count ?? 0,
    pendingSyncCount: pendingCountRow?.count ?? 0,
  };
}
