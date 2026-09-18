import NetInfo from '@react-native-community/netinfo';
import {
  getAllCachedEmployees,
  getPendingScans,
  markScansAsSynced,
  saveOrUpdateCachedEmployees,
  getOfflineDbStats,
} from '../database/offlineDb';
import { vectorGallery } from '../ai/vectorMatcher';
import {
  fetchEmployeeEmbeddingsDelta,
  syncBatchAttendanceLogs,
  BatchSyncPayloadItem,
} from './api';

let isSyncing = false;
let lastGallerySyncIso: string | undefined = undefined;
let isEdgeSyncInitialized = false;

export type SyncEventListener = (stats: { cachedCount: number; pendingSyncCount: number }) => void;
const syncEventListeners = new Set<SyncEventListener>();

export function subscribeSyncEvents(listener: SyncEventListener): () => void {
  syncEventListeners.add(listener);
  // Fire immediately with current stats
  getOfflineDbStats().then((stats) => {
    try { listener(stats); } catch (_) {}
  }).catch(() => {});
  return () => syncEventListeners.delete(listener);
}

export async function notifySyncListeners(): Promise<void> {
  try {
    const stats = await getOfflineDbStats();
    syncEventListeners.forEach((fn) => {
      try { fn(stats); } catch (_) {}
    });
  } catch (err) {
    console.warn('[EdgeSync] notifySyncListeners error:', err);
  }
}

/**
 * Initializes the edge AI offline database and in-memory vector gallery from local SQLite.
 * Does NOT start an aggressive 30-second polling loop.
 */
export async function initEdgeSyncService(apiBaseUrl?: string, authToken?: string): Promise<void> {
  if (isEdgeSyncInitialized) {
    return;
  }
  isEdgeSyncInitialized = true;

  // 1. Preload gallery from local SQLite cache (instant, zero network)
  try {
    const localEmps = await getAllCachedEmployees();
    vectorGallery.loadGallery(localEmps);
    console.log(`[EdgeSync] Preloaded ${vectorGallery.getGallerySize()} employee vectors from local SQLite.`);
    notifySyncListeners();
  } catch (err) {
    console.warn('[EdgeSync] Failed to preload local gallery:', err);
  }

  // 2. NetInfo reconnection listener — only flushes pending logs when internet is restored
  try {
    NetInfo.addEventListener((state) => {
      try {
        if (state && state.isConnected && state.isInternetReachable && apiBaseUrl) {
          console.log('[EdgeSync] Network restored — background flushing pending logs...');
          flushPendingAttendanceLogs(apiBaseUrl, authToken).catch(() => {});
        }
      } catch (listenerErr) {
        console.warn('[EdgeSync] NetInfo state check failed:', listenerErr);
      }
    });
  } catch (netInfoErr) {
    console.warn('[EdgeSync] NetInfo addEventListener failed to attach:', netInfoErr);
  }
}

/**
 * Executes a single two-way sync cycle:
 * 1. PUSH pending attendance scans from phone to cloud.
 * 2. PULL new/updated biometric vectors from cloud to phone.
 */
export async function runFullSyncCycle(apiBaseUrl: string, authToken?: string): Promise<{
  syncedLogs: number;
  cachedEmployees: number;
}> {
  if (isSyncing) {
    const stats = await getOfflineDbStats();
    return { syncedLogs: 0, cachedEmployees: stats.cachedCount };
  }

  isSyncing = true;
  let syncedCount = 0;

  try {
    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      console.log('[EdgeSync] Device is offline. Operating in autonomous edge mode.');
      const stats = await getOfflineDbStats();
      return { syncedLogs: 0, cachedEmployees: stats.cachedCount };
    }

    // Step 1: PUSH pending attendance logs to cloud
    const pendingScans = await getPendingScans();
    if (pendingScans.length > 0) {
      const payload: BatchSyncPayloadItem[] = pendingScans.map((s) => ({
        id: s.id,
        employee_id: s.employee_id,
        check_type: s.check_type,
        timestamp: s.timestamp,
        confidence_score: s.confidence_score,
        liveness_score: s.liveness_score,
      }));

      try {
        const syncRes = await syncBatchAttendanceLogs(apiBaseUrl, 'kiosk-mobile-edge', payload, authToken);
        if (syncRes.success && syncRes.synced_ids.length > 0) {
          await markScansAsSynced(syncRes.synced_ids);
          syncedCount = syncRes.synced_ids.length;
          console.log(`[EdgeSync] Successfully flushed ${syncedCount} offline scans to cloud.`);
        }
      } catch (pushErr: any) {
        console.warn('[EdgeSync] Log push failed (will retry next cycle):', pushErr?.message || pushErr);
      }
    }

    // Step 2: PULL employee face vectors delta from cloud
    try {
      const deltas = await fetchEmployeeEmbeddingsDelta(apiBaseUrl, lastGallerySyncIso, authToken);
      if (deltas.length > 0) {
        await saveOrUpdateCachedEmployees(deltas);
        lastGallerySyncIso = new Date().toISOString();

        // Reload the fast in-memory SIMD matrix
        const updatedLocal = await getAllCachedEmployees();
        vectorGallery.loadGallery(updatedLocal);
        console.log(`[EdgeSync] Updated local vector gallery (${vectorGallery.getGallerySize()} active employees).`);
      }
    } catch (pullErr: any) {
      console.warn('[EdgeSync] Vector pull failed:', pullErr?.message || pullErr);
    }
  } catch (err: any) {
    console.warn('[EdgeSync] Full sync error:', err?.message || err);
  } finally {
    isSyncing = false;
  }

  const stats = await getOfflineDbStats();
  return {
    syncedLogs: syncedCount,
    cachedEmployees: stats.cachedCount,
  };
}

