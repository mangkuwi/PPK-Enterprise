import type { FieldType } from './types';

/** Tipe & fungsi murni untuk Smart Template Importer (dipakai main, renderer, dan test). */
export type MappingStatus = 'auto' | 'confirm' | 'confirmed' | 'manual' | 'rejected';
export type Classification = 'static' | 'dynamic' | 'conditional' | 'uncertain';
export type ImportStatus = 'analyzed' | 'reviewed' | 'saved' | 'error';

export const AUTO_THRESHOLD = 0.75;

export interface MappingRec {
  id: string;
  part: string;
  para_index: number;
  start: number;
  end: number;
  source_text: string;
  placeholder_name: string;
  label: string;
  field_type: FieldType;
  default_value: string;
  required: boolean;
  options: string[];
  confidence: number;
  status: MappingStatus;
  reason: string;
}

export interface GroupColumn { key: string; label: string; tc: number; type: FieldType; auto_number?: boolean }
export interface GroupRec {
  id: string;
  name: string; // contoh: PEGAWAI
  label: string;
  part: string;
  tbl: number;
  header_tr: number;
  rows: number[]; // indeks <w:tr> baris data (baris pertama = baris contoh)
  columns: GroupColumn[];
  default_rows: Array<Record<string, string>>;
  confidence: number;
  status: MappingStatus;
  reason: string;
}

export interface ParaView {
  key: string; // `${part}#${index}`
  part: string;
  part_label: string;
  index: number;
  text: string;
  table?: { tbl: number; tr: number; tc: number };
  align?: string;
  bold?: boolean;
  underline?: boolean;
  size?: number;
  is_list: boolean;
  has_field: boolean;
  has_drawing: boolean;
  static_reason?: string; // alasan statis (kop, judul, penutup, ...)
}

export interface DocInfo {
  page: { width_mm: number; height_mm: number; margin_top: number; margin_right: number; margin_bottom: number; margin_left: number };
  fonts: Array<{ name: string; count: number }>;
  images: Array<{ path: string; bytes: number }>;
  headers: number; footers: number; tables: number; paragraphs: number; section_breaks: number; page_breaks: number;
  textboxes: number; fields: number; tracked_changes: number; numbered_paragraphs: number; comments: boolean; has_kop: boolean;
}

export interface Warning { code: string; level: 'info' | 'warn'; message: string }

export interface AnalysisResult {
  doc: DocInfo;
  paras: ParaView[];
  mappings: MappingRec[];
  groups: GroupRec[];
  warnings: Warning[];
  suggested_name: string;
  suggested_category_code: string;
}

export const paraKey = (part: string, index: number) => `${part}#${index}`;

const MONTHS = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
const MONTH_ALIASES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, agu: 8, agt: 8, ags: 8, sep: 9, sept: 9, okt: 10, nov: 11, des: 12
};
export const MONTH_RE = '(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Jun|Jul|Agu|Agt|Ags|Sept|Sep|Okt|Nov|Des)\\.?';
export const DATE_RE = `\\d{1,2}\\s+${MONTH_RE}\\s+\\d{4}`;

