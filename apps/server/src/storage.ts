import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_DATE_FORMAT,
  isDateFormat,
  type DateFormat,
  type SavedValue,
  type Settings,
} from '@selfsign/shared';

interface StoreData {
  values: SavedValue[];
  settings: Settings;
}

export interface StoredImage {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg';
}

export class FieldStorage {
  private data: StoreData = { values: [], settings: { dateFormat: DEFAULT_DATE_FORMAT } };
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly dataPath: string;
  private readonly imagesPath: string;

  private constructor(private readonly dataDir: string) {
    this.dataPath = path.join(dataDir, 'data.json');
    this.imagesPath = path.join(dataDir, 'images');
  }

  static async open(dataDir: string): Promise<FieldStorage> {
    const storage = new FieldStorage(dataDir);
    await mkdir(storage.imagesPath, { recursive: true });
    try {
      storage.data = parseStoreData(JSON.parse(await readFile(storage.dataPath, 'utf8')));
    } catch (error) {
      if (!isMissingFile(error)) throw error;
    }
    return storage;
  }

  listValues(): SavedValue[] {
    return structuredClone(this.data.values);
  }

  getSettings(): Settings {
    return { ...this.data.settings };
  }

  async createTextValue(label: string, text: string): Promise<SavedValue> {
    const value: SavedValue = { id: randomUUID(), kind: 'text', label, text };
    await this.mutate((data) => data.values.push(value));
    return value;
  }

  async createImageValue(label: string, image: StoredImage): Promise<SavedValue> {
    const imageId = randomUUID();
    const value: SavedValue = {
      id: randomUUID(),
      kind: 'image',
      label,
      imageId,
      mimeType: image.mimeType,
    };
    await this.writeImage(imageId, image);
    try {
      await this.mutate((data) => data.values.push(value));
    } catch (error) {
      await this.removeImage(imageId);
      throw error;
    }
    return value;
  }

  async updateValue(id: string, label: string, text?: string): Promise<SavedValue | undefined> {
    return this.mutate((data) => {
      const value = data.values.find((item) => item.id === id);
      if (!value) return undefined;
      value.label = label;
      if (value.kind === 'text' && text !== undefined) value.text = text;
      return structuredClone(value);
    });
  }

  async replaceImage(id: string, image: StoredImage, label?: string): Promise<SavedValue | undefined> {
    const imageId = randomUUID();
    const original = this.data.values.find((item) => item.id === id);
    if (!original || original.kind !== 'image') return undefined;
    await this.writeImage(imageId, image);
    let updated: SavedValue | undefined;
    try {
      updated = await this.mutate((data) => {
        const value = data.values.find((item) => item.id === id);
        if (!value || value.kind !== 'image') return undefined;
        value.imageId = imageId;
        value.mimeType = image.mimeType;
        if (label !== undefined) value.label = label;
        return structuredClone(value);
      });
    } catch (error) {
      await this.removeImage(imageId);
      throw error;
    }
    if (updated) await this.removeImage(original.imageId);
    else await this.removeImage(imageId);
    return updated;
  }

  async deleteValue(id: string): Promise<boolean> {
    const original = this.data.values.find((item) => item.id === id);
    if (!original) return false;
    const deleted = await this.mutate((data) => {
      const index = data.values.findIndex((item) => item.id === id);
      if (index < 0) return undefined;
      return data.values.splice(index, 1)[0];
    });
    if (!deleted) return false;
    if (deleted.kind === 'image' && deleted.imageId) await this.removeImage(deleted.imageId);
    return true;
  }

  async reorderValues(ids: string[]): Promise<SavedValue[] | undefined> {
    return this.mutate((data) => {
      if (ids.length !== data.values.length || new Set(ids).size !== ids.length) return undefined;
      const values = new Map(data.values.map((value) => [value.id, value]));
      if (ids.some((id) => !values.has(id))) return undefined;
      data.values = ids.map((id) => values.get(id)!);
      return structuredClone(data.values);
    });
  }

  async getImage(imageId: string): Promise<StoredImage | undefined> {
    const value = this.data.values.find((item) => item.kind === 'image' && item.imageId === imageId);
    if (!value?.imageId || (value.mimeType !== 'image/png' && value.mimeType !== 'image/jpeg')) return undefined;
    try {
      return { bytes: await readFile(this.imagePath(value.imageId, value.mimeType)), mimeType: value.mimeType };
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  async updateSettings(settings: Settings): Promise<Settings> {
    await this.mutate((data) => {
      data.settings = settings;
    });
    return this.getSettings();
  }

  private async mutate<T>(change: (data: StoreData) => T): Promise<T> {
    let result!: T;
    const operation = this.writeQueue.then(async () => {
      const next = structuredClone(this.data);
      result = change(next);
      await this.writeAtomically(next);
      this.data = next;
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
    return result;
  }

  private async writeAtomically(data: StoreData): Promise<void> {
    const temporaryPath = `${this.dataPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, JSON.stringify(data), { flag: 'wx' });
      await rename(temporaryPath, this.dataPath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }

  private async writeImage(imageId: string, image: StoredImage): Promise<void> {
    await writeFile(this.imagePath(imageId, image.mimeType), image.bytes, { flag: 'wx' });
  }

  private async removeImage(imageId?: string): Promise<void> {
    if (!imageId) return;
    await Promise.all([
      rm(this.imagePath(imageId, 'image/png'), { force: true }),
      rm(this.imagePath(imageId, 'image/jpeg'), { force: true }),
    ]);
  }

  private imagePath(imageId: string, mimeType: StoredImage['mimeType']): string {
    return path.join(this.imagesPath, `${imageId}.${mimeType === 'image/png' ? 'png' : 'jpg'}`);
  }
}

export function detectImage(bytes: Buffer): StoredImage['mimeType'] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return undefined;
}

function parseStoreData(value: unknown): StoreData {
  if (typeof value !== 'object' || value === null || !('values' in value) || !Array.isArray(value.values)) {
    throw new Error('Invalid field data file.');
  }
  const record = value as { values: unknown[]; settings?: unknown };
  if (record.values.some((item) => typeof item !== 'object' || item === null)) throw new Error('Invalid field data file.');
  const settings = record.settings as { dateFormat?: unknown } | undefined;
  if (!settings || !isDateFormat(settings.dateFormat)) throw new Error('Invalid field settings in data file.');
  return { values: record.values as SavedValue[], settings: { dateFormat: settings.dateFormat as DateFormat } };
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}