/**
 * PUSH pending attendance scans from phone to cloud (background task)
 */
export async function flushPendingAttendanceLogs(apiBaseUrl: string, authToken?: string): Promise<number> {
  let syncedCount = 0;
  try {
    const pendingScans = await getPendingScans();
    if (pendingScans.length === 0) return 0;

    const payload: BatchSyncPayloadItem[] = pendingScans.map((s) => ({
      id: s.id,
      employee_id: s.employee_id,
      check_type: s.check_type,
      timestamp: s.timestamp,
      confidence_score: s.confidence_score,
      liveness_score: s.liveness_score,
    }));

    const syncRes = await syncBatchAttendanceLogs(apiBaseUrl, 'kiosk-mobile-edge', payload, authToken);
    if (syncRes.success && syncRes.synced_ids.length > 0) {
      await markScansAsSynced(syncRes.synced_ids);
      syncedCount = syncRes.synced_ids.length;
      console.log(`[EdgeSync] Background flushed ${syncedCount} offline scans to cloud.`);
      notifySyncListeners();
    }
  } catch (err: any) {
    console.warn('[EdgeSync] flushPendingAttendanceLogs failed:', err?.message || err);
  }
  return syncedCount;
}

/**
 * PULL updated employee face embeddings delta from cloud (e.g. at login or app startup)
 */
export async function syncEmployeeEmbeddingsDelta(
  apiBaseUrl: string,
  authToken?: string
): Promise<{ count: number; error?: string }> {
  try {
    console.log(`[EdgeSync] Fetching employee embeddings delta from: ${apiBaseUrl}`);
    const deltas = await fetchEmployeeEmbeddingsDelta(apiBaseUrl, lastGallerySyncIso, authToken);
    console.log(`[EdgeSync] Server returned ${deltas?.length || 0} employees.`);

    if (deltas && deltas.length > 0) {
      await saveOrUpdateCachedEmployees(deltas);
      lastGallerySyncIso = new Date().toISOString();

      const updatedLocal = await getAllCachedEmployees();
      vectorGallery.loadGallery(updatedLocal);
      console.log(`[EdgeSync] Vector gallery reloaded with ${vectorGallery.getGallerySize()} employees.`);
      await notifySyncListeners();
      return { count: deltas.length };
    }

    // If delta was 0, reload whatever is already in local SQLite
    const local = await getAllCachedEmployees();
    vectorGallery.loadGallery(local);
    await notifySyncListeners();
    return { count: local.length };
  } catch (err: any) {
    const msg = err?.response?.data?.detail || err?.message || String(err);
    console.warn('[EdgeSync] syncEmployeeEmbeddingsDelta failed:', msg);
    await notifySyncListeners();
    return { count: 0, error: msg };
  }
}

/**
 * Force manual full sync (Pushes pending punches & pulls all employee embeddings from cloud)
 */
export async function forceSyncAll(
  apiBaseUrl: string,
  authToken?: string
): Promise<{ pushed: number; pulled: number; cachedTotal: number; error?: string }> {
  // Reset sync watermark to pull all registered employees
  lastGallerySyncIso = undefined;
  const pushed = await flushPendingAttendanceLogs(apiBaseUrl, authToken);
  const pullResult = await syncEmployeeEmbeddingsDelta(apiBaseUrl, authToken);
  const stats = await getOfflineDbStats();
  await notifySyncListeners();
  return {
    pushed,
    pulled: pullResult.count,
    cachedTotal: stats.cachedCount,
    error: pullResult.error,
  };
}
