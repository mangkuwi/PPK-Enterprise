import { randomUUID } from 'node:crypto';
import { formatDateID } from '@shared/date';
import { DEFAULT_SETTINGS, layoutFromSettings } from '@shared/settings';
import { variantApplied, type
  AnalysisResult, CompareView, DocxTemplateInfo, GroupRec, ImportReview, ImportSaveInput, ImportSummary, MappingRec, TemplateVersion, VariantGroup, Warning
} from '@shared/importer';
import type { DocumentRecord, TipTapNode } from '@shared/types';
import type { DB } from './db';
import * as repo from './repo';
import { adaptDocx } from './ooxml/adapt';
import { protectedHashes } from './ooxml/validate';
import { analyzeDocx } from './ooxml/analyze';
import { fillZip, listTokens } from './ooxml/fill';
import { compareZips, paragraphDiff } from './ooxml/inspect';
import { scanPart } from './ooxml/scan';
import { validateGenerated, type ValidationReport } from './ooxml/validate';
import { detectVariants, projectVariants, resolveVariants, selectionFromValues, verifyProjection } from './ooxml/variants';
import { Zip, sha256 } from './ooxml/zip';

export class ValidationError extends Error {
  constructor(public report: ValidationReport) {
    super(`Validasi dokumen gagal — ekspor dihentikan. ${report.checks.filter((c) => c.status === 'fail').map((c) => `${c.label}: ${c.detail}`).join(' | ')}`);
    this.name = 'ValidationError';
  }
}

const now = () => new Date().toISOString();
const toBuf = (b: unknown): Buffer => Buffer.from(b as Uint8Array);
const MAX_BYTES = 50 * 1024 * 1024;

export function openDocx(buf: Buffer): Zip {
  if (buf.length > MAX_BYTES) throw new Error('Berkas terlalu besar (maks 50 MB).');
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Berkas bukan dokumen Word (.docx) yang valid. Simpan sebagai .docx dari Word lalu coba lagi.');
  const zip = Zip.read(buf);
  if (!zip.has('word/document.xml')) throw new Error('Berkas tidak memuat word/document.xml — bukan dokumen Word.');
  if (zip.has('EncryptedPackage') || zip.has('word/vbaProject.bin')) throw new Error('Dokumen terenkripsi atau berisi makro tidak didukung. Simpan salinan tanpa kata sandi/makro.');
  return zip;
}

