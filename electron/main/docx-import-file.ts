import AdmZip from 'adm-zip';
import type { ImportedTemplate } from '@shared/types';
import { convertDocx } from './docx-import';

const MAX_ENTRY = 60 * 1024 * 1024;
const MAX_TOTAL = 300 * 1024 * 1024;

export function importDocxBuffer(buf: Buffer, fileName: string): ImportedTemplate {
  let zip: AdmZip;
  try { zip = new AdmZip(buf); } catch { throw new Error('Berkas tidak dapat dibaca sebagai dokumen Word (.docx). Berkas mungkin rusak atau dilindungi sandi.'); }
  let total = 0;
  for (const e of zip.getEntries()) {
    total += e.header.size;
    if (e.header.size > MAX_ENTRY || total > MAX_TOTAL) throw new Error('Isi berkas Word terlalu besar untuk diimpor.');
  }
  if (!zip.getEntry('word/document.xml')) {
    throw new Error('Bukan berkas .docx yang valid. Format .doc lama tidak didukung — buka di Word lalu "Simpan sebagai" .docx.');
  }
  const text = (p: string) => zip.getEntry(p)?.getData().toString('utf8');
  const r = convertDocx({
    document: text('word/document.xml') as string,
    styles: text('word/styles.xml'), numbering: text('word/numbering.xml'), rels: text('word/_rels/document.xml.rels'),
    theme: text('word/theme/theme1.xml'), part: text, media: (p) => zip.getEntry(p)?.getData()
  });
  const name = fileName.replace(/\.(docx|dotx)$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 200) || 'Template dari Word';
  return { name, description: `Diimpor dari berkas Word: ${fileName}`, ...r };
}
