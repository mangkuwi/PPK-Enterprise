/** Penomoran dokumen & register: tipe bersama dan fungsi murni (format, parse, validasi). Tanpa akses DB/Electron. */

export const REGISTER_CODES = ['SURAT_KELUAR', 'NOTA_DINAS', 'BERITA_ACARA', 'KONTRAK'] as const;
export type RegisterCode = (typeof REGISTER_CODES)[number];
/** Bank nomor: AVAILABLE → ASSIGNED (dipilih untuk draf) → ISSUED (dokumen final). VOID hanya oleh administrator. */
export type NumberStatus = 'available' | 'assigned' | 'issued' | 'void';
export type Role = 'admin' | 'operator';
export type RecordSource = 'app' | 'manual' | 'import';

export interface Actor { id: string; name: string; role: Role }
export interface AppUser { id: string; name: string; role: Role; has_pin: boolean; is_active: boolean }

export interface Register {
  id: string; code: RegisterCode; name: string; format: string; prefix: string; suffix: string;
  seq_length: number; initial_sequence: number; ttl_hours: number;
  /** kunci placeholder yang diisi nomor register ini; yang pertama = kunci utama (dipakai sebagai rujukan oleh register lain) */
  placeholder_keys: string[]; is_active: boolean; sort_order: number; updated_at: string;
}

export interface NumberRecord {
  id: string; register_id: string; register_code: RegisterCode; year: number;
  /** nomor urut untuk tampilan: urut harian (SS) bila skema 'daily', urut tahunan lama bila 'legacy' */ seq: number | null;
  /** DD — dua digit tanggal dokumen */ day: string; seq_scheme: 'daily' | 'legacy'; number_text: string; status: NumberStatus;
  number_date: string; subject: string; counterparty: string; notes: string; creator: string; creator_id: string | null;
  document_id: string | null; document_title: string | null; source: RecordSource; import_id: string | null;
  batch_id: string | null; generated_at: string | null; generated_by: string | null;
  assigned_at: string | null; assigned_by: string | null; issued_at: string | null; issued_by: string | null;
  voided_at: string | null; voided_by: string | null; void_reason: string | null;
  /** catatan hasil migrasi yang belum ditinjau administrator: tidak ditawarkan pada pemilih nomor */ legacy_review: boolean;
  /** berapa kali nomor ini pernah dilepas dari draf sebelumnya */ released_count: number;
  created_at: string; updated_at: string;
}
export interface NumberEvent { id: string; record_id: string; register_id: string; event: string; actor_id: string | null; actor_name: string; at: string; detail: Record<string, unknown> }

export interface RecordQuery {
  register_id: string; search?: string; date_from?: string; date_to?: string; year?: number; subject?: string; counterparty?: string; creator?: string;
  status?: NumberStatus; batch_id?: string; date?: string; sort?: 'number_date' | 'seq' | 'number_text' | 'subject' | 'counterparty' | 'creator' | 'status' | 'created_at';
  dir?: 'asc' | 'desc'; page?: number; page_size?: number;
}
export interface RecordPage { rows: NumberRecord[]; total: number; page: number; page_size: number }

export interface RegisterSummary {
  register: Register; total: number; available: number; assigned: number; issued: number; void: number; review: number;
  year: number; year_total: number; year_last_number: string | null; next_date: string; next_number: string | null; next_full: boolean; needs_confirmation: boolean;
}

/** Informasi urutan harian untuk (register, tanggal dokumen). */
export interface NextInfo {
  date: string; year: number; max_seq: number | null; configured_start: number; counter_next: number | null; suggested: number;
  /** batas atas nomor urut per tanggal (99 untuk 2 digit) dan sisa kapasitas */ limit: number; remaining: number; full: boolean;
  gaps: number[]; gap_count: number; conflicts: string[]; has_imported: boolean; requires_confirmation: boolean; preview: string | null; format_label: string;
}

