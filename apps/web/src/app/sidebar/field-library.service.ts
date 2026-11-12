import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';
import {
  DEFAULT_DATE_FORMAT,
  DATE_FORMATS,
  formatDate,
  type DateFormat,
  type SavedValue,
  type Settings,
} from '@selfsign/shared';

export type FieldPlacement =
  | { kind: 'text'; text: string }
  | { kind: 'image'; imageUrl: string };

export type LoadState = 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class FieldLibraryService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly placements = new Subject<FieldPlacement>();

  readonly values = signal<SavedValue[]>([]);
  readonly valuesState = signal<LoadState>('loading');
  readonly settings = signal<Settings>({ dateFormat: DEFAULT_DATE_FORMAT });
  readonly settingsState = signal<LoadState>('loading');
  readonly documentLoaded = signal(false);
  readonly placementRequests = this.placements.asObservable();
  readonly today = signal(new Date());
  readonly todayPreview = computed(() => formatDate(this.today(), this.settings().dateFormat));

  constructor() {
    const timer = setInterval(() => this.today.set(new Date()), 60_000);
    this.destroyRef.onDestroy(() => clearInterval(timer));
  }

  async load(): Promise<void> {
    await Promise.all([this.loadValues(), this.loadSettings()]);
  }

  async loadValues(): Promise<void> {
    this.valuesState.set('loading');
    try {
      this.values.set(await firstValueFrom(this.http.get<SavedValue[]>('/api/values')));
      this.valuesState.set('ready');
    } catch {
      this.valuesState.set('error');
    }
  }

  async loadSettings(): Promise<void> {
    this.settingsState.set('loading');
    try {
      this.settings.set(await firstValueFrom(this.http.get<Settings>('/api/settings')));
      this.settingsState.set('ready');
    } catch {
      this.settings.set({ dateFormat: DEFAULT_DATE_FORMAT });
      this.settingsState.set('error');
    }
  }

  imageUrl(value: SavedValue): string {
    return value.imageId ? `/api/images/${value.imageId}` : '';
  }

  async addText(label: string, text: string): Promise<SavedValue> {
    const value = await firstValueFrom(this.http.post<SavedValue>('/api/values', { label, text }));
    this.values.update((values) => [...values, value]);
    this.valuesState.set('ready');
    return value;
  }

  async addImage(label: string, file: File): Promise<SavedValue> {
    const body = new FormData();
    body.set('label', label);
    body.set('file', file);
    const value = await firstValueFrom(this.http.post<SavedValue>('/api/values/image', body));
    this.values.update((values) => [...values, value]);
    this.valuesState.set('ready');
    return value;
  }

  async editValue(value: SavedValue, label: string, text?: string, file?: File): Promise<SavedValue> {
    let updated: SavedValue;
    if (value.kind === 'image' && file) {
      const body = new FormData();
      body.set('label', label);
      body.set('file', file);
      updated = await firstValueFrom(this.http.put<SavedValue>(`/api/values/${value.id}/image`, body));
    } else {
      const payload = value.kind === 'text' ? { label, text } : { label };
      updated = await firstValueFrom(this.http.put<SavedValue>(`/api/values/${value.id}`, payload));
    }
    this.values.update((values) => values.map((item) => item.id === updated.id ? updated : item));
    this.valuesState.set('ready');
    return updated;
  }

  async deleteValue(value: SavedValue): Promise<void> {
    await firstValueFrom(this.http.delete<void>(`/api/values/${value.id}`));
    this.values.update((values) => values.filter((item) => item.id !== value.id));
    this.valuesState.set('ready');
  }

  async reorder(ids: string[]): Promise<void> {
    const values = await firstValueFrom(this.http.put<SavedValue[]>('/api/values/order', { ids }));
    this.values.set(values);
    this.valuesState.set('ready');
  }

  async setDateFormat(dateFormat: DateFormat): Promise<void> {
    const settings = await firstValueFrom(this.http.put<Settings>('/api/settings', { dateFormat }));
    this.settings.set(settings);
    this.settingsState.set('ready');
  }

  async cycleDateFormat(): Promise<void> {
    const currentIndex = DATE_FORMATS.indexOf(this.settings().dateFormat);
    const nextFormat = DATE_FORMATS[(currentIndex + 1) % DATE_FORMATS.length]!;
    await this.setDateFormat(nextFormat);
  }

  placeText(text: string): void {
    if (this.documentLoaded()) this.placements.next({ kind: 'text', text });
  }

  placeToday(): void {
    const now = new Date();
    this.today.set(now);
    this.placeText(formatDate(now, this.settings().dateFormat));
  }

  placementFor(value: SavedValue): FieldPlacement {
    return value.kind === 'text'
      ? { kind: 'text', text: value.text ?? '' }
      : { kind: 'image', imageUrl: this.imageUrl(value) };
  }

  placeValue(value: SavedValue): void {
    if (!this.documentLoaded()) return;
    if (value.kind === 'image' && !value.imageId) throw new Error('Image value is missing its image.');
    this.placements.next(this.placementFor(value));
  }
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpErrorResponse && typeof error.error?.error === 'string') return error.error.error;
  return fallback;
}