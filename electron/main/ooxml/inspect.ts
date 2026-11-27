import type { DocInfo, Warning } from '@shared/importer';
import { Zip } from './zip';
import { documentParts, partLabel, scanPart, type Scan } from './scan';

const TWIP_MM = 25.4 / 1440;
const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));

export function scanAll(zip: Zip): Scan[] {
  return documentParts(zip.names()).map((part) => scanPart(part, zip.text(part) ?? ''));
}

export function inspectDocx(zip: Zip, scans: Scan[]): { info: DocInfo; warnings: Warning[] } {
  const doc = zip.text('word/document.xml') ?? '';
  const sect = [...doc.matchAll(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)].pop()?.[0] ?? '';
  const pgSz = /<w:pgSz\s[^>]*>/.exec(sect)?.[0] ?? '';
  const pgMar = /<w:pgMar\s[^>]*>/.exec(sect)?.[0] ?? '';
  const g = (tag: string, name: string) => num(new RegExp(`w:${name}="(-?\\d+)"`).exec(tag)?.[1]);
  const mm = (v: number | undefined, d: number) => (v === undefined ? d : Math.round(v * TWIP_MM));

  const fontCount = new Map<string, number>();
  for (const part of documentParts(zip.names())) {
    for (const m of (zip.text(part) ?? '').matchAll(/<w:rFonts\s[^>]*w:ascii="([^"]+)"/g)) fontCount.set(m[1], (fontCount.get(m[1]) ?? 0) + 1);
  }
  const styles = zip.text('word/styles.xml') ?? '';
  const defFont = /<w:docDefaults>[\s\S]*?<w:rFonts\s[^>]*w:ascii="([^"]+)"/.exec(styles)?.[1]
    ?? /<w:style [^>]*w:styleId="Normal"[\s\S]*?<w:rFonts\s[^>]*w:ascii="([^"]+)"/.exec(styles)?.[1];
  if (defFont && !fontCount.size) fontCount.set(defFont, 1);

  const names = zip.names();
  const images = names.filter((n) => n.startsWith('word/media/')).map((n) => ({ path: n, bytes: zip.entry(n)?.size ?? 0 }));
  const all = documentParts(names).map((p) => zip.text(p) ?? '').join('\n');
  const count = (re: RegExp) => (all.match(re) ?? []).length;

  const info: DocInfo = {
    page: {
      width_mm: mm(g(pgSz, 'w'), 210), height_mm: mm(g(pgSz, 'h'), 297),
      margin_top: mm(g(pgMar, 'top'), 25), margin_right: mm(g(pgMar, 'right'), 25), margin_bottom: mm(g(pgMar, 'bottom'), 25), margin_left: mm(g(pgMar, 'left'), 30)
    },
    fonts: [...fontCount].sort((a, b) => b[1] - a[1]).map(([name, c]) => ({ name, count: c })),
    images,
    headers: names.filter((n) => /^word\/header\d*\.xml$/.test(n)).length,
    footers: names.filter((n) => /^word\/footer\d*\.xml$/.test(n)).length,
    tables: scans.filter((s) => s.part === 'word/document.xml').reduce((a, s) => a + s.tables, 0),
    paragraphs: scans.filter((s) => s.part === 'word/document.xml').reduce((a, s) => a + s.paras.length, 0),
    section_breaks: Math.max(0, count(/<w:sectPr[\s>]/g) - 1),
    page_breaks: count(/<w:br\s[^>]*w:type="page"/g) + count(/<w:pageBreakBefore\b/g),
    textboxes: count(/<w:txbxContent\b/g),
    fields: count(/<w:fldChar\s[^>]*w:fldCharType="begin"/g) + count(/<w:fldSimple\b/g),
    tracked_changes: count(/<w:ins\s/g) + count(/<w:del\s/g),
    numbered_paragraphs: scans.reduce((a, s) => a + s.paras.filter((p) => p.isList).length, 0),
    comments: zip.has('word/comments.xml'),
    has_kop: false
  };

  const warnings: Warning[] = [];
  if (info.images.length) warnings.push({ code: 'images', level: 'info', message: `${info.images.length} gambar/logo ditemukan dan dipertahankan apa adanya (berkas gambar tidak diubah).` });
  if (info.textboxes) warnings.push({ code: 'textbox', level: 'warn', message: `${info.textboxes} kotak teks ditemukan. Teks di dalamnya ikut dianalisis, tetapi posisinya tidak tampil pada tinjauan teks.` });
  if (info.fields) warnings.push({ code: 'fields', level: 'info', message: `${info.fields} field Word (mis. nomor halaman) dipertahankan; teks hasil field tidak dipetakan.` });
  if (info.tracked_changes) warnings.push({ code: 'tracked', level: 'warn', message: 'Dokumen memuat perubahan terlacak (tracked changes). Terima atau tolak semua perubahan di Word terlebih dahulu agar teks yang dipetakan sesuai.' });
  if (info.comments) warnings.push({ code: 'comments', level: 'info', message: 'Komentar Word ditemukan dan dipertahankan di dokumen hasil.' });
  if (info.section_breaks) warnings.push({ code: 'sections', level: 'info', message: `${info.section_breaks} pemisah bagian (section break) dipertahankan.` });
  if (names.some((n) => /vbaProject|\.bin$/.test(n) && n.startsWith('word/'))) warnings.push({ code: 'macro', level: 'warn', message: 'Berkas memuat objek tertanam/makro. Dokumen hasil mengikuti berkas apa adanya.' });
  return { info, warnings };
}

