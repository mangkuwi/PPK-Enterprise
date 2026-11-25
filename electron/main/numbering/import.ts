import { createHash, randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { Actor, ImportCommitInput, ImportField, ImportPreview, ImportReport, ImportResult, ImportRowIssue, Register } from '@shared/numbering';
import { IMPORT_FIELDS, maxSeqFor, normalizeNumberText, parseNumber, renderNumber } from '@shared/numbering';
import { NumberingError } from './errors';
import { requireAdmin } from './users';
import { audit } from './audit';
import { nowIso } from './clock';
import { getRegister } from './registers';
import { bumpCounter } from './engine';
import { readXlsx, type Sheet } from './xlsx';

const MONTHS: Record<string, number> = { januari: 1, jan: 1, februari: 2, feb: 2, pebruari: 2, maret: 3, mar: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7, agustus: 8, agu: 8, agt: 8, ags: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, oct: 10, november: 11, nov: 11, nop: 11, desember: 12, des: 12, dec: 12 };
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const str = (v: unknown) => (v == null ? '' : String(v).trim());

export function autoMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const map: Partial<Record<ImportField, number>> = {};
  const hs = headers.map(norm);
  // nama kolom persis lebih diutamakan daripada kecocokan sebagian
  for (const f of IMPORT_FIELDS) { const i = hs.findIndex((h, idx) => f.aliases.includes(h) && !Object.values(map).includes(idx)); if (i >= 0) map[f.key] = i; }
  return map;
}
const headerScore = (row: Array<string | number | null>) => Object.keys(autoMapping(row.map((c) => str(c)))).length;

function pickSheet(sheets: Sheet[], name?: string): Sheet {
  const s = (name ? sheets.find((x) => x.name === name) : undefined) ?? sheets.find((x) => x.rows.some((r) => r.some((c) => c != null && c !== '')));
  if (!s) throw new NumberingError('INVALID', 'Berkas Excel tidak berisi lembar yang dapat dibaca.');
  return s;
}

export function previewImport(buf: Buffer, sheetName?: string, headerRow?: number): ImportPreview {
  let sheets: Sheet[];
  try { sheets = readXlsx(buf); } catch (e) { throw new NumberingError('INVALID', (e as Error).message); }
  const sheet = pickSheet(sheets, sheetName);
  let hr = headerRow ?? 0;
  if (!headerRow) { let best = -1; for (let i = 0; i < Math.min(sheet.rows.length, 15); i++) { const sc = headerScore(sheet.rows[i] ?? []); if (sc > best && sc >= 2) { best = sc; hr = i + 1; } } if (!hr) hr = 1; }
  const headers = (sheet.rows[hr - 1] ?? []).map((c) => str(c));
  const data = sheet.rows.slice(hr);
  return {
    sheets: sheets.map((s) => s.name), sheet: sheet.name, header_row: hr, headers,
    sample: data.slice(0, 8).map((r) => headers.map((_, i) => str(r[i]))), total_rows: data.filter((r) => r.some((c) => c != null && str(c) !== '')).length,
    mapping: autoMapping(headers)
  };
}

export interface ParsedRow { row: number; date: string | null; seq: number | null; number_text: string | null; counterparty: string; subject: string; notes: string; creator: string; year: number | null; skip?: boolean }

