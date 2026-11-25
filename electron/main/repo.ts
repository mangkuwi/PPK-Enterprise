import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { docToPlainText, fieldsFromDoc } from '@shared/placeholder';
import type {
  BackupRecord, Category, DocumentFilter, DocumentInput, DocumentRecord, DocumentSummary, DocStatus, Layout,
  Settings, Stats, Template, TemplateField, TemplateFilter, TemplateInput, TemplateSummary, TipTapNode,
  VersionRecord, VersionSummary
} from '@shared/types';

const uid = () => randomUUID();
const now = () => new Date().toISOString();
const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
const MAX_VERSIONS = 50;

// ---------- categories ----------
export function listCategories(db: DB): Category[] {
  return (db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as any[]).map((r) => ({ ...r, is_default: !!r.is_default }));
}

// ---------- templates ----------
const TPL_SUMMARY = `SELECT t.id, t.category_id, COALESCE(c.name,'Tanpa Kategori') AS category_name, COALESCE(c.code,'DOK') AS category_code,
  t.name, t.description, t.is_favorite, t.is_active, t.kind, t.created_at, t.updated_at,
  (SELECT COUNT(*) FROM template_fields f WHERE f.template_id = t.id) AS field_count
  FROM templates t LEFT JOIN categories c ON c.id = t.category_id`;

const toTplSummary = (r: any): TemplateSummary => ({ ...r, is_favorite: !!r.is_favorite, is_active: !!r.is_active });

export function listTemplates(db: DB, f: TemplateFilter = {}): TemplateSummary[] {
  const where: string[] = []; const args: any[] = [];
  if (f.search?.trim()) { where.push("(t.name LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')"); args.push(like(f.search.trim()), like(f.search.trim())); }
  if (f.categoryId) { where.push('t.category_id = ?'); args.push(f.categoryId); }
  if (f.favoriteOnly) where.push('t.is_favorite = 1');
  if (f.activeOnly) where.push('t.is_active = 1');
  const sql = `${TPL_SUMMARY} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.is_favorite DESC, t.name COLLATE NOCASE`;
  return (db.prepare(sql).all(...args) as any[]).map(toTplSummary);
}

function loadFields(db: DB, templateId: string): TemplateField[] {
  return (db.prepare('SELECT * FROM template_fields WHERE template_id = ? ORDER BY sort_order').all(templateId) as any[]).map((r) => ({
    id: r.id, key: r.key, label: r.label, type: r.type, required: !!r.required,
    default_value: r.default_value, options: JSON.parse(r.options_json), sort_order: r.sort_order
  }));
}

export function getTemplate(db: DB, id: string): Template | null {
  const r = db.prepare(`${TPL_SUMMARY} WHERE t.id = ?`).get(id) as any;
  if (!r) return null;
  const full = db.prepare('SELECT content_json, header_text, footer_text, layout_json FROM templates WHERE id = ?').get(id) as any;
  return {
    ...toTplSummary(r), content: JSON.parse(full.content_json), header_text: full.header_text, footer_text: full.footer_text,
    layout: JSON.parse(full.layout_json), fields: loadFields(db, id)
  };
}

