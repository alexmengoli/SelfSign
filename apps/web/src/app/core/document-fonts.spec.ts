import { DEFAULT_DOCUMENT_FONT_ID, DOCUMENT_FONTS } from './document-fonts';

describe('DOCUMENT_FONTS', () => {
  it('lists the bundled fonts with Noto Sans as default', () => {
    expect(DOCUMENT_FONTS.map((font) => font.family)).toEqual(['Noto Sans', 'Noto Serif', 'Caveat']);
    expect(DOCUMENT_FONTS.find((font) => font.id === DEFAULT_DOCUMENT_FONT_ID)?.family).toBe('Noto Sans');
  });

  it('serves every font from the same origin', () => {
    for (const font of DOCUMENT_FONTS) {
      expect(font.url).toMatch(/^\/fonts\/[\w-]+\.ttf$/);
    }
  });
});