/** Pratinjau pembuatan nomor massal (belum tersimpan). */
export interface BatchPreview {
  register_id: string; date: string; quantity: number; numbers: string[]; first: string; last: string;
  first_seq: number; last_seq: number; limit: number; remaining: number; format_label: string; max_quantity: number;
}
export interface NumberBatch { id: string; register_id: string; number_date: string; quantity: number; first_number: string; last_number: string; created_by_name: string; created_at: string; note: string }
/** Hasil pemetaan migrasi ke bank nomor, untuk tinjauan administrator. */
export interface MigrationReview {
  counts: { issued: number; void: number; assigned_with_document: number; pending_review: number };
  pending: NumberRecord[];
}
export interface AvailableQuery { register_id: string; search?: string; date?: string; date_from?: string; include_all?: boolean; limit?: number }

export interface ConfigHistoryRow { id: string; register_id: string; changed_at: string; changed_by_name: string; old: Partial<Register>; next: Partial<Register>; reason: string }
export interface AuditRow { id: string; at: string; actor_name: string; action: string; entity: string; entity_id: string | null; detail: Record<string, unknown> }

// ---------- format ----------
export const FORMAT_TOKENS = ['SEQUENCE', 'MONTH', 'MONTH2', 'ROMAN', 'YEAR', 'YY', 'DAY', 'DAY2'] as const;
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export interface FormatSpec { format: string; prefix: string; suffix: string; seq_length: number }

export function validateFormat(s: FormatSpec): string | null {
  const full = `${s.prefix}${s.format}${s.suffix}`;
  if (!s.format.trim()) return 'Format nomor wajib diisi.';
  if (full.length > 200) return 'Format nomor terlalu panjang (maks. 200 karakter).';
  const toks = [...full.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const bad = toks.find((t) => !(FORMAT_TOKENS as readonly string[]).includes(t));
  if (bad !== undefined) return `Variabel {${bad}} tidak dikenal. Yang tersedia: ${FORMAT_TOKENS.map((t) => `{${t}}`).join(', ')}.`;
  if (toks.filter((t) => t === 'SEQUENCE').length !== 1) return 'Format harus memuat {SEQUENCE} tepat satu kali.';
  if (/[{}]/.test(full.replace(/\{[A-Z0-9]+\}/g, ''))) return 'Tanda kurung kurawal tidak seimbang.';
  if (!Number.isInteger(s.seq_length) || s.seq_length < 1 || s.seq_length > 10) return 'Panjang nomor urut harus 1–10 digit (2 digit = 01–99 per tanggal).';
  if (/\{DAY\}\{SEQUENCE\}/.test(full)) return 'Gunakan {DAY2} (dua digit) bila tanggal berdampingan dengan {SEQUENCE}; {DAY} tidak berpanjang tetap.';
  return null;
}

export const isoParts = (iso: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso); return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null; };
export const yearOf = (iso: string): number | null => isoParts(iso)?.y ?? null;
/** Batas nomor urut per kategori per tanggal menurut panjang urut (2 digit → 99). */
export const maxSeqFor = (seqLength: number) => 10 ** seqLength - 1;
/** Label ringkas format: DDSS bila {DAY2}{SEQUENCE} dengan urut 2 digit. */
export function formatLabel(s: FormatSpec): string {
  const full = `${s.prefix}${s.format}${s.suffix}`;
  const L = Math.max(1, s.seq_length);
  return full.replace(/\{DAY2\}/g, 'DD').replace(/\{DAY\}/g, 'D').replace(/\{SEQUENCE\}/g, 'S'.repeat(L)).replace(/\{MONTH2\}/g, 'MM').replace(/\{MONTH\}/g, 'M').replace(/\{ROMAN\}/g, 'RR').replace(/\{YEAR\}/g, 'YYYY').replace(/\{YY\}/g, 'YY');
}
export const formatUsesMonth = (s: FormatSpec) => /\{(MONTH|MONTH2|ROMAN)\}/.test(`${s.prefix}${s.format}${s.suffix}`);