function writeFields(db: DB, templateId: string, fields: TemplateField[]) {
  db.prepare('DELETE FROM template_fields WHERE template_id = ?').run(templateId);
  const ins = db.prepare(`INSERT INTO template_fields (id, template_id, key, label, type, required, default_value, options_json, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  fields.forEach((f, i) => ins.run(uid(), templateId, f.key, f.label, f.type, f.required ? 1 : 0, f.default_value, JSON.stringify(f.options), i));
}

export function saveTemplate(db: DB, input: TemplateInput, opts: { keepId?: boolean; extraFields?: TemplateField[] } = {}): string {
  const id = input.id ?? uid();
  const ts = now();
  // Field selalu disinkronkan dengan placeholder yang benar-benar ada di isi template.
  // extraFields = isian yang bukan placeholder di isi dokumen (mis. pemilih varian template Word).
  const extra = (opts.extraFields ?? []).map((f, i) => ({ ...f, sort_order: i }));
  const fields = [...extra, ...fieldsFromDoc(input.content, input.fields).filter((f) => !extra.some((e) => e.key === f.key))];
  db.transaction(() => {
    const exists = db.prepare('SELECT 1 FROM templates WHERE id = ?').get(id);
    if (exists) {
      db.prepare(`UPDATE templates SET category_id=?, name=?, description=?, content_json=?, header_text=?, footer_text=?, layout_json=?,
        is_active=?, updated_at=? WHERE id=?`).run(input.category_id, input.name, input.description, JSON.stringify(input.content),
        input.header_text, input.footer_text, JSON.stringify(input.layout), input.is_active ? 1 : 0, ts, id);
    } else {
      db.prepare(`INSERT INTO templates (id, category_id, name, description, content_json, header_text, footer_text, layout_json,
        is_favorite, is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.category_id, input.name, input.description,
        JSON.stringify(input.content), input.header_text, input.footer_text, JSON.stringify(input.layout),
        input.is_favorite ? 1 : 0, input.is_active ? 1 : 0, ts, ts);
    }
    writeFields(db, id, fields);
  })();
  void opts;
  return id;
}

export function deleteTemplate(db: DB, id: string) { db.prepare('DELETE FROM templates WHERE id = ?').run(id); }
export function setTemplateFavorite(db: DB, id: string, value: boolean) {
  db.prepare('UPDATE templates SET is_favorite = ?, updated_at = ? WHERE id = ?').run(value ? 1 : 0, now(), id);
}

export function duplicateTemplate(db: DB, id: string): string {
  const t = getTemplate(db, id);
  if (!t) throw new Error('Template tidak ditemukan.');
  return saveTemplate(db, { ...t, id: undefined, name: `${t.name} (Salinan)`, is_favorite: false });
}

export interface TemplateExport {
  format: 'naskahdinas-templates'; version: 1; exported_at: string;
  templates: Array<{
    id?: string; name: string; category_code: string; category_name: string; description: string; content: TipTapNode;
    header_text: string; footer_text: string; layout: Layout; is_active: boolean; fields: TemplateField[];
  }>;
}

export function exportTemplates(db: DB, ids: string[]): TemplateExport {
  const templates = ids.map((id) => getTemplate(db, id)).filter((t): t is Template => !!t).map((t) => ({
    id: t.id, name: t.name, category_code: t.category_code, category_name: t.category_name, description: t.description,
    content: t.content, header_text: t.header_text, footer_text: t.footer_text, layout: t.layout, is_active: t.is_active,
    fields: t.fields.map(({ id: _id, ...rest }) => rest)
  }));
  return { format: 'naskahdinas-templates', version: 1, exported_at: now(), templates };
}

export function importTemplates(db: DB, payload: TemplateExport, opts: { keepIds?: boolean } = {}): number {
  const cats = listCategories(db);
  const fallback = cats.find((c) => c.name === 'Lainnya')?.id ?? null;
  let count = 0;
  db.transaction(() => {
    for (const t of payload.templates) {
      const cat = cats.find((c) => c.code === t.category_code) ?? cats.find((c) => c.name === t.category_name);
      if (opts.keepIds && t.id && db.prepare('SELECT 1 FROM templates WHERE id = ?').get(t.id)) continue;
      // Template contoh dibuat dengan UUID acak per instalasi; saat restore, nama + kategori yang sama dianggap sudah ada.
      if (opts.keepIds && db.prepare('SELECT 1 FROM templates WHERE name = ? AND category_id IS ?').get(t.name, cat?.id ?? fallback)) continue;
      saveTemplate(db, {
        id: opts.keepIds ? t.id : undefined, category_id: cat?.id ?? fallback, name: t.name, description: t.description,
        content: t.content, header_text: t.header_text, footer_text: t.footer_text, layout: t.layout,
        is_active: t.is_active, fields: t.fields
      });
      count++;
    }
  })();
  return count;
}

