export type DocumentFontId = 'noto-sans' | 'noto-serif' | 'caveat';

export interface DocumentFont {
  id: DocumentFontId;
  /** CSS font-family registered in styles.scss. */
  family: string;
  label: string;
  /** TrueType file served from public/, shared by on-screen rendering and PDF export. */
  url: string;
}

export const DOCUMENT_FONTS: readonly DocumentFont[] = [
  { id: 'noto-sans', family: 'Noto Sans', label: 'Noto Sans', url: '/fonts/NotoSans-Regular.ttf' },
  { id: 'noto-serif', family: 'Noto Serif', label: 'Noto Serif', url: '/fonts/NotoSerif-Regular.ttf' },
  { id: 'caveat', family: 'Caveat', label: 'Caveat', url: '/fonts/Caveat-Regular.ttf' },
];

export const DEFAULT_DOCUMENT_FONT_ID: DocumentFontId = 'noto-sans';
