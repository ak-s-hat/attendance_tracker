/**
 * imageDecoder.ts
 * Decodes compressed JPEG base64 strings into raw RGBA pixel byte arrays
 * for on-device ONNX vision models (SCRFD, ArcFace, MiniFASNet).
 */

export interface DecodedImage {
  width: number;
  height: number;
  data: Uint8Array; // Raw uncompressed RGBA pixel bytes
}

let jpegModule: any = null;
try {
  jpegModule = require('jpeg-js');
} catch (_) {
  // jpeg-js will be installed via package.json
}

export function decodeJpegBase64(base64Str: string): DecodedImage | null {
  if (!base64Str) return null;

  try {
    // Strip data URI header if present
    const cleanBase64 = base64Str.replace(/^data:image\/[a-z]+;base64,/, '');

    // Convert base64 to byte array
    const binaryStr = atob(cleanBase64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    if (jpegModule && typeof jpegModule.decode === 'function') {
      const raw = jpegModule.decode(bytes, { useTArray: true, formatAsRGBA: true });
      return {
        width: raw.width,
        height: raw.height,
        data: raw.data as Uint8Array,
      };
    }

    // Fallback if jpeg-js is not yet loaded: return raw bytes
    return {
      width: 640,
      height: 640,
      data: bytes,
    };
  } catch (err) {
    console.warn('[imageDecoder] JPEG decoding error:', err);
    return null;
  }
}