// ---------- documents ----------
const DOC_SUMMARY = `SELECT d.id, d.template_id, d.template_name, d.category_id, COALESCE(c.name,'Tanpa Kategori') AS category_name,
  COALESCE(c.code,'DOK') AS category_code, d.title, d.letter_number, d.recipient, d.subject, d.doc_date, d.status, d.source_kind, d.docx_state, d.created_at, d.updated_at
  FROM documents d LEFT JOIN categories c ON c.id = d.category_id`;

const SORTABLE = new Set(['title', 'doc_date', 'created_at', 'updated_at', 'status', 'letter_number']);

export function listDocuments(db: DB, f: DocumentFilter = {}, limit = 1000): DocumentSummary[] {
  const where: string[] = []; const args: any[] = [];
  if (f.search?.trim()) {
    const q = like(f.search.trim());
    where.push(`(d.title LIKE ? ESCAPE '\\' OR d.letter_number LIKE ? ESCAPE '\\' OR d.recipient LIKE ? ESCAPE '\\'
      OR d.subject LIKE ? ESCAPE '\\' OR d.content_text LIKE ? ESCAPE '\\')`);
    args.push(q, q, q, q, q);
  }
  if (f.categoryId) { where.push('d.category_id = ?'); args.push(f.categoryId); }
  if (f.status) { where.push('d.status = ?'); args.push(f.status); }
  const eff = "COALESCE(NULLIF(d.doc_date,''), substr(d.created_at,1,10))";
  if (f.dateFrom) { where.push(`${eff} >= ?`); args.push(f.dateFrom); }
  if (f.dateTo) { where.push(`${eff} <= ?`); args.push(f.dateTo); }
  const sortBy = f.sortBy && SORTABLE.has(f.sortBy) ? f.sortBy : 'created_at';
  const dir = f.sortDir === 'asc' ? 'ASC' : 'DESC';
  const sql = `${DOC_SUMMARY} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.${sortBy} ${dir} LIMIT ${Math.max(1, Math.floor(limit))}`;
  return db.prepare(sql).all(...args) as DocumentSummary[];
}

export function getDocument(db: DB, id: string): DocumentRecord | null {
  const s = db.prepare(`${DOC_SUMMARY} WHERE d.id = ?`).get(id) as DocumentSummary | undefined;
  if (!s) return null;
  const r = db.prepare('SELECT content_json, header_text, footer_text, layout_json, form_values_json, use_kop FROM documents WHERE id = ?').get(id) as any;
  return {
    ...s, content: JSON.parse(r.content_json), header_text: r.header_text, footer_text: r.footer_text,
    layout: JSON.parse(r.layout_json), form_values: JSON.parse(r.form_values_json), use_kop: !!r.use_kop
  };
}