const isoOk = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monthOf = (v: unknown): number | null => {
  if (typeof v === 'number' && v >= 1 && v <= 12) return v;
  const s = norm(v); if (!s) return null; if (/^\d{1,2}$/.test(s)) { const n = Number(s); return n >= 1 && n <= 12 ? n : null; }
  if (/^\d{4}-\d{2}/.test(String(v))) return Number(String(v).slice(5, 7));
  return MONTHS[s.split(' ')[0]] ?? null;
};
/** Menerima ISO, dd/mm/yyyy, dd-mm-yyyy, "5 Januari 2026". */
function parseDateCell(v: unknown): { iso?: string; day?: number; bad?: boolean } {
  if (v == null || str(v) === '') return {};
  if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 31 ? { day: v } : { bad: true };
  const s = str(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); if (m) return isoOk(+m[1], +m[2], +m[3]) ? { iso: iso(+m[1], +m[2], +m[3]) } : { bad: true };
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s); if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return isoOk(y, +m[2], +m[1]) ? { iso: iso(y, +m[2], +m[1]) } : { bad: true }; }
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s); if (m) { const mo = MONTHS[m[2].toLowerCase()]; return mo && isoOk(+m[3], mo, +m[1]) ? { iso: iso(+m[3], mo, +m[1]) } : { bad: true }; }
  if (/^\d{1,2}$/.test(s)) return { day: Number(s) };
  return { bad: true };
}

/** Membaca baris data → nilai terstruktur + masalah per baris (belum menyentuh DB). */
export function parseRows(sheet: Sheet, reg: Register, headerRow: number, mapping: Partial<Record<ImportField, number>>, fallbackYear?: number | null): { rows: ParsedRow[]; issues: ImportRowIssue[]; blank: number } {
  const issues: ImportRowIssue[] = []; const rows: ParsedRow[] = []; let blank = 0;
  const get = (r: Array<string | number | null>, k: ImportField) => (mapping[k] != null ? r[mapping[k] as number] : null);
  const sheetYear = fallbackYear ?? (/(?:^|\D)(20\d{2})(?:\D|$)/.exec(sheet.name)?.[1] ? Number(/(?:^|\D)(20\d{2})(?:\D|$)/.exec(sheet.name)?.[1]) : null);
  sheet.rows.slice(headerRow).forEach((r, idx) => {
    const row = headerRow + idx + 1;
    if (!r.some((c) => c != null && str(c) !== '')) { blank++; return; }
    const err = (code: string, message: string) => issues.push({ row, level: 'error', code, message });
    const warn = (code: string, message: string) => issues.push({ row, level: 'warn', code, message });
    const rawNum = str(get(r, 'number')); const rawSeq = get(r, 'seq');
    let seq: number | null = null;
    if (rawSeq != null && str(rawSeq) !== '') { const n = Number(String(rawSeq).replace(/\.0+$/, '')); if (Number.isInteger(n) && n >= 1) seq = n; else err('BAD_SEQ', `Nomor urut "${str(rawSeq)}" tidak valid.`); }
    let number_text: string | null = rawNum ? normalizeNumberText(rawNum) : null;
    let numYear: number | null = null; let numMonth: number | null = null;
    if (number_text) {
      const p = parseNumber(reg, number_text);
      if (p) {
        if (seq != null && p.seq !== seq) err('SEQ_MISMATCH', `Nomor urut kolom (${seq}) berbeda dengan nomor pada "${number_text}" (${p.seq}).`);
        seq = seq ?? p.seq; numYear = p.year ?? null; numMonth = p.month ?? null;
      } else warn('FORMAT_MISMATCH', `Nomor "${number_text}" tidak sesuai format register saat ini; dicatat apa adanya.`);
    }
    // tanggal
    const d = parseDateCell(get(r, 'date')); const mo = monthOf(get(r, 'month'));
    let date: string | null = d.iso ?? null;
    if (d.bad) err('BAD_DATE', `Tanggal "${str(get(r, 'date'))}" tidak dapat dibaca.`);
    if (!date && !d.bad) {
      const month = mo ?? numMonth; const year = numYear ?? sheetYear;
      if (d.day != null && month && year) { if (isoOk(year, month, d.day)) date = iso(year, month, d.day); else err('BAD_DATE', `Tanggal ${d.day}/${month}/${year} tidak ada.`); }
      else if (d.day == null && month && year) { date = iso(year, month, 1); warn('DAY_MISSING', 'Tanggal tidak diisi; memakai tanggal 1 pada bulan tersebut.'); }
      else err('NO_DATE', `Tanggal/tahun tidak dapat ditentukan${year ? '' : ' (tahun tidak ada pada kolom tanggal, nomor, maupun nama lembar)'}.`);
    }
    const year = date ? Number(date.slice(0, 4)) : null;
    if (date && numYear != null && numYear !== year) err('DATE_MISMATCH', `Tahun pada nomor (${numYear}) berbeda dengan tanggal (${year}).`);
    if (date && mo != null && Number(date.slice(5, 7)) !== mo) warn('MONTH_MISMATCH', `Kolom bulan (${mo}) berbeda dengan bulan tanggal (${Number(date.slice(5, 7))}).`);
    if (!number_text) {
      if (seq != null && date) { number_text = renderNumber(reg, seq, date); warn('NUMBER_BUILT', `Nomor lengkap dibangun dari format register: ${number_text}`); }
      else err('NO_NUMBER', 'Nomor tidak ditemukan (isi kolom nomor lengkap atau nomor urut).');
    }
    if (seq == null && number_text) err('NO_SEQ', 'Nomor urut tidak dapat ditentukan dari baris ini.');
    rows.push({ row, date, seq, number_text, counterparty: str(get(r, 'counterparty')).slice(0, 300), subject: str(get(r, 'subject')).slice(0, 500), notes: str(get(r, 'notes')).slice(0, 1000), creator: str(get(r, 'creator')).slice(0, 120), year });
  });
  return { rows, issues, blank };
}