/** Tanda tangan struktur XML: seluruh isi teks (<w:t>) dikosongkan sehingga hanya format/struktur yang dibandingkan. */
export function structureSignature(xml: string): string {
  return xml
    .replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, '<T/>')
    .replace(/(?:<T\/>(?:<w:(?:br|tab)\/>)?)+/g, '<T/>')
    .replace(/<w:t(?:\s[^>]*)?\/>/g, '<T/>');
}

export interface PartCompare {
  part: string; label: string;
  paragraphs: [number, number]; tables: [number, number]; rows: [number, number]; drawings: [number, number];
  signature_equal: boolean; text_changes: number;
}
export interface CompareReport {
  identical_entries: number;
  changed_entries: string[];
  parts: PartCompare[];
  format_preserved: boolean;
  notes: Warning[];
}
export interface ParaDiff { part: string; index: number; before: string; after: string }

const countRe = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export function compareZips(a: Zip, b: Zip): CompareReport {
  const notes: Warning[] = [];
  const partsA = new Set(documentParts(a.names()));
  const changed: string[] = [];
  let identical = 0;
  const allNames = new Set([...a.names(), ...b.names()]);
  for (const n of allNames) {
    const ea = a.entry(n); const eb = b.entry(n);
    if (!ea || !eb) { changed.push(n); continue; }
    if (ea.crc === eb.crc && ea.size === eb.size) identical++;
    else if (!partsA.has(n)) changed.push(n);
  }
  const parts: PartCompare[] = [];
  for (const part of documentParts(b.names())) {
    const xa = a.text(part) ?? ''; const xb = b.text(part) ?? '';
    const sa = scanPart(part, xa); const sb = scanPart(part, xb);
    let tc = 0;
    if (sa.paras.length === sb.paras.length) sa.paras.forEach((p, i) => { if (p.text !== sb.paras[i].text) tc++; });
    else tc = Math.abs(sa.paras.length - sb.paras.length);
    const pc: PartCompare = {
      part, label: partLabel(part),
      paragraphs: [sa.paras.length, sb.paras.length], tables: [sa.tables, sb.tables], rows: [sa.rows.length, sb.rows.length],
      drawings: [countRe(xa, /<w:drawing\b|<w:pict\b/g), countRe(xb, /<w:drawing\b|<w:pict\b/g)],
      signature_equal: structureSignature(xa) === structureSignature(xb), text_changes: tc
    };
    parts.push(pc);
    if (pc.paragraphs[0] !== pc.paragraphs[1]) notes.push({ code: 'paragraphs', level: 'info', message: `${pc.label}: jumlah paragraf ${pc.paragraphs[0]} → ${pc.paragraphs[1]} (isian multi-baris diperluas atau isian opsional kosong dihapus).` });
    if (pc.tables[0] !== pc.tables[1]) notes.push({ code: 'tables', level: 'warn', message: `${pc.label}: jumlah tabel berubah ${pc.tables[0]} → ${pc.tables[1]}.` });
    if (pc.rows[0] !== pc.rows[1]) notes.push({ code: 'rows', level: 'info', message: `${pc.label}: jumlah baris tabel ${pc.rows[0]} → ${pc.rows[1]} (baris berulang).` });
    if (pc.drawings[0] !== pc.drawings[1]) notes.push({ code: 'drawings', level: 'warn', message: `${pc.label}: jumlah gambar/objek berubah ${pc.drawings[0]} → ${pc.drawings[1]}.` });
    if (!pc.signature_equal && pc.paragraphs[0] === pc.paragraphs[1] && pc.rows[0] === pc.rows[1]) notes.push({ code: 'format', level: 'warn', message: `${pc.label}: ada perbedaan struktur/format XML di luar teks.` });
  }
  const nonDocChanged = changed.filter((n) => !partsA.has(n));
  if (nonDocChanged.length) notes.push({ code: 'entries', level: 'warn', message: `Berkas non-teks berubah: ${nonDocChanged.join(', ')}.` });
  const structural = parts.every((p) => p.signature_equal || p.paragraphs[0] !== p.paragraphs[1] || p.rows[0] !== p.rows[1]);
  const drawingsOk = parts.every((p) => p.drawings[0] === p.drawings[1]);
  return { identical_entries: identical, changed_entries: changed, parts, format_preserved: nonDocChanged.length === 0 && structural && drawingsOk && parts.every((p) => p.tables[0] === p.tables[1]), notes };
}

/** Daftar paragraf yang teksnya berbeda (untuk tampilan perbandingan). Dicocokkan per indeks bila jumlahnya sama, selain itu per teks. */
export function paragraphDiff(a: Zip, b: Zip, limit = 400): ParaDiff[] {
  const out: ParaDiff[] = [];
  for (const part of documentParts(b.names())) {
    const pa = scanPart(part, a.text(part) ?? '').paras; const pb = scanPart(part, b.text(part) ?? '').paras;
    if (pa.length === pb.length) {
      pa.forEach((p, i) => { if (p.text !== pb[i].text) out.push({ part, index: i, before: p.text, after: pb[i].text }); });
    } else {
      const setA = new Set(pa.map((p) => p.text)); const setB = new Set(pb.map((p) => p.text));
      pa.forEach((p) => { if (p.text && !setB.has(p.text)) out.push({ part, index: p.index, before: p.text, after: '' }); });
      pb.forEach((p) => { if (p.text && !setA.has(p.text)) out.push({ part, index: p.index, before: '', after: p.text }); });
    }
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}
