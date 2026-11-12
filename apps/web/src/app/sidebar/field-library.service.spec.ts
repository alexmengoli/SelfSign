import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { FieldLibraryService } from './field-library.service';

describe('FieldLibraryService', () => {
  let service: FieldLibraryService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(FieldLibraryService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads saved values and server settings', async () => {
    const loading = service.load();
    http.expectOne('/api/values').flush([{ id: 'value-1', kind: 'text', label: 'Tax code', text: '123' }]);
    http.expectOne('/api/settings').flush({ dateFormat: 'yyyy-MM-dd' });
    await loading;

    expect(service.values()[0]?.label).toBe('Tax code');
    expect(service.valuesState()).toBe('ready');
    expect(service.settings()).toEqual({ dateFormat: 'yyyy-MM-dd' });
  });

  it('keeps date and text placement payloads independent of saved values', async () => {
    service.documentLoaded.set(true);
    const placements: unknown[] = [];
    const subscription = service.placementRequests.subscribe((placement) => placements.push(placement));

    await service.placeValue({ id: 'value-1', kind: 'text', label: 'Tax code', text: '123' });
    service.placeText('');
    service.placeText(service.todayPreview());

    expect(placements).toEqual([
      { kind: 'text', text: '123' },
      { kind: 'text', text: '' },
      { kind: 'text', text: service.todayPreview() },
    ]);
    subscription.unsubscribe();
  });

  it('places saved images from their URL so the viewer loads the bytes', () => {
    service.documentLoaded.set(true);
    const placements: unknown[] = [];
    const subscription = service.placementRequests.subscribe((placement) => placements.push(placement));

    service.placeValue({ id: 'value-2', kind: 'image', label: 'Signature', imageId: 'image-2', mimeType: 'image/png' });

    expect(placements).toEqual([{ kind: 'image', imageUrl: '/api/images/image-2' }]);
    subscription.unsubscribe();
  });

  it('uses the default format when settings cannot be loaded', async () => {
    const loading = service.loadSettings();
    http.expectOne('/api/settings').flush('unavailable', { status: 500, statusText: 'Server Error' });
    await loading;

    expect(service.settings()).toEqual({ dateFormat: 'dd/MM/yyyy' });
    expect(service.settingsState()).toBe('error');
  });

  it('cycles through date formats in order and wraps to the first format', async () => {
    const formats = ['MM/dd/yyyy', 'yyyy-MM-dd', 'dd.MM.yyyy', 'dd/MM/yyyy'];
    for (const dateFormat of formats) {
      const cycling = service.cycleDateFormat();
      const request = http.expectOne({ method: 'PUT', url: '/api/settings' });
      expect(request.request.body).toEqual({ dateFormat });
      request.flush({ dateFormat });
      await cycling;
      expect(service.settings().dateFormat).toBe(dateFormat);
    }
  });
});