/** Klasifikasi baris: nomor berformat harian (DD cocok dengan tanggal, urut 1..batas) menentukan urutan; selain itu dipertahankan apa adanya (legacy). */
function classify(reg: Register, r: ParsedRow): { scheme: 'daily' | 'legacy'; seq: number | null; legacy: number | null; why?: string } {
  const limit = maxSeqFor(reg.seq_length);
  const p = r.number_text ? parseNumber(reg, r.number_text) : null;
  const dayOk = p != null && r.date != null && p.day === Number(r.date.slice(8, 10)) && p.seq >= 1 && p.seq <= limit;
  if (p && dayOk) return { scheme: 'daily', seq: p.seq, legacy: null };
  const why = p && p.day != null && r.date && p.day !== Number(r.date.slice(8, 10)) ? `Hari pada nomor (${String(p.day).padStart(2, '0')}) berbeda dengan hari tanggal dokumen (${r.date.slice(8, 10)}); dicatat sebagai nomor lama.` : undefined;
  return { scheme: 'legacy', seq: null, legacy: r.seq, why };
}

/** Analisis lengkap: duplikat (dalam berkas & terhadap DB), celah per tanggal, nomor lama vs harian. Tidak menganggap baris terakhir sebagai urutan terbaru. */
export function analyzeImport(db: DB, reg: Register, parsed: { rows: ParsedRow[]; issues: ImportRowIssue[]; blank: number }, skipDuplicates: boolean): { report: ImportReport; accepted: Array<ParsedRow & { scheme: 'daily' | 'legacy'; dseq: number | null; legacy: number | null }> } {
  const errors = parsed.issues.filter((i) => i.level === 'error'); const warnings = parsed.issues.filter((i) => i.level === 'warn');
  const badRows = new Set(errors.map((e) => e.row));
  const dups: ImportReport['duplicates'] = []; const seenText = new Map<string, number>(); const seenKey = new Map<string, number>();
  const existText = new Set((db.prepare('SELECT number_date d, number_text t FROM number_records WHERE register_id=?').all(reg.id) as { d: string; t: string }[]).map((r) => `${r.d}|${r.t.toLowerCase()}`));
  const existKey = new Set((db.prepare("SELECT number_date d, seq FROM number_records WHERE register_id=? AND seq IS NOT NULL").all(reg.id) as { d: string; seq: number }[]).map((r) => `${r.d}|${r.seq}`));
  // Nomor lama (bukan DDSS) unik secara keseluruhan (teks nomor) dan menurut tahun + urut lama.
  const existLegacyText = new Set((db.prepare("SELECT number_text t FROM number_records WHERE register_id=? AND seq_scheme='legacy'").all(reg.id) as { t: string }[]).map((r) => r.t.toLowerCase()));
  const existLegacyKey = new Set((db.prepare("SELECT year, legacy_seq q FROM number_records WHERE register_id=? AND seq_scheme='legacy' AND legacy_seq IS NOT NULL").all(reg.id) as { year: number; q: number }[]).map((r) => `${r.year}|${r.q}`));
  const seenLegacyText = new Map<string, number>(); const seenLegacyKey = new Map<string, number>();
  const accepted: Array<ParsedRow & { scheme: 'daily' | 'legacy'; dseq: number | null; legacy: number | null }> = [];
  const limit = maxSeqFor(reg.seq_length);
  for (const r of parsed.rows) {
    if (badRows.has(r.row) || !r.number_text || !r.date) continue;
    const c = classify(reg, r);
    if (c.why) warnings.push({ row: r.row, level: 'warn', code: 'DAY_MISMATCH', message: c.why });
    if (c.scheme === 'legacy' && r.seq != null && r.seq > limit && !parseNumber(reg, r.number_text)) warnings.push({ row: r.row, level: 'warn', code: 'LEGACY_FORMAT', message: `Nomor "${r.number_text}" tidak berformat harian; dicatat apa adanya dan tidak memengaruhi urutan harian.` });
    const tk = `${r.date}|${r.number_text.toLowerCase()}`; const kk = c.seq != null ? `${r.date}|${c.seq}` : null;
    let reason = '';
    if (seenText.has(tk)) reason = `Nomor sama pada tanggal yang sama dengan baris ${seenText.get(tk)} pada berkas.`;
    else if (kk && seenKey.has(kk)) reason = `Nomor urut ${c.seq} tanggal ${r.date} sama dengan baris ${seenKey.get(kk)} pada berkas.`;
    else if (existText.has(tk)) reason = 'Nomor sudah ada di register pada tanggal tersebut.';
    else if (kk && existKey.has(kk)) reason = `Nomor urut ${c.seq} tanggal ${r.date} sudah ada di register.`;
    const lk = c.scheme === 'legacy' && c.legacy != null && r.year != null ? `${r.year}|${c.legacy}` : null;
    if (!reason && c.scheme === 'legacy') {
      const lt = r.number_text.toLowerCase();
      if (seenLegacyText.has(lt)) reason = `Nomor lama sama dengan baris ${seenLegacyText.get(lt)} pada berkas.`;
      else if (lk && seenLegacyKey.has(lk)) reason = `Nomor urut lama ${c.legacy} tahun ${r.year} sama dengan baris ${seenLegacyKey.get(lk)} pada berkas.`;
      else if (existLegacyText.has(lt)) reason = 'Nomor lama sudah ada di register.';
      else if (lk && existLegacyKey.has(lk)) reason = `Nomor urut lama ${c.legacy} tahun ${r.year} sudah ada di register.`;
    }
    if (reason) { dups.push({ row: r.row, number_text: r.number_text, reason }); if (!skipDuplicates) errors.push({ row: r.row, level: 'error', code: 'DUPLICATE', message: reason }); continue; }
    seenText.set(tk, r.row); if (kk) seenKey.set(kk, r.row);
    if (c.scheme === 'legacy') { seenLegacyText.set(r.number_text.toLowerCase(), r.row); if (lk) seenLegacyKey.set(lk, r.row); }
    accepted.push({ ...r, scheme: c.scheme, dseq: c.seq, legacy: c.legacy });
  }
  const byYear = new Map<number, number>();
  for (const r of accepted) if (r.year != null) byYear.set(r.year, (byYear.get(r.year) ?? 0) + 1);
  const years = [...byYear].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count }));
  const byDate = new Map<string, number[]>();
  for (const r of accepted) if (r.scheme === 'daily' && r.date) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.dseq as number]);
  const days: ImportReport['days'] = [];
  for (const [date, seqs] of byDate) {
    const dbSeqs = (db.prepare("SELECT seq FROM number_records WHERE register_id=? AND number_date=? AND seq IS NOT NULL").all(reg.id, date) as { seq: number }[]).map((x) => x.seq);
    const all = new Set([...seqs, ...dbSeqs]); const mx = Math.max(...all);
    const gaps: number[] = []; for (let q = reg.initial_sequence; q < mx && gaps.length < 500; q++) if (!all.has(q)) gaps.push(q);
    days.push({ date, count: seqs.length, max_seq: mx, gaps, gap_count: gaps.length, suggested_next: Math.max(mx + 1, reg.initial_sequence), db_count: dbSeqs.length });
  }
  days.sort((a, b) => b.gap_count - a.gap_count || (a.date < b.date ? -1 : 1));
  const dailyRows = accepted.filter((r) => r.scheme === 'daily').length;
  const report: ImportReport = {
    total_rows: parsed.rows.length + parsed.blank, valid_rows: accepted.length, skipped_blank: parsed.blank, errors, warnings, duplicates: dups,
    daily_rows: dailyRows, legacy_rows: accepted.length - dailyRows, years, days: days.slice(0, 400), days_total: days.length,
    requires_confirmation: days.some((d) => d.gap_count > 0), ok: errors.length === 0 && accepted.length > 0
  };
  return { report, accepted };
}

