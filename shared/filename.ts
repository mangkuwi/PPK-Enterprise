import { todayISO } from './date';

export function sanitizeSegment(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Contoh: ND_Pembahasan_IP_HUB_2026-11-23.docx */
export function buildExportName(opts: { code?: string; title: string; date?: string; ext: string }): string {
  const code = sanitizeSegment(opts.code ?? '') || 'DOK';
  const title = sanitizeSegment(opts.title).slice(0, 60).replace(/_+$/, '') || 'Dokumen';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(opts.date ?? '') ? (opts.date as string) : todayISO();
  return `${code}_${title}_${date}.${opts.ext}`;
}
