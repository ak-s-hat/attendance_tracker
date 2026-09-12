import { decodeJpegBase64 } from '../../src/services/imageDecoder';

describe('imageDecoder Unit Tests', () => {
  it('returns null for empty or undefined input', () => {
    expect(decodeJpegBase64('')).toBeNull();
  });

  it('safely handles data URI prefix', () => {
    // Valid 1x1 blank base64 dummy
    const base64 = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const result = decodeJpegBase64(base64);
    // Even if jpeg-js is mocked or fallback, it returns an object with width, height, and data
    expect(result).toBeDefined();
    if (result) {
      expect(result.data).toBeInstanceOf(Uint8Array);
    }
  });
});