export function loadImport(db: DB, buf: Buffer, input: Pick<ImportCommitInput, 'register_id' | 'sheet' | 'header_row' | 'mapping' | 'skip_duplicates'>) {
  const reg = getRegister(db, input.register_id);
  let sheets: Sheet[]; try { sheets = readXlsx(buf); } catch (e) { throw new NumberingError('INVALID', (e as Error).message); }
  const sheet = pickSheet(sheets, input.sheet);
  if (input.mapping.seq == null && input.mapping.number == null) throw new NumberingError('INVALID', 'Petakan minimal kolom Nomor urut atau Nomor lengkap.');
  const parsed = parseRows(sheet, reg, input.header_row, input.mapping);
  return { reg, ...analyzeImport(db, reg, parsed, input.skip_duplicates) };
}

/** Pratinjau + laporan validasi tanpa menulis ke DB. */
export function validateImport(db: DB, buf: Buffer, input: Pick<ImportCommitInput, 'register_id' | 'sheet' | 'header_row' | 'mapping' | 'skip_duplicates'>): ImportReport {
  return loadImport(db, buf, input).report;
}

/** Menulis semua baris dalam satu transaksi; bila apa pun gagal seluruhnya dibatalkan (rollback) dan kegagalan dicatat. */
export function commitImport(db: DB, actor: Actor, buf: Buffer, input: ImportCommitInput, hooks: { afterRow?: (n: number) => void } = {}): ImportResult {
  requireAdmin(actor);
  const { reg, report, accepted } = loadImport(db, buf, input);
  const sha = createHash('sha256').update(buf).digest('hex');
  const importId = randomUUID();
  const fail = (msg: string, code: 'INVALID' | 'NEEDS_CONFIRMATION' | 'COLLISION' = 'INVALID'): never => {
    db.prepare(`INSERT INTO number_imports (id, register_id, filename, sheet, file_sha256, status, total_rows, imported_rows, skipped_rows, report_json, mapping_json, created_by, created_by_name, created_at) VALUES (?,?,?,?,?,'failed',?,0,?,?,?,?,?,?)`)
      .run(importId, reg.id, input.file_name, input.sheet, sha, report.total_rows, report.total_rows, JSON.stringify({ ...report, failure: msg }), JSON.stringify(input.mapping), actor.id, actor.name, nowIso());
    audit(db, actor, 'import.failed', 'register', reg.id, { file: input.file_name, reason: msg });
    throw new NumberingError(code, msg);
  };
  if (!report.ok) fail(report.errors.length ? `Impor dibatalkan: ${report.errors.length} kesalahan pada berkas (lihat laporan validasi).` : 'Impor dibatalkan: tidak ada baris valid.');
  const gaps = report.days.some((d) => d.gap_count > 0);
  if (gaps && !input.confirm_gaps) fail('Terdapat celah nomor urut pada tanggal tertentu; konfirmasi administrator diperlukan.', 'NEEDS_CONFIRMATION');
  const dupSha = db.prepare("SELECT 1 FROM number_imports WHERE register_id=? AND file_sha256=? AND status='committed'").get(reg.id, sha);
  const run = db.transaction(() => {
    const ts = nowIso();
    db.prepare(`INSERT INTO number_imports (id, register_id, filename, sheet, file_sha256, status, total_rows, imported_rows, skipped_rows, report_json, mapping_json, created_by, created_by_name, created_at) VALUES (?,?,?,?,?,'committed',?,?,?,?,?,?,?,?)`)
      .run(importId, reg.id, input.file_name, input.sheet, sha, report.total_rows, accepted.length, report.total_rows - accepted.length, JSON.stringify(report), JSON.stringify(input.mapping), actor.id, actor.name, ts);
    const ins = db.prepare(`INSERT INTO number_records (id, register_id, year, day, seq, seq_scheme, legacy_seq, number_text, status, number_date, subject, counterparty, notes, creator, creator_id, source, import_id, issued_at, issued_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,'issued',?,?,?,?,?,?, 'import', ?, ?,?,?,?)`);
    const ev = db.prepare('INSERT INTO number_events (id, record_id, register_id, event, actor_id, actor_name, at, detail_json) VALUES (?,?,?,?,?,?,?,?)');
    let n = 0;
    for (const r of accepted) {
      const id = randomUUID();
      ins.run(id, reg.id, r.year, (r.date as string).slice(8, 10), r.dseq, r.scheme, r.legacy, r.number_text, r.date, r.subject, r.counterparty, r.notes, r.creator || actor.name, actor.id, importId, `${r.date}T00:00:00.000Z`, r.creator || actor.name, ts, ts);
      ev.run(randomUUID(), id, reg.id, 'imported', actor.id, actor.name, ts, JSON.stringify({ import_id: importId, row: r.row, file: input.file_name }));
      hooks.afterRow?.(++n);
    }
    for (const d of report.days) bumpCounter(db, reg.id, d.date, d.suggested_next);
    audit(db, actor, 'import.committed', 'register', reg.id, { import_id: importId, file: input.file_name, imported: accepted.length, years: report.years.map((y) => y.year), daily: report.daily_rows, legacy: report.legacy_rows, days: report.days_total, gaps_confirmed: gaps });
  });
  try { run(); } catch (e) {
    if (e instanceof NumberingError) throw e;
    // Transaksi sudah di-rollback; catat kegagalan di luar transaksi.
    return fail(`Impor dibatalkan dan seluruh perubahan dikembalikan: ${(e as Error).message}`);
  }
  if (dupSha) report.warnings.push({ row: 0, level: 'warn', code: 'FILE_REIMPORT', message: 'Berkas yang identik pernah diimpor sebelumnya (baris yang sama dilewati sebagai duplikat).' });
  return { import_id: importId, imported: accepted.length, skipped: report.total_rows - accepted.length, report, days_updated: report.days_total };
}

export function listImports(db: DB, registerId?: string) {
  return (db.prepare(`SELECT id, register_id, filename, sheet, status, total_rows, imported_rows, skipped_rows, created_by_name, created_at FROM number_imports ${registerId ? 'WHERE register_id=?' : ''} ORDER BY created_at DESC LIMIT 200`).all(...(registerId ? [registerId] : [])) as any[]);
}
export { bumpCounter };