export function renderNumber(s: FormatSpec, seq: number, iso: string): string {
  const p = isoParts(iso);
  if (!p) throw new Error('Tanggal penomoran tidak valid.');
  const seqText = s.seq_length > 0 ? String(seq).padStart(s.seq_length, '0') : String(seq);
  const map: Record<string, string> = {
    SEQUENCE: seqText, MONTH: String(p.m), MONTH2: String(p.m).padStart(2, '0'), ROMAN: ROMAN[p.m - 1], YEAR: String(p.y), YY: String(p.y).slice(-2), DAY: String(p.d), DAY2: String(p.d).padStart(2, '0')
  };
  return `${s.prefix}${s.format}${s.suffix}`.replace(/\{([A-Z0-9]+)\}/g, (_, k: string) => map[k] ?? `{${k}}`);
}

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
/** Ambil nomor urut (dan tahun/bulan bila ada di format) dari nomor lengkap berdasarkan format register. Null = tidak cocok format. */
export function parseNumber(s: FormatSpec, text: string): { seq: number; year?: number; month?: number; day?: number } | null {
  const full = `${s.prefix}${s.format}${s.suffix}`;
  const names: string[] = [];
  let re = '';
  let last = 0;
  for (const m of full.matchAll(/\{([A-Z0-9]+)\}/g)) {
    re += esc(full.slice(last, m.index));
    last = (m.index as number) + m[0].length;
    const k = m[1]; names.push(k);
    re += k === 'SEQUENCE' ? (s.seq_length > 0 ? `(\\d{${s.seq_length},})` : '(\\d+)') : k === 'DAY2' ? '(\\d{2})' : k === 'MONTH' ? '(\\d{1,2})' : k === 'MONTH2' ? '(\\d{2})' : k === 'ROMAN' ? '(I{1,3}|IV|VI{0,3}|IX|XI{0,2}|X)' : k === 'YEAR' ? '(\\d{4})' : k === 'YY' ? '(\\d{2})' : '(\\d{1,2})';
  }
  re += esc(full.slice(last));
  const mm = new RegExp(`^\\s*${re.replace(/\s+/g, '\\s*')}\\s*$`, 'i').exec(text);
  if (!mm) return null;
  const out: { seq: number; year?: number; month?: number; day?: number } = { seq: Number(mm[names.indexOf('SEQUENCE') + 1]) };
  if (names.includes('DAY2')) out.day = Number(mm[names.indexOf('DAY2') + 1]);
  else if (names.includes('DAY')) out.day = Number(mm[names.indexOf('DAY') + 1]);
  const gi = (k: string) => names.indexOf(k);
  if (gi('YEAR') >= 0) out.year = Number(mm[gi('YEAR') + 1]);
  else if (gi('YY') >= 0) out.year = 2000 + Number(mm[gi('YY') + 1]);
  if (gi('MONTH') >= 0) out.month = Number(mm[gi('MONTH') + 1]);
  else if (gi('MONTH2') >= 0) out.month = Number(mm[gi('MONTH2') + 1]);
  else if (gi('ROMAN') >= 0) out.month = ROMAN.indexOf(mm[gi('ROMAN') + 1].toUpperCase()) + 1;
  return out;
}

export const normalizeNumberText = (t: string) => t.replace(/\s+/g, ' ').trim();

export const STATUS_LABEL: Record<NumberStatus, string> = { available: 'Tersedia', assigned: 'Dipakai draf', issued: 'Terbit', void: 'Void' };
export const STATUS_TONE: Record<NumberStatus, 'green' | 'amber' | 'red' | 'navy'> = { available: 'navy', assigned: 'amber', issued: 'green', void: 'red' };
export const REGISTER_LABEL: Record<RegisterCode, string> = { SURAT_KELUAR: 'Surat Keluar', NOTA_DINAS: 'Nota Dinas', BERITA_ACARA: 'Berita Acara', KONTRAK: 'Kontrak' };
export const REGISTER_PATH: Record<RegisterCode, string> = { SURAT_KELUAR: 'surat-keluar', NOTA_DINAS: 'nota-dinas', BERITA_ACARA: 'berita-acara', KONTRAK: 'kontrak' };

/** Kolom register (urutan impor/ekspor). */
export const RECORD_COLUMNS = ['TGL', 'BULAN', 'NOMOR', 'NOMOR LENGKAP', 'PIHAK', 'PERIHAL', 'KETERANGAN', 'PEMBUAT', 'STATUS'] as const;

