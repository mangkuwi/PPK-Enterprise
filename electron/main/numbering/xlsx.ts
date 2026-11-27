/** Pembaca/penulis XLSX minimal tanpa pustaka luar (memakai Zip internal). Mendukung shared/inline string, angka, tanggal, boolean. */
import { Zip } from '../ooxml/zip';

export interface Sheet { name: string; rows: Array<Array<string | number | null>>; /** kolom bertanggal (indeks 0) pada rows hasil baca ditandai di dates */ dates?: Set<string> }
const MAX_ROWS = 50_000; const MAX_COLS = 60;

const unesc = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, k: string) =>
  k === 'lt' ? '<' : k === 'gt' ? '>' : k === 'amp' ? '&' : k === 'quot' ? '"' : k === 'apos' ? "'" : k[1] === 'x' ? String.fromCodePoint(parseInt(k.slice(2), 16)) : String.fromCodePoint(Number(k.slice(1))));
// eslint-disable-next-line no-control-regex -- karakter kontrol tidak sah di XML, sengaja dibuang
const esc = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (a: string, k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(a)?.[1];
const textOf = (x: string) => [...x.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');

export function colIndex(ref: string): number {
  let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1;
}
export const colName = (i: number) => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

export const serialToIso = (v: number): string => {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

function dateStyles(styles: string | undefined): Set<number> {
  const out = new Set<number>(); if (!styles) return out;
  const custom = new Map<number, string>();
  for (const m of styles.matchAll(/<numFmt\b([^>]*)\/?>/g)) { const id = attr(m[1], 'numFmtId'); const code = attr(m[1], 'formatCode'); if (id && code) custom.set(Number(id), unesc(code)); }
  const cx = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  let i = 0;
  for (const m of cx.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)) {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '');
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (code && /[dmy]/i.test(code) && !/0\.0|#/.test(code))) out.add(i);
    i++;
  }
  return out;
}

/** Nilai tanggal dikembalikan sebagai string ISO (YYYY-MM-DD); angka tetap number. */
export function readXlsx(buf: Buffer): Sheet[] {
  let z: Zip;
  try { z = Zip.read(buf); } catch { throw new Error('Berkas bukan XLSX yang valid.'); }
  const wb = z.text('xl/workbook.xml'); if (!wb) throw new Error('Berkas bukan XLSX yang valid (workbook tidak ditemukan).');
  const rels = new Map<string, string>();
  for (const m of (z.text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)) { const id = attr(m[1], 'Id'); const t = attr(m[1], 'Target'); if (id && t) rels.set(id, t); }
  const shared: string[] = [];
  for (const m of (z.text('xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  const dstyle = dateStyles(z.text('xl/styles.xml'));
  const sheets: Sheet[] = [];
  for (const m of wb.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = unesc(attr(m[1], 'name') ?? ''); const rid = attr(m[1], 'r:id') ?? attr(m[1], 'id');
    let target = rid ? rels.get(rid) : undefined; if (!target) continue;
    target = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
    const xml = z.text(target); if (!xml) continue;
    const rows: Sheet['rows'] = [];
    for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rn = Number(attr(rm[1], 'r') ?? rows.length + 1);
      if (rn > MAX_ROWS) throw new Error(`Lembar terlalu besar (maks. ${MAX_ROWS} baris).`);
      const row: Array<string | number | null> = [];
      for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], 'r'); const ci = ref ? colIndex(ref) : row.length; if (ci >= MAX_COLS) continue;
        const t = attr(cm[1], 't'); const s = Number(attr(cm[1], 's') ?? -1); const body = cm[2] ?? '';
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val: string | number | null = null;
        if (t === 's' && v != null) val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = textOf(body);
        else if (t === 'str' || t === 'e') val = v != null ? unesc(v) : null;
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v != null && v !== '') { const n = Number(v); val = Number.isFinite(n) ? (dstyle.has(s) ? serialToIso(n) : n) : unesc(v); }
        while (row.length < ci) row.push(null);
        row[ci] = val;
      }
      while (rows.length < rn - 1) rows.push([]);
      rows[rn - 1] = row;
    }
    sheets.push({ name, rows });
  }
  return sheets;
}

// ---------- penulis ----------
export interface WriteSheet { name: string; header: string[]; rows: Array<Array<string | number | null>>; widths?: number[] }

export function writeXlsx(sheets: WriteSheet[]): Buffer {
  const z = new Zip();
  const used = new Set<string>();
  const names = sheets.map((s, i) => { let n = s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`; while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)}_${i}`; used.add(n.toLowerCase()); return n; });
  z.set('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  z.set('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.set('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`);
  z.set('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.set('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s, i) => {
    const cell = (v: string | number | null, r: number, c: number, style: number) => {
      const ref = `${colName(c)}${r}`;
      if (v === null || v === '') return style ? `<c r="${ref}" s="${style}"/>` : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
      return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
    };
    const widths = s.widths ?? s.header.map(() => 18);
    const body = [s.header, ...s.rows].map((row, ri) => `<row r="${ri + 1}">${row.map((v, ci) => cell(v, ri + 1, ci, ri === 0 ? 1 : 0)).join('')}</row>`).join('');
    z.set(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`);
  });
  return z.toBuffer();
}
