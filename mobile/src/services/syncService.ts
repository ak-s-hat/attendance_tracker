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

let syncIntervalTimer: any = null;
let isSyncing = false;
let lastGallerySyncIso: string | undefined = undefined;

/**
 * Initializes the edge AI offline database and in-memory vector gallery.
 */
export async function initEdgeSyncService(apiBaseUrl: string, authToken?: string): Promise<void> {
  // 1. Preload gallery from local SQLite cache
  try {
    const localEmps = await getAllCachedEmployees();
    vectorGallery.loadGallery(localEmps);
    console.log(`[EdgeSync] Preloaded ${vectorGallery.getGallerySize()} employee vectors from local SQLite.`);
  } catch (err) {
    console.warn('[EdgeSync] Failed to preload local gallery:', err);
  }

  // 2. Initial cloud pull
  await runFullSyncCycle(apiBaseUrl, authToken);

  // 3. Setup periodic sync timer (every 30 seconds)
  if (syncIntervalTimer) {
    clearInterval(syncIntervalTimer);
  }

  syncIntervalTimer = setInterval(() => {
    runFullSyncCycle(apiBaseUrl, authToken).catch((e) =>
      console.warn('[EdgeSync] Periodic sync error:', e?.message || e)
    );
  }, 30000);

  // 4. NetInfo reconnection listener
  NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable) {
      console.log('[EdgeSync] Network restored — running sync flush...');
      runFullSyncCycle(apiBaseUrl, authToken).catch(() => {});
    }
  });
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