function addVersion(db: DB, documentId: string, title: string, contentJson: string, note: string) {
  const last = db.prepare('SELECT MAX(version_no) AS n FROM document_versions WHERE document_id = ?').get(documentId) as { n: number | null };
  const no = (last.n ?? 0) + 1;
  db.prepare('INSERT INTO document_versions (id, document_id, version_no, title, content_json, note, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uid(), documentId, no, title, contentJson, note, now());
  db.prepare(`DELETE FROM document_versions WHERE document_id = ? AND version_no <= ?`).run(documentId, no - MAX_VERSIONS);
}

export function saveDocument(db: DB, input: DocumentInput): DocumentRecord {
  const ts = now();
  const contentJson = JSON.stringify(input.content);
  const text = docToPlainText(input.content);
  let id = input.id;
  db.transaction(() => {
    const exists = id ? db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id) : undefined;
    if (id && exists) {
      // Dokumen DOCX yang isinya disunting di editor tidak lagi identik dengan berkas Word asli.
      const prev = db.prepare('SELECT source_kind, content_text FROM documents WHERE id = ?').get(id) as any;
      db.prepare(`UPDATE documents SET template_id=?, template_name=?, category_id=?, title=?, letter_number=?, recipient=?, subject=?, doc_date=?,
        status=?, content_json=?, content_text=?, header_text=?, footer_text=?, layout_json=?, form_values_json=?, use_kop=?, updated_at=? WHERE id=?`)
        .run(input.template_id, input.template_name, input.category_id, input.title, input.letter_number, input.recipient, input.subject, input.doc_date,
          input.status, contentJson, text, input.header_text, input.footer_text, JSON.stringify(input.layout), JSON.stringify(input.form_values),
          input.use_kop ? 1 : 0, ts, id);
      if (prev?.source_kind === 'docx' && prev.content_text !== text) db.prepare("UPDATE documents SET docx_state='edited' WHERE id=?").run(id);
      const last = db.prepare('SELECT content_json FROM document_versions WHERE document_id = ? ORDER BY version_no DESC LIMIT 1').get(id) as any;
      if (!last || last.content_json !== contentJson || input.note) addVersion(db, id, input.title, contentJson, input.note ?? '');
    } else {
      id = id ?? uid();
      db.prepare(`INSERT INTO documents (id, template_id, template_name, category_id, title, letter_number, recipient, subject, doc_date, status,
        content_json, content_text, header_text, footer_text, layout_json, form_values_json, use_kop, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, input.template_id, input.template_name, input.category_id, input.title, input.letter_number, input.recipient, input.subject,
          input.doc_date, input.status, contentJson, text, input.header_text, input.footer_text, JSON.stringify(input.layout),
          JSON.stringify(input.form_values), input.use_kop ? 1 : 0, ts, ts);
      addVersion(db, id, input.title, contentJson, input.note ?? 'Versi awal');
    }
  })();
  return getDocument(db, id as string) as DocumentRecord;
}

export function deleteDocument(db: DB, id: string) { db.prepare('DELETE FROM documents WHERE id = ?').run(id); }
export function setDocumentStatus(db: DB, id: string, status: DocStatus) {
  db.prepare('UPDATE documents SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
}

export function duplicateDocument(db: DB, id: string): DocumentRecord {
  const d = getDocument(db, id);
  if (!d) throw new Error('Dokumen tidak ditemukan.');
  const { id: _id, category_name: _a, category_code: _b, created_at: _c, updated_at: _d, ...rest } = d;
  return saveDocument(db, { ...rest, id: undefined, title: `${d.title} (Salinan)`, status: 'draft', note: `Duplikat dari "${d.title}"` });
}

export function listVersions(db: DB, documentId: string): VersionSummary[] {
  return db.prepare('SELECT id, document_id, version_no, title, note, created_at FROM document_versions WHERE document_id = ? ORDER BY version_no DESC').all(documentId) as VersionSummary[];
}

export function getVersion(db: DB, id: string): VersionRecord | null {
  const r = db.prepare('SELECT * FROM document_versions WHERE id = ?').get(id) as any;
  return r ? { id: r.id, document_id: r.document_id, version_no: r.version_no, title: r.title, note: r.note, created_at: r.created_at, content: JSON.parse(r.content_json) } : null;
}

export function restoreVersion(db: DB, versionId: string): DocumentRecord {
  const v = getVersion(db, versionId);
  if (!v) throw new Error('Versi tidak ditemukan.');
  const d = getDocument(db, v.document_id);
  if (!d) throw new Error('Dokumen tidak ditemukan.');
  const { id, category_name: _a, category_code: _b, created_at: _c, updated_at: _d, ...rest } = d;
  return saveDocument(db, { ...rest, id, content: v.content, note: `Dipulihkan dari versi ${v.version_no}` });
}

export interface DocumentExport {
  format: 'naskahdinas-documents'; version: 1; exported_at: string;
  documents: Array<{ record: Record<string, unknown>; versions: Array<Record<string, unknown>> }>;
}

/** BLOB (docx_blob) diserialisasi sebagai base64 agar aman di JSON. */
function encodeBlobs(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r };
  for (const [k, v] of Object.entries(out)) if (v instanceof Uint8Array) out[k] = { __b64: Buffer.from(v).toString('base64') };
  return out;
}
function decodeBlobs(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r };
  for (const [k, v] of Object.entries(out)) if (v && typeof v === 'object' && typeof (v as any).__b64 === 'string') out[k] = Buffer.from((v as any).__b64, 'base64');
  return out;
}

export function exportAllDocuments(db: DB): DocumentExport {
  const docs = db.prepare('SELECT * FROM documents').all() as Array<Record<string, unknown>>;
  return {
    format: 'naskahdinas-documents', version: 1, exported_at: now(),
    documents: docs.map((raw) => ({ record: encodeBlobs(raw), versions: db.prepare('SELECT * FROM document_versions WHERE document_id = ?').all(raw.id as string) as Array<Record<string, unknown>> }))
  };
}

/** Gabungkan arsip dari backup parsial: dokumen yang id-nya sudah ada dilewati. */
export function importDocuments(db: DB, payload: DocumentExport): number {
  let count = 0;
  db.transaction(() => {
    for (const { record, versions } of payload.documents) {
      if (db.prepare('SELECT 1 FROM documents WHERE id = ?').get(record.id as string)) continue;
      const catOk = record.category_id && db.prepare('SELECT 1 FROM categories WHERE id = ?').get(record.category_id as string);
      const tplOk = record.template_id && db.prepare('SELECT 1 FROM templates WHERE id = ?').get(record.template_id as string);
      const r = { ...decodeBlobs(record), category_id: catOk ? record.category_id : null, template_id: tplOk ? record.template_id : null };
      const cols = Object.keys(r);
      db.prepare(`INSERT INTO documents (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(r) as any[]);
      for (const v of versions) {
        const vc = Object.keys(v);
        db.prepare(`INSERT OR IGNORE INTO document_versions (${vc.join(',')}) VALUES (${vc.map(() => '?').join(',')})`).run(...Object.values(v) as any[]);
      }
      count++;
    }
  })();
  return count;
}

// ---------- settings ----------
export function getSettings(db: DB): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>) out[r.key] = r.value;
  return out;
}
export function setSettings(db: DB, values: Record<string, string>) {
  const up = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at');
  db.transaction(() => { for (const [k, v] of Object.entries(values)) up.run(k, v, now()); })();
}
export function getRawSetting(db: DB, key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function deleteSetting(db: DB, key: string) { db.prepare('DELETE FROM settings WHERE key = ?').run(key); }

// ---------- stats & backup history ----------
export function getStats(db: DB): Stats {
  const one = (sql: string, ...a: any[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const d = new Date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const recent = listDocuments(db, { sortBy: 'created_at', sortDir: 'desc' }, 5);
  return {
    totalDocuments: one('SELECT COUNT(*) n FROM documents'),
    totalTemplates: one('SELECT COUNT(*) n FROM templates'),
    activeDrafts: one("SELECT COUNT(*) n FROM documents WHERE status='draft'"),
    documentsThisMonth: one("SELECT COUNT(*) n FROM documents WHERE strftime('%Y-%m', created_at, 'localtime') = ?", ym),
    lastDocument: recent[0] ?? null,
    recentDocuments: recent,
    favoriteTemplates: listTemplates(db, { favoriteOnly: true, activeOnly: true })
  };
}

export function addBackupHistory(db: DB, r: Omit<BackupRecord, 'id' | 'created_at'>) {
  db.prepare('INSERT INTO backup_history (id, path, size_bytes, type, note, created_at) VALUES (?,?,?,?,?,?)').run(uid(), r.path, r.size_bytes, r.type, r.note, now());
}
export function listBackupHistory(db: DB, limit = 20): BackupRecord[] {
  return db.prepare('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT ?').all(limit) as BackupRecord[];
}