/** '23 November 2026' → '2026-11-23'; selain itu null. */
export function parseIndoDate(s: string): string | null {
  const m = new RegExp(`^\\s*(\\d{1,2})\\s+([A-Za-z]+)\\.?\\s+(\\d{4})\\s*$`).exec(s);
  if (!m) return null;
  const name = m[2].toLowerCase();
  let month = MONTHS.indexOf(name) + 1;
  if (!month) month = MONTH_ALIASES[name] ?? 0;
  const d = Number(m[1]);
  if (!month || d < 1 || d > 31) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Nama placeholder dari teks bebas: huruf kapital, angka, garis bawah. */
export function snakeName(s: string, max = 40): string {
  const t = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const n = t.slice(0, max).replace(/_+$/, '');
  return /^[A-Z]/.test(n) ? n : n ? `F_${n}` : '';
}

export const isApplied = (m: MappingRec) => m.status === 'auto' || m.status === 'confirmed' || m.status === 'manual';

/** Klasifikasi paragraf berdasarkan pemetaan yang berlaku saat ini. */
export function classifyPara(key: string, mappings: MappingRec[], groups: GroupRec[] = []): Classification {
  const [part, idx] = [key.slice(0, key.lastIndexOf('#')), Number(key.slice(key.lastIndexOf('#') + 1))];
  const ms = mappings.filter((m) => m.part === part && m.para_index === idx && m.status !== 'rejected');
  if (ms.some((m) => m.status === 'confirm')) return 'uncertain';
  const applied = ms.filter(isApplied);
  if (applied.some((m) => !m.required)) return 'conditional';
  if (applied.length) return 'dynamic';
  void groups;
  return 'static';
}

export const KEY_RE = /^[A-Z][A-Z0-9_]*$/;
export const fieldKeyOk = (k: string) => KEY_RE.test(k) && k.length <= 60;

// ---------- tipe API (IPC) ----------
export interface ImportSummary {
  id: string; original_filename: string; template_id: string | null; template_name: string; category_id: string | null;
  import_status: ImportStatus; mapping_count: number; auto_count: number; confirm_count: number;
  created_at: string; updated_at: string; sha256: string; size: number; variant_count: number;
}
export interface ImportReview {
  summary: ImportSummary; analysis: AnalysisResult; name: string; description: string; protected_keys: string[]; versions: TemplateVersion[];
  variant_groups: VariantGroup[]; variant_map: Record<string, VariantParaInfo>; inherited_count: number;
}
export interface ImportSaveInput {
  id: string; mappings: MappingRec[]; groups: GroupRec[]; name: string; description: string; category_id: string | null; protected_keys: string[];
  /** Keputusan pengguna atas kelompok varian: status dan nama varian. */
  variant_edits?: Array<{ group_no: number; status?: VariantStatus; labels?: Record<string, string> }>;
}

// ---------- varian template ----------
export type VariantStatus = 'auto' | 'confirm' | 'confirmed' | 'rejected';
export type VariantDiffKind = 'table_cell' | 'table_structure' | 'paragraph' | 'format' | 'only_in_variant' | 'only_in_master';
export interface VariantDiff { kind: VariantDiffKind; where: string; master: string; variant: string; /** true = hanya nilai isian bersama yang berbeda (bukan wilayah khusus varian) */ shared: boolean }
export interface VariantItem {
  id: string; letter: string; label: string; seg_index: number; block_first: number; block_last: number; para_first: number; para_last: number;
  summary: string; diffs: VariantDiff[];
  /** pasangan indeks paragraf [master, varian] yang sejajar; dipakai untuk mewarisi pemetaan */
  align: Array<[number, number]>;
}
export interface VariantGroup {
  group_no: number; status: VariantStatus; kind: string; kind_label: string; field_key: string; selectable: boolean;
  similarity: number; reason: string; notes: string[]; variants: VariantItem[];
}
export interface VariantParaInfo { variant_id: string; letter: string; label: string; /** kunci paragraf master tempat pemetaan diwarisi; kosong = wilayah khusus varian */ inherits?: string }
export const variantApplied = (g: Pick<VariantGroup, 'status' | 'selectable'>) => g.selectable && (g.status === 'auto' || g.status === 'confirmed');
export interface TemplateVersion { id: string; version_no: number; note: string; created_at: string; mapping_count: number; current: boolean }
export interface CompareParaDiff { part: string; index: number; before: string; after: string }
export interface CompareView {
  original_paras: ParaView[];
  report: { identical_entries: number; changed_entries: string[]; format_preserved: boolean; notes: Warning[]; parts: Array<{ label: string; paragraphs: [number, number]; tables: [number, number]; rows: [number, number]; drawings: [number, number]; signature_equal: boolean }> };
  adapted_diff: CompareParaDiff[];
  generated_diff: CompareParaDiff[];
  adapted_tokens: string[];
  skipped: Array<{ id: string; reason: string }>;
  unmapped: string[];
}
export interface DocxGroupDef { name: string; label: string; columns: Array<{ key: string; label: string; auto_number?: boolean }>; default_rows: Array<Record<string, string>> }
export interface DocxVariantChoice { group_no: number; field_key: string; label: string; options: Array<{ id: string; label: string; summary: string }>; default_label: string }
export interface DocxTemplateInfo {
  template_id: string; import_id: string; groups: DocxGroupDef[];
  variants: DocxVariantChoice[];
  /** isian yang hanya berlaku untuk varian tertentu: key -> daftar label varian */
  restricted: Record<string, string[]>;
}

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface ValidationCheck { id: string; label: string; status: CheckStatus; detail: string; components?: string[] }
export interface ValidationReport { ok: boolean; created_at: string; checks: ValidationCheck[]; protected_hashes: Record<string, string>; output_sha256: string }

export interface LayoutFinding { level: 'info' | 'warn'; code: string; page: number | null; message: string }
export interface VisualCompareResult { report: { pages_original: number; pages_generated: number; findings: LayoutFinding[]; material: boolean }; original_pdf: string; generated_pdf: string }
