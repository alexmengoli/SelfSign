export type ImageFormat = 'png' | 'jpeg';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
const ORIENTATION_TAG = 0x0112;

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  return null;
}

/** EXIF orientation (1–8) of a JPEG; 1 when missing or unreadable. */
export function jpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;
  try {
    while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) return 1;
      const length = view.getUint16(offset + 2);
      if (marker === 0xe1 && startsWith(bytes, EXIF_HEADER, offset + 4)) return tiffOrientation(view, offset + 10);
      offset += 2 + length;
    }
  } catch {
    // A truncated EXIF block reads past the end; the browser then shows the image unrotated too.
  }
  return 1;
}

function tiffOrientation(view: DataView, tiff: number): number {
  const little = view.getUint16(tiff) === 0x4949;
  const directory = tiff + view.getUint32(tiff + 4, little);
  const count = view.getUint16(directory, little);
  for (let index = 0; index < count; index++) {
    const entry = directory + 2 + index * 12;
    if (view.getUint16(entry, little) !== ORIENTATION_TAG) continue;
    const value = view.getUint16(entry + 8, little);
    return value >= 1 && value <= 8 ? value : 1;
  }
  return 1;
}
