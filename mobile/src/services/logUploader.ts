/**
 * logUploader.ts
 * Ships the SQLite app_logs trail to the backend (POST /api/client-logs) so a kiosk's
 * scan/sync/crash history is available even when no PC is attached to the device.
 */
import { flushLogsToDb, APP_VERSION } from './logger';
import { postClientLogs, ClientLogPayloadItem } from './api';

const UPLOAD_INTERVAL_MS = 60_000;
const BATCH_SIZE = 300;
const MAX_BATCHES_PER_RUN = 5;

let uploadInProgress = false;
let uploadTimer: ReturnType<typeof setInterval> | null = null;
let currentBaseUrl: string | null = null;

function parseData(json: string | null): any {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return { raw: json.substring(0, 2000) };
  }
}

/** Uploads unsent log rows. Returns the number uploaded; never throws. */
export async function uploadPendingLogs(apiBaseUrl: string): Promise<number> {
  if (uploadInProgress || !apiBaseUrl) return 0;
  uploadInProgress = true;
  let uploaded = 0;
  try {
    await flushLogsToDb();
    const { getUnuploadedAppLogs, markAppLogsUploaded, getDeviceId } = require('../database/offlineDb');
    const deviceId: string = await getDeviceId();
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const rows = await getUnuploadedAppLogs(BATCH_SIZE);
      if (!rows || rows.length === 0) break;
      const payload: ClientLogPayloadItem[] = rows.map((r: any) => ({
        client_log_id: r.id,
        ts: r.ts,
        level: r.level,
        tag: r.tag,
        trace_id: r.trace_id || null,
        message: r.message,
        data: parseData(r.data_json),
      }));
      await postClientLogs(apiBaseUrl, deviceId, APP_VERSION, payload);
      await markAppLogsUploaded(rows[rows.length - 1].id);
      uploaded += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
  } catch (err: any) {
    // Offline / server asleep: keep rows for the next attempt. Console only (no recursion into the logger).
    console.log('[logUploader] upload deferred:', err?.code || err?.message || err);
  } finally {
    uploadInProgress = false;
  }
  return uploaded;
}

/** Starts (or re-targets) the periodic background upload. */
export function startLogUploader(apiBaseUrl: string): void {
  currentBaseUrl = apiBaseUrl;
  if (uploadTimer) return;
  uploadTimer = setInterval(() => {
    if (currentBaseUrl) uploadPendingLogs(currentBaseUrl).catch(() => {});
  }, UPLOAD_INTERVAL_MS);
}

export function stopLogUploader(): void {
  if (uploadTimer) clearInterval(uploadTimer);
  uploadTimer = null;
}