// ---------- impor Excel ----------
export type ImportField = 'date' | 'month' | 'seq' | 'number' | 'counterparty' | 'subject' | 'notes' | 'creator';
export const IMPORT_FIELDS: Array<{ key: ImportField; label: string; aliases: string[] }> = [
  { key: 'date', label: 'Tanggal (TGL)', aliases: ['tgl', 'tanggal', 'date', 'tgl surat', 'tanggal surat'] },
  { key: 'month', label: 'Bulan', aliases: ['bulan', 'month'] },
  { key: 'seq', label: 'Nomor urut (NOMOR)', aliases: ['nomor', 'no', 'no urut', 'nomor urut', 'urut'] },
  { key: 'number', label: 'Nomor lengkap (NOMOR BA / NOMOR SURAT)', aliases: ['nomor ba', 'nomor surat', 'nomor nd', 'nomor nota dinas', 'nomor kontrak', 'nomor lengkap', 'no surat', 'no ba', 'no kontrak'] },
  { key: 'counterparty', label: 'Pihak', aliases: ['pihak', 'tujuan', 'kepada', 'counterparty', 'penyedia', 'mitra'] },
  { key: 'subject', label: 'Perihal', aliases: ['perihal', 'hal', 'subject', 'uraian'] },
  { key: 'notes', label: 'Keterangan', aliases: ['keterangan', 'ket', 'catatan', 'notes'] },
  { key: 'creator', label: 'Pembuat', aliases: ['pembuat', 'dibuat oleh', 'petugas', 'creator', 'operator'] }
];

export interface ImportRowIssue { row: number; level: 'error' | 'warn'; code: string; message: string }
export interface ImportPreview {
  sheets: string[]; sheet: string; header_row: number; headers: string[]; sample: string[][]; total_rows: number;
  mapping: Partial<Record<ImportField, number>>;
}
export interface ImportDayStat { date: string; count: number; max_seq: number | null; gaps: number[]; gap_count: number; suggested_next: number; db_count: number }
export interface ImportReport {
  total_rows: number; valid_rows: number; skipped_blank: number; errors: ImportRowIssue[]; warnings: ImportRowIssue[];
  duplicates: Array<{ row: number; number_text: string; reason: string }>;
  /** baris bernomor format harian (DDSS) yang menentukan urutan harian; sisanya bernomor lama dan dipertahankan apa adanya */
  daily_rows: number; legacy_rows: number;
  years: Array<{ year: number; count: number }>;
  /** tanggal yang memiliki nomor harian; diurutkan: yang bermasalah (celah) lebih dulu, maksimum 400 */
  days: ImportDayStat[]; days_total: number;
  requires_confirmation: boolean; ok: boolean;
}
export interface ImportCommitInput {
  register_id: string; sheet: string; header_row: number; mapping: Partial<Record<ImportField, number>>;
  confirm_gaps: boolean; skip_duplicates: boolean; file_name: string;
}
export interface ImportResult { import_id: string; imported: number; skipped: number; report: ImportReport; days_updated: number }

// ---------- integrasi dokumen ----------
export interface NumberingContext {
  register: Register | null;
  /** kunci isian yang diisi otomatis dengan nomor register ini (hanya yang ada di template) */
  own_keys: string[]; date_key: string | null; party_key: string | null;
  /** kolom rujukan ke nomor register lain yang sudah terbit (mis. NOMOR_KONTRAK di BA) */
  ref_fields: Array<{ key: string; register_id: string; register_name: string }>;
}
export interface NumberRef { key: string; record_id: string }
export interface ReserveResult { record: NumberRecord; context: NumberingContext }
export interface DocNumbering { number_text: string; in_content: boolean }
export interface CategoryMapRow { category_id: string; category_name: string; register_id: string | null }
export interface TemplateMapRow { id: string; name: string; category_name: string | null; register_id: string | null }
export interface ImportRecordRow { id: string; register_id: string; filename: string; sheet: string; status: 'committed' | 'failed'; total_rows: number; imported_rows: number; skipped_rows: number; created_by_name: string; created_at: string }
