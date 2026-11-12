import { loadFontFile } from './font-files';

describe('loadFontFile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('downloads each font once and shares the bytes', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    const [first, second] = await Promise.all([loadFontFile('/fonts/shared.ttf'), loadFontFile('/fonts/shared.ttf')]);
    expect(first).toBe(second);
    expect(await loadFontFile('/fonts/shared.ttf')).toBe(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries a download that failed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4])));
    await expect(loadFontFile('/fonts/retry.ttf')).rejects.toThrow('503');
    expect(new Uint8Array(await loadFontFile('/fonts/retry.ttf'))).toEqual(new Uint8Array([4]));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
