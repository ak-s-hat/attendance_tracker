/**
 * debugDump.ts
 * Kiosk "Debug mode": for every scan, saves the exact inputs each model received plus a trace.json
 * to <documentDirectory>/debug/<traceId>/ so they can be pulled to the PC
 * (`read_phone_logs.ps1 -Pull`) and compared against the Python reference pipeline.
 *
 * Tensors are written as lossless 24-bit BMP (the model inputs are integer pixels, so the
 * de-normalised values are exact). The original camera JPEG is copied alongside as frame.jpg.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { log } from './logger';

let enabled = false;

export function setDebugDumpEnabled(value: boolean): void {
  enabled = value;
  log.info('DEBUG_DUMP', `Debug dump ${value ? 'enabled' : 'disabled'}`);
}

export function isDebugDumpEnabled(): boolean {
  return enabled;
}

export function getDebugRoot(): string {
  return `${FileSystem.documentDirectory}debug/`;
}

/** How a model's NCHW float tensor maps back to 0..255 RGB. */
export type TensorLayout =
  | { order: 'RGB'; mean: number; std: number }
  | { order: 'BGR'; mean: number; std: number };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

/** Converts a [1,3,size,size] tensor back into a 24-bit BMP file (bytes). */
export function tensorToBmp(tensor: Float32Array, size: number, layout: TensorLayout): Uint8Array {
  const plane = size * size;
  const rowBytes = size * 3;
  const pad = (4 - (rowBytes % 4)) % 4;
  const imageBytes = (rowBytes + pad) * size;
  const buf = new Uint8Array(54 + imageBytes);
  const dv = new DataView(buf.buffer);
  // BITMAPFILEHEADER
  buf[0] = 0x42; buf[1] = 0x4d;
  dv.setUint32(2, buf.length, true);
  dv.setUint32(10, 54, true);
  // BITMAPINFOHEADER
  dv.setUint32(14, 40, true);
  dv.setInt32(18, size, true);
  dv.setInt32(22, size, true); // positive height = bottom-up rows
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, imageBytes, true);

  const toByte = (v: number) => {
    const p = Math.round(v * layout.std + layout.mean);
    return p < 0 ? 0 : p > 255 ? 255 : p;
  };

  let o = 54;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const c0 = toByte(tensor[idx]);
      const c1 = toByte(tensor[plane + idx]);
      const c2 = toByte(tensor[2 * plane + idx]);
      // BMP pixel order is B, G, R
      if (layout.order === 'RGB') {
        buf[o++] = c2; buf[o++] = c1; buf[o++] = c0;
      } else {
        buf[o++] = c0; buf[o++] = c1; buf[o++] = c2;
      }
    }
    o += pad;
  }
  return buf;
}

export interface ScanDumpInput {
  traceId: string;
  frameUri?: string;
  tensors: { name: string; tensor: Float32Array | null | undefined; size: number; layout: TensorLayout }[];
  trace: Record<string, any>;
}

/** Writes all artifacts for one scan. Never throws. */
export async function dumpScanArtifacts(input: ScanDumpInput): Promise<void> {
  if (!enabled) return;
  try {
    const dir = `${getDebugRoot()}${input.traceId}/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

    if (input.frameUri) {
      try {
        await FileSystem.copyAsync({ from: input.frameUri, to: `${dir}frame.jpg` });
      } catch (copyErr: any) {
        log.warn('DEBUG_DUMP', 'frame copy failed', { error: copyErr?.message }, input.traceId);
      }
    }

    for (const t of input.tensors) {
      if (!t.tensor) continue;
      const bmp = tensorToBmp(t.tensor, t.size, t.layout);
      await FileSystem.writeAsStringAsync(`${dir}${t.name}.bmp`, bytesToBase64(bmp), {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    await FileSystem.writeAsStringAsync(`${dir}trace.json`, JSON.stringify(input.trace, null, 2));
    log.info('DEBUG_DUMP', `Saved artifacts to ${dir}`, null, input.traceId);
  } catch (err: any) {
    log.warn('DEBUG_DUMP', 'dump failed', { error: err?.message || String(err) }, input.traceId);
  }
}

/** Deletes all dumped scans (they are only meant to live until pulled to the PC). */
export async function clearDebugDumps(): Promise<void> {
  try {
    await FileSystem.deleteAsync(getDebugRoot(), { idempotent: true });
  } catch (_) {}
}