// ---------- rendition (TipTap) untuk pratinjau/editor ----------
function renditionFrom(zip: Zip, tokensAsBrackets: boolean): TipTapNode {
  const sc = scanPart('word/document.xml', zip.text('word/document.xml') ?? '');
  const content: TipTapNode[] = [];
  for (const p of sc.paras) {
    if (p.depth > 0 && !p.text.trim()) continue;
    let t = p.text;
    if (tokensAsBrackets) t = t.replace(/\{\{\s*(\??)([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, '‹$2.$3›').replace(/\{\{\s*(\??)([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, '[$1$2]');
    const lines = t.replace(/\t/g, '    ').split('\n');
    const nodes: TipTapNode[] = [];
    lines.forEach((ln, i) => { if (i) nodes.push({ type: 'hardBreak' }); if (ln) nodes.push({ type: 'text', text: ln, ...(p.bold ? { marks: [{ type: 'bold' }] } : {}) }); });
    const align = p.align === 'center' || p.align === 'right' || p.align === 'justify' ? p.align : undefined;
    content.push({ type: 'paragraph', ...(align ? { attrs: { textAlign: align } } : {}), ...(nodes.length ? { content: nodes } : {}) });
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

// ---------- varian ----------
const BODY = 'word/document.xml';
function writeVariants(db: DB, importId: string, groups: VariantGroup[]) {
  db.prepare('DELETE FROM template_variants WHERE imported_template_id = ?').run(importId);
  const ins = db.prepare('INSERT INTO template_variants (id, imported_template_id, group_no, position, letter, label, status, group_json, item_json) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const g of groups) {
    const { variants, ...meta } = g;
    variants.forEach((v, i) => { const { id, letter, label, ...rest } = v; ins.run(id, importId, g.group_no, i, letter, label, g.status, JSON.stringify(meta), JSON.stringify(rest)); });
  }
}
export function readVariants(db: DB, importId: string): VariantGroup[] {
  const rows = db.prepare('SELECT * FROM template_variants WHERE imported_template_id = ? ORDER BY group_no, position').all(importId) as any[];
  const out = new Map<number, VariantGroup>();
  for (const r of rows) {
    let g = out.get(r.group_no);
    if (!g) { g = { ...(JSON.parse(r.group_json) as Omit<VariantGroup, 'variants'>), status: r.status, variants: [] }; out.set(r.group_no, g); }
    g.variants.push({ id: r.id, letter: r.letter, label: r.label, ...JSON.parse(r.item_json) });
  }
  return [...out.values()];
}

/** Deteksi varian + pewarisan: konfigurasi isian dibuat sekali; saran duplikat di halaman varian tidak dibuat. */
function shareAcrossVariants(zip: Zip, a: AnalysisResult, off: boolean): { mappings: MappingRec[]; groups: GroupRec[]; variants: VariantGroup[]; warnings: Warning[] } {
  if (off) return { mappings: a.mappings, groups: a.groups, variants: [], warnings: [] };
  const det = detectVariants(zip, a.mappings);
  const warnings: Warning[] = det.groups.length ? det.notes.map((message) => ({ code: 'variant-note', level: 'info' as const, message })) : [];
  if (!det.groups.length) return { mappings: a.mappings, groups: a.groups, variants: [], warnings: [] };
  const r = resolveVariants(scanPart(BODY, zip.text(BODY) ?? ''), a.mappings, a.groups, det.groups);
  for (const g of det.groups) {
    const names = g.variants.map((v) => v.label).join(', ');
    if (variantApplied(g)) warnings.push({ code: 'variants', level: 'info', message: `Terdeteksi ${g.variants.length} varian dari SATU template (${names}). Konfigurasi isian dipakai bersama; ${r.superseded.length} saran duplikat di halaman varian tidak dibuat.` });
    else warnings.push({ code: 'variants-confirm', level: 'warn', message: `Halaman-halaman mirip terdeteksi sebagai calon varian (${names}). ${g.reason} ${g.selectable ? 'Konfirmasi di panel Varian sebelum template disimpan.' : ''}` });
  }
  return { mappings: r.kept, groups: r.groups, variants: det.groups, warnings };
}

// ---------- impor ----------
function writeMappings(db: DB, importId: string, ms: MappingRec[]) {
  db.prepare('DELETE FROM template_mappings WHERE imported_template_id = ?').run(importId);
  const ins = db.prepare(`INSERT INTO template_mappings (id, imported_template_id, part, para_index, start_offset, end_offset, source_text, placeholder_name,
    label, field_type, default_value, required, options_json, confidence_score, mapping_status, reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const m of ms) ins.run(m.id, importId, m.part, m.para_index, m.start, m.end, m.source_text, m.placeholder_name, m.label, m.field_type, m.default_value,
    m.required ? 1 : 0, JSON.stringify(m.options), m.confidence, m.status, m.reason);
}
function readMappings(db: DB, importId: string): MappingRec[] {
  return (db.prepare('SELECT * FROM template_mappings WHERE imported_template_id = ? ORDER BY part DESC, para_index, start_offset').all(importId) as any[]).map((r) => ({
    id: r.id, part: r.part, para_index: r.para_index, start: r.start_offset, end: r.end_offset, source_text: r.source_text, placeholder_name: r.placeholder_name,
    label: r.label, field_type: r.field_type, default_value: r.default_value, required: !!r.required, options: JSON.parse(r.options_json),
    confidence: r.confidence_score, status: r.mapping_status, reason: r.reason
  }));
}
interface Stored { analysis: Omit<AnalysisResult, 'mappings' | 'groups'>; groups: GroupRec[]; name: string; description: string; protected?: string[]; variants_off?: boolean }

export function importDocx(db: DB, buf: Buffer, filename: string, filePath = ''): string {
  const zip = openDocx(buf);
  const analysis = analyzeDocx(zip, filename);
  const id = randomUUID(); const ts = now();
  const sh = shareAcrossVariants(zip, analysis, false);
  const { mappings, groups: _g, ...rest0 } = { ...analysis, mappings: sh.mappings };
  void _g;
  const rest = { ...rest0, warnings: [...rest0.warnings, ...sh.warnings] };
  const stored: Stored = { analysis: rest, groups: sh.groups, name: analysis.suggested_name, description: '' };
  const cat = (db.prepare('SELECT id FROM categories WHERE code = ?').get(analysis.suggested_category_code) as any)?.id ?? null;
  db.transaction(() => {
    db.prepare(`INSERT INTO imported_templates (id, original_filename, original_file_path, original_blob, original_sha256, category_id, import_status, analysis_result, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, filename, filePath, buf, sha256(buf), cat, 'analyzed', JSON.stringify(stored), ts, ts);
    writeMappings(db, id, mappings);
    writeVariants(db, id, sh.variants);
  })();
  return id;
}

const summaryRow = (db: DB, id: string): ImportSummary | null => {
  const r = db.prepare(`SELECT i.id, i.original_filename, i.template_id, i.category_id, i.import_status, i.created_at, i.updated_at, i.original_sha256 AS sha256,
    length(i.original_blob) AS size, COALESCE(t.name, json_extract(i.analysis_result,'$.name')) AS template_name,
    (SELECT COUNT(*) FROM template_mappings m WHERE m.imported_template_id=i.id AND m.mapping_status!='rejected') AS mapping_count,
    (SELECT COUNT(*) FROM template_mappings m WHERE m.imported_template_id=i.id AND m.mapping_status IN ('auto','confirmed','manual')) AS auto_count,
    (SELECT COUNT(*) FROM template_mappings m WHERE m.imported_template_id=i.id AND m.mapping_status='confirm') AS confirm_count,
    (SELECT COUNT(*) FROM template_variants v WHERE v.imported_template_id=i.id) AS variant_count
    FROM imported_templates i LEFT JOIN templates t ON t.id = i.template_id WHERE i.id = ?`).get(id) as ImportSummary | undefined;
  return r ?? null;
};

export function listImports(db: DB): ImportSummary[] {
  const ids = db.prepare('SELECT id FROM imported_templates ORDER BY created_at DESC').all() as Array<{ id: string }>;
  return ids.map((r) => summaryRow(db, r.id)).filter((x): x is ImportSummary => !!x);
}

function load(db: DB, id: string) {
  const r = db.prepare('SELECT * FROM imported_templates WHERE id = ?').get(id) as any;
  if (!r) throw new Error('Data impor tidak ditemukan.');
  return { row: r, stored: JSON.parse(r.analysis_result) as Stored };
}

export function getReview(db: DB, id: string): ImportReview {
  const { stored } = load(db, id);
  const summary = summaryRow(db, id) as ImportSummary;
  const mappings = readMappings(db, id);
  const vg = readVariants(db, id);
  const res = vg.some(variantApplied) ? resolveVariants(scanPart(BODY, originalZip(db, id).text(BODY) ?? ''), mappings, stored.groups, vg) : null;
  return {
    summary, name: stored.name, description: stored.description, protected_keys: stored.protected ?? [], versions: listVersions(db, id),
    analysis: { ...stored.analysis, mappings, groups: stored.groups },
    variant_groups: vg, variant_map: res?.varMap ?? {}, inherited_count: res?.derived.length ?? 0
  };
}

export function saveReview(db: DB, input: ImportSaveInput): void {
  const { stored } = load(db, input.id);
  for (const m of input.mappings) if (m.end <= m.start) throw new Error(`Rentang pemetaan "${m.placeholder_name}" tidak valid.`);
  // Area terlindungi: header/footer & paragraf yang ditandai pengguna tidak boleh menjadi isian (kecuali penanda eksplisit yang sudah ada di berkas).
  const prot = new Set(input.protected_keys);
  for (const m of input.mappings) {
    if (m.status === 'rejected') continue;
    const inHF = m.part !== 'word/document.xml';
    if ((inHF && (m.status === 'manual' || m.confidence < 1)) || prot.has(`${m.part}#${m.para_index}`))
      throw new Error(`"${m.placeholder_name}" berada di area terlindungi (${inHF ? 'header/footer' : 'paragraf yang Anda kunci'}). Tolak pemetaan itu atau buka kunci paragrafnya.`);
  }
  stored.protected = input.protected_keys;
  stored.name = input.name.trim() || stored.name; stored.description = input.description;
  // Varian: nama & konfirmasi; setelah dikonfirmasi, pemetaan duplikat di halaman varian digantikan pewarisan.
  let vg = readVariants(db, input.id);
  for (const e of input.variant_edits ?? []) {
    const g = vg.find((x) => x.group_no === e.group_no);
    if (!g) throw new Error(`Kelompok varian ${e.group_no} tidak ditemukan.`);
    for (const v of g.variants) {
      const label = e.labels?.[v.id]?.trim();
      if (label !== undefined) { if (!label) throw new Error('Nama varian tidak boleh kosong.'); v.label = label; }
    }
    if (new Set(g.variants.map((v) => v.label)).size !== g.variants.length) throw new Error('Nama varian harus unik dalam satu template.');
    if (e.status === 'confirmed') { if (!g.selectable) throw new Error('Kelompok varian ini tidak dapat dipilih otomatis (pemisah section/halaman); tolak untuk memperlakukannya sebagai satu template.'); g.status = 'confirmed'; }
  }
  const pruned = vg.some(variantApplied) ? resolveVariants(scanPart(BODY, originalZip(db, input.id).text(BODY) ?? ''), input.mappings, input.groups, vg) : null;
  const mappingsOut = pruned ? pruned.kept : input.mappings;
  stored.groups = pruned ? pruned.groups : input.groups;
  vg = vg.map((g) => g);
  db.transaction(() => {
    writeMappings(db, input.id, mappingsOut);
    writeVariants(db, input.id, vg);
    db.prepare('UPDATE imported_templates SET analysis_result=?, category_id=?, import_status=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(stored), input.category_id, 'reviewed', now(), input.id);
  })();
}

export function originalZip(db: DB, id: string): Zip { return Zip.read(toBuf(load(db, id).row.original_blob)); }
export function originalBuffer(db: DB, id: string): { name: string; buf: Buffer } { const r = load(db, id).row; return { name: r.original_filename, buf: toBuf(r.original_blob) }; }

/** Analisis ulang dari berkas sumber yang tersimpan; seluruh pemetaan diganti hasil baru. */
export function reanalyze(db: DB, id: string): void {
  const { row, stored } = load(db, id);
  const zip = Zip.read(toBuf(row.original_blob));
  const analysis = analyzeDocx(zip, row.original_filename);
  const sh = shareAcrossVariants(zip, analysis, !!stored.variants_off);
  const { mappings: _m, groups: _g, ...rest } = analysis;
  void _m; void _g;
  stored.analysis = { ...rest, warnings: [...rest.warnings, ...sh.warnings] }; stored.groups = sh.groups;
  db.transaction(() => {
    writeMappings(db, id, sh.mappings);
    writeVariants(db, id, sh.variants);
    db.prepare('UPDATE imported_templates SET analysis_result=?, import_status=?, updated_at=? WHERE id=?').run(JSON.stringify(stored), 'analyzed', now(), id);
  })();
}

export interface BuildOut { adaptedBuf: Buffer; fields: ReturnType<typeof adaptDocx>['fields']; groups: ReturnType<typeof adaptDocx>['groups']; skipped: ReturnType<typeof adaptDocx>['skipped']; zip: Zip; variant_fields: ReturnType<typeof adaptDocx>['variant_fields']; inherited: number }
export function buildAdapted(db: DB, id: string): BuildOut {
  const { row, stored } = load(db, id);
  const src = Zip.read(toBuf(row.original_blob));
  const a = adaptDocx(src, readMappings(db, id), stored.groups, readVariants(db, id));
  return { adaptedBuf: a.zip.toBuffer(), fields: a.fields, groups: a.groups, skipped: a.skipped, zip: a.zip, variant_fields: a.variant_fields, inherited: a.inherited };
}

/** Jadikan hasil review sebagai template reusable (kind='docx'). */
export function saveAsTemplate(db: DB, id: string, versionNote?: string): string {
  const { row, stored } = load(db, id);
  const b = buildAdapted(db, id);
  if (b.skipped.length) throw new Error(`Sebagian pemetaan tidak dapat diterapkan: ${b.skipped.map((s) => s.reason).join('; ')}`);
  if (readVariants(db, id).some((g) => g.selectable && g.status === 'confirm')) throw new Error('Ada kelompok halaman mirip yang menunggu keputusan. Konfirmasi sebagai varian, atau tolak agar diperlakukan sebagai satu template, di panel Varian.');
  if (!b.fields.length && !b.groups.length) throw new Error('Belum ada isian yang dipetakan. Konfirmasi saran atau pilih teks secara manual terlebih dahulu.');
  const settings = repo.getSettings(db);
  const layout = layoutFromSettings(settings ?? DEFAULT_SETTINGS);
  const fields = b.fields.map((f, i) => ({ key: f.key, label: f.label, type: f.type, required: f.required, default_value: f.default_value, options: f.options, sort_order: i }));
  const tplId = repo.saveTemplate(db, {
    id: row.template_id ?? undefined, category_id: row.category_id, name: stored.name, description: stored.description || `Diimpor dari ${row.original_filename}`,
    content: renditionFrom(b.zip, true), header_text: '', footer_text: '', layout, is_active: true, fields
  }, { extraFields: b.variant_fields.map((f, i) => ({ key: f.key, label: f.label, type: f.type, required: f.required, default_value: f.default_value, options: f.options, sort_order: i })) });
  db.transaction(() => {
    db.prepare("UPDATE templates SET kind='docx' WHERE id=?").run(tplId);
    const prot = JSON.stringify({ keys: stored.protected ?? [], hashes: protectedHashes(b.zip) });
    db.prepare('UPDATE imported_templates SET adapted_blob=?, template_id=?, import_status=?, protected_json=?, updated_at=? WHERE id=?').run(b.adaptedBuf, tplId, 'saved', prot, now(), id);
    const vno = ((db.prepare('SELECT MAX(version_no) v FROM template_versions WHERE imported_template_id=?').get(id) as any).v ?? 0) + 1;
    db.prepare('INSERT INTO template_versions (id, imported_template_id, version_no, adapted_blob, mappings_json, groups_json, protected_json, note, created_at, variants_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(randomUUID(), id, vno, b.adaptedBuf, JSON.stringify(readMappings(db, id)), JSON.stringify(stored.groups), prot, versionNote ?? (vno === 1 ? 'Versi awal' : 'Pembaruan template'), now(), JSON.stringify(readVariants(db, id)));
    db.prepare('DELETE FROM template_assets WHERE imported_template_id=?').run(id);
    const ins = db.prepare('INSERT INTO template_assets (id, imported_template_id, asset_type, asset_path, metadata) VALUES (?,?,?,?,?)');
    for (const im of stored.analysis.doc.images) ins.run(randomUUID(), id, 'image', im.path, JSON.stringify({ bytes: im.bytes }));
  })();
  return tplId;
}

export function listVersions(db: DB, id: string): TemplateVersion[] {
  const cur = (db.prepare('SELECT MAX(version_no) v FROM template_versions WHERE imported_template_id=?').get(id) as any).v;
  return (db.prepare('SELECT id, version_no, note, created_at, mappings_json FROM template_versions WHERE imported_template_id=? ORDER BY version_no DESC').all(id) as any[])
    .map((r) => ({ id: r.id, version_no: r.version_no, note: r.note, created_at: r.created_at, mapping_count: JSON.parse(r.mappings_json).length, current: r.version_no === cur }));
}

/** Pulihkan versi lama: pemetaannya dimuat kembali lalu template dibangun ulang dari sumber asli sebagai versi baru (riwayat tidak dihapus). */
export function restoreVersion(db: DB, id: string, versionId: string): string {
  const v = db.prepare('SELECT * FROM template_versions WHERE id=? AND imported_template_id=?').get(versionId, id) as any;
  if (!v) throw new Error('Versi tidak ditemukan.');
  const { stored } = load(db, id);
  stored.groups = JSON.parse(v.groups_json);
  stored.protected = (JSON.parse(v.protected_json || '{}') as { keys?: string[] }).keys ?? [];
  db.transaction(() => {
    writeMappings(db, id, JSON.parse(v.mappings_json));
    const snap = JSON.parse(v.variants_json || '[]') as VariantGroup[];
    if (snap.length) writeVariants(db, id, snap);
    db.prepare('UPDATE imported_templates SET analysis_result=?, updated_at=? WHERE id=?').run(JSON.stringify(stored), now(), id);
  })();
  return saveAsTemplate(db, id, `Dipulihkan dari versi ${v.version_no}`);
}

export function deleteImport(db: DB, id: string, withTemplate: boolean) {
  const { row } = load(db, id);
  db.transaction(() => {
    db.prepare('DELETE FROM imported_templates WHERE id=?').run(id);
    if (withTemplate && row.template_id) db.prepare('DELETE FROM templates WHERE id=?').run(row.template_id);
  })();
}

/** Kembalikan template ke sumber asli: pemetaan diganti hasil analisis ulang dan blob adaptasi dibuang. */
export function restoreSource(db: DB, id: string) {
  reanalyze(db, id);
  db.prepare('UPDATE imported_templates SET adapted_blob=NULL, updated_at=? WHERE id=?').run(now(), id);
}

export function importOfTemplate(db: DB, templateId: string): { id: string } | null {
  return (db.prepare('SELECT id FROM imported_templates WHERE template_id=?').get(templateId) as any) ?? null;
}

export function getDocxTemplateInfo(db: DB, templateId: string): DocxTemplateInfo | null {
  const imp = importOfTemplate(db, templateId);
  if (!imp) return null;
  const { stored } = load(db, imp.id);
  const active = stored.groups.filter((g) => g.status !== 'rejected' && g.status !== 'confirm');
  const vg = readVariants(db, imp.id).filter(variantApplied);
  const restricted = vg.length ? resolveVariants(scanPart(BODY, originalZip(db, imp.id).text(BODY) ?? ''), readMappings(db, imp.id), stored.groups, vg).restricted : {};
  const variants = vg.map((g) => ({ group_no: g.group_no, field_key: g.field_key, label: `Varian ${g.kind_label}`, default_label: g.variants[0].label, options: g.variants.map((v) => ({ id: v.id, label: v.label, summary: v.summary })) }));
  return { template_id: templateId, import_id: imp.id, variants, restricted, groups: active.map((g) => ({ name: g.name, label: g.label, columns: g.columns.map((c) => ({ key: c.key, label: c.label, auto_number: c.auto_number })), default_rows: g.default_rows })) };
}

// ---------- generate ----------
export function generateFromTemplate(db: DB, templateId: string, values: Record<string, string>): { buf: Buffer; zip: Zip; unresolved: string[]; report: ValidationReport } {
  const imp = importOfTemplate(db, templateId);
  const blob = imp && (db.prepare('SELECT adapted_blob FROM imported_templates WHERE id=?').get(imp.id) as any)?.adapted_blob;
  if (!blob) throw new Error('Template DOCX belum disimpan atau berkas adaptasinya hilang.');
  const full = Zip.read(toBuf(blob)); // salinan; templat tidak pernah ditulis ulang
  // Varian: salinan kerja hanya memuat halaman varian terpilih; master & varian lain tidak diubah.
  const vgroups = readVariants(db, imp!.id);
  const sel = selectionFromValues(vgroups, values);
  const adapted = projectVariants(full, sel);
  const proj = verifyProjection(full, adapted, sel);
  const extra = sel.length ? [{ id: 'variant', label: 'Pemilihan varian halaman', status: proj.ok ? 'pass' as const : 'fail' as const,
    detail: proj.ok ? `${sel.map((x) => `${x.group.kind_label}: ${x.group.variants.find((v) => v.id === x.variantId)?.label}`).join('; ')}. ${proj.detail}` : proj.detail }] : [];
  const optional = new Set(listTokens(adapted).filter((t) => t.optional).map((t) => t.key));
  // Isian bertipe tanggal disimpan ISO (yyyy-mm-dd) di formulir; di dokumen ditulis "23 November 2026".
  const dateKeys = new Set((db.prepare("SELECT key FROM template_fields WHERE template_id=? AND type='date'").all(templateId) as Array<{ key: string }>).map((x) => x.key));
  const shown: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) shown[k] = dateKeys.has(k) ? formatDateID(v) : v;
  const r = fillZip(adapted, { values: shown, optionalKeys: optional });
  const buf = r.zip.toBuffer();
  const report = validateGenerated(adapted, r.zip, { unresolved: r.unresolved.filter((u) => !optional.has(u)), output: buf, extra });
  return { buf, zip: r.zip, unresolved: r.unresolved, report };
}

export function createDocxDocument(db: DB, input: { template_id: string; title: string; values: Record<string, string>; category_id: string | null; template_name: string; doc_date: string; letter_number: string; recipient: string; subject: string }): DocumentRecord {
  const gen = generateFromTemplate(db, input.template_id, input.values);
  if (!gen.report.ok) throw new ValidationError(gen.report);
  const settings = repo.getSettings(db);
  const doc = repo.saveDocument(db, {
    template_id: input.template_id, template_name: input.template_name, category_id: input.category_id, title: input.title,
    letter_number: input.letter_number, recipient: input.recipient, subject: input.subject, doc_date: input.doc_date, status: 'draft',
    content: renditionFrom(gen.zip, false), header_text: '', footer_text: '', layout: layoutFromSettings(settings ?? DEFAULT_SETTINGS),
    form_values: input.values, use_kop: false, note: 'Dibuat dari template Word'
  });
  db.prepare("UPDATE documents SET source_kind='docx', docx_blob=?, docx_state='pristine', validation_json=? WHERE id=?").run(gen.buf, JSON.stringify(gen.report), doc.id);
  return repo.getDocument(db, doc.id) as DocumentRecord;
}

/** Regenerasi DOCX dokumen dari nilai formulir terbaru ("Perbarui dari Formulir"). */
export function regenerateDocxDocument(db: DB, docId: string, values: Record<string, string>): DocumentRecord {
  const d = db.prepare('SELECT template_id, source_kind FROM documents WHERE id=?').get(docId) as any;
  if (!d || d.source_kind !== 'docx' || !d.template_id) throw new Error('Dokumen ini bukan dokumen hasil template Word.');
  const gen = generateFromTemplate(db, d.template_id, values);
  if (!gen.report.ok) throw new ValidationError(gen.report);
  const cur = repo.getDocument(db, docId) as DocumentRecord;
  repo.saveDocument(db, { ...cur, id: docId, content: renditionFrom(gen.zip, false), form_values: values, note: 'Diperbarui dari formulir' });
  db.prepare("UPDATE documents SET docx_blob=?, docx_state='pristine', validation_json=? WHERE id=?").run(gen.buf, JSON.stringify(gen.report), docId);
  return repo.getDocument(db, docId) as DocumentRecord;
}

export function getValidation(db: DB, docId: string): ValidationReport | null {
  const r = db.prepare('SELECT validation_json FROM documents WHERE id=?').get(docId) as any;
  return r?.validation_json ? (JSON.parse(r.validation_json) as ValidationReport) : null;
}

/** Hentikan ekspor bila berkas tersimpan berbeda dari yang divalidasi saat pembuatan. */
export function verifyForExport(db: DB, docId: string): ValidationReport {
  const d = getDocumentDocx(db, docId);
  const rep = getValidation(db, docId);
  if (d.kind !== 'docx' || !d.buf) throw new Error('Dokumen ini tidak memiliki berkas Word asli.');
  if (!rep) throw new Error('Dokumen belum memiliki laporan validasi. Gunakan "Perbarui dari Formulir" untuk membuat ulang dari template asli.');
  if (!rep.ok) throw new ValidationError(rep);
  if (sha256(d.buf) !== rep.output_sha256) throw new Error('Berkas DOCX tersimpan berbeda dari hasil validasi (komponen berubah tak terduga). Ekspor dihentikan; gunakan "Perbarui dari Formulir" untuk mencoba ulang dari template asli.');
  return rep;
}

export function getDocumentDocx(db: DB, docId: string): { buf: Buffer | null; state: 'pristine' | 'edited'; kind: 'editor' | 'docx' } {
  const r = db.prepare('SELECT docx_blob, docx_state, source_kind FROM documents WHERE id=?').get(docId) as any;
  if (!r) throw new Error('Dokumen tidak ditemukan.');
  return { buf: r.docx_blob ? toBuf(r.docx_blob) : null, state: r.docx_state, kind: r.source_kind };
}

// ---------- perbandingan Original / Adapted / Generated ----------
export function compare(db: DB, id: string): CompareView {
  const { row, stored } = load(db, id);
  const src = Zip.read(toBuf(row.original_blob));
  const mappings = readMappings(db, id);
  const b = buildAdapted(db, id);
  const values: Record<string, string> = {};
  for (const m of mappings) if (m.status !== 'rejected' && m.status !== 'confirm') values[m.placeholder_name] ??= m.source_text;
  for (const g of b.groups) values[`@${g.name}`] = JSON.stringify(g.default_rows);
  const optional = new Set(listTokens(b.zip).filter((t) => t.optional).map((t) => t.key));
  const gen = fillZip(b.zip, { values, optionalKeys: optional });
  const report = compareZips(src, gen.zip);
  const toks = listTokens(b.zip).map((t) => `${t.optional ? '?' : ''}${t.key}`);
  const unmapped = stored.analysis.paras.filter((p) => !p.static_reason && p.text.trim().length >= 90 && !mappings.some((m) => m.part === p.part && m.para_index === p.index && m.status !== 'rejected')).map((p) => p.text.slice(0, 80));
  const notes = [...report.notes];
  if (b.skipped.length) notes.push({ code: 'skipped', level: 'warn', message: `${b.skipped.length} pemetaan tidak dapat diterapkan: ${b.skipped.map((s) => s.reason).join('; ')}` });
  if (gen.unresolved.length) notes.push({ code: 'unmapped', level: 'warn', message: `Placeholder belum terisi: ${gen.unresolved.join(', ')}` });
  const textDiff = paragraphDiff(src, gen.zip).length;
  if (textDiff) notes.push({ code: 'textdiff', level: 'info', message: `${textDiff} paragraf berbeda dari sumber setelah diisi nilai awal (mis. nilai tanggal diformat ulang).` });
  return {
    original_paras: stored.analysis.paras.slice(0, 600),
    report: { identical_entries: report.identical_entries, changed_entries: report.changed_entries, format_preserved: report.format_preserved, notes, parts: report.parts.map((p) => ({ label: p.label, paragraphs: p.paragraphs, tables: p.tables, rows: p.rows, drawings: p.drawings, signature_equal: p.signature_equal })) },
    adapted_diff: paragraphDiff(src, b.zip), generated_diff: paragraphDiff(src, gen.zip), adapted_tokens: toks, skipped: b.skipped, unmapped
  };
}

/** Berkas sumber asli (acuan render) dan DOCX hasil untuk perbandingan visual. */
export function getVisualInputs(db: DB, docId: string): { original: Buffer; generated: Buffer } {
  const d = db.prepare('SELECT template_id, docx_blob FROM documents WHERE id=?').get(docId) as any;
  if (!d?.docx_blob) throw new Error('Dokumen ini tidak memiliki berkas Word asli.');
  const imp = d.template_id ? importOfTemplate(db, d.template_id) : null;
  if (!imp) throw new Error('Template sumber sudah dihapus; perbandingan dengan sumber asli tidak tersedia.');
  // Acuan = sumber asli pada varian yang sama dengan dokumen (bukan seluruh halaman semua varian).
  const fv = JSON.parse((db.prepare('SELECT form_values_json FROM documents WHERE id=?').get(docId) as any).form_values_json) as Record<string, string>;
  const orig = projectVariants(originalZip(db, imp.id), selectionFromValues(readVariants(db, imp.id), fv));
  return { original: orig.toBuffer(), generated: toBuf(d.docx_blob) };
}

// ---------- keputusan & pratinjau varian ----------
/** Konfirmasi atau tolak kelompok varian. Menolak = seluruh dokumen diperlakukan sebagai satu template (halaman tidak digabung/dibuang). */
export function decideVariants(db: DB, id: string, groupNo: number, decision: 'confirm' | 'reject'): void {
  const { row, stored } = load(db, id);
  const vg = readVariants(db, id);
  const g = vg.find((x) => x.group_no === groupNo);
  if (!g) throw new Error('Kelompok varian tidak ditemukan.');
  const zip = Zip.read(toBuf(row.original_blob));
  if (decision === 'confirm') {
    if (!g.selectable) throw new Error('Kelompok varian ini tidak dapat dipilih otomatis (pemisah section/halaman); tolak untuk memperlakukannya sebagai satu template.');
    g.status = 'confirmed';
    const r = resolveVariants(scanPart(BODY, zip.text(BODY) ?? ''), readMappings(db, id), stored.groups, vg);
    stored.groups = r.groups;
    db.transaction(() => {
      writeMappings(db, id, r.kept); writeVariants(db, id, vg);
      db.prepare('UPDATE imported_templates SET analysis_result=?, updated_at=? WHERE id=?').run(JSON.stringify(stored), now(), id);
    })();
    return;
  }
  // tolak: kembalikan saran analisis untuk halaman varian yang sebelumnya digantikan pewarisan; edit pengguna dipertahankan
  const fresh = analyzeDocx(zip, row.original_filename);
  const ranges = g.variants.slice(1).map((v) => [v.para_first, v.para_last] as const);
  const inRanges = (i: number) => ranges.some(([a, b]) => i >= a && i <= b);
  const cur = readMappings(db, id);
  const scan = scanPart(BODY, zip.text(BODY) ?? '');
  const add = fresh.mappings.filter((m) => m.part === BODY && inRanges(m.para_index) && !cur.some((c) => c.part === m.part && c.para_index === m.para_index && c.start < m.end && c.end > m.start));
  const addGroups = fresh.groups.filter((fg) => { const first = scan.paras.find((p) => p.table?.tbl === fg.tbl)?.index; return first !== undefined && inRanges(first) && !stored.groups.some((x) => x.tbl === fg.tbl); });
  stored.groups = [...stored.groups, ...addGroups]; stored.variants_off = true;
  db.transaction(() => {
    writeMappings(db, id, [...cur, ...add]); writeVariants(db, id, []);
    db.prepare('UPDATE imported_templates SET analysis_result=?, updated_at=? WHERE id=?').run(JSON.stringify(stored), now(), id);
  })();
}

/** DOCX sumber asli yang diproyeksikan ke satu varian (varian lain di kelompok lain = master). Dipakai pratinjau PDF. */
export function variantSourceDocx(db: DB, id: string, variantId: string): Buffer {
  const vg = readVariants(db, id);
  const hit = vg.find((g) => g.variants.some((v) => v.id === variantId));
  if (!hit) throw new Error('Varian tidak ditemukan.');
  if (!hit.selectable) throw new Error('Pratinjau varian tidak tersedia untuk dokumen dengan pemisah section.');
  const sel = vg.filter((g) => g.selectable).map((g) => ({ group: g, variantId: g === hit ? variantId : g.variants[0].id }));
  return projectVariants(originalZip(db, id), sel).toBuffer();
}

/** Ringkasan registrasi: bukti bahwa tidak ada kategori/template/konfigurasi ganda untuk varian. */
export function variantRegistry(db: DB, id: string) {
  const { stored } = load(db, id);
  const summary = summaryRow(db, id) as ImportSummary;
  const vg = readVariants(db, id);
  const ms = readMappings(db, id);
  const outside = vg.filter(variantApplied).flatMap((g) => g.variants.slice(1)).filter((v) => ms.some((m) => m.part === BODY && m.status !== 'manual' && m.para_index >= v.para_first && m.para_index <= v.para_last)).length;
  void stored;
  return {
    master_templates: 1, document_categories: summary.category_id ? 1 : 0, template_variants: vg.reduce((n, g) => n + g.variants.length, 0),
    shared_placeholder_configurations: 1, mappings: ms.length, duplicated_in_variants: outside
  };
}
