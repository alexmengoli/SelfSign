import { detectImageFormat, jpegOrientation } from './image-format';

function exifJpeg(orientation: number, littleEndian: boolean): Uint8Array {
  const tiff = new DataView(new ArrayBuffer(26));
  tiff.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
  tiff.setUint16(2, 42, littleEndian);
  tiff.setUint32(4, 8, littleEndian);
  tiff.setUint16(8, 1, littleEndian);
  tiff.setUint16(10, 0x0112, littleEndian);
  tiff.setUint16(12, 3, littleEndian);
  tiff.setUint32(14, 1, littleEndian);
  tiff.setUint16(18, orientation, littleEndian);
  const exif = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...new Uint8Array(tiff.buffer)];
  const length = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xe1, length >> 8, length & 0xff, ...exif, 0xff, 0xda]);
}

describe('image format', () => {
  it('detects PNG and JPEG signatures', () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('png');
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(detectImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
  });

  it('reads the EXIF orientation in both byte orders after other segments', () => {
    expect(jpegOrientation(exifJpeg(6, false))).toBe(6);
    expect(jpegOrientation(exifJpeg(3, true))).toBe(3);
  });

  it('falls back to 1 for missing, invalid or truncated orientation data', () => {
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda]))).toBe(1);
    expect(jpegOrientation(exifJpeg(9, false))).toBe(1);
    expect(jpegOrientation(exifJpeg(6, false).subarray(0, 24))).toBe(1);
  });
});
