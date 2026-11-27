import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type DB } from '../electron/main/db';
import { LATEST_SCHEMA, currentVersion, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import * as repo from '../electron/main/repo';
import * as svc from '../electron/main/importer-service';
import { Zip, sha256 } from '../electron/main/ooxml/zip';
import { scanPart } from '../electron/main/ooxml/scan';

const FX = path.join(__dirname, 'fixtures');
const read = (f: string) => fs.readFileSync(path.join(FX, f));
let db: DB;
beforeEach(() => { db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); });
afterEach(() => db.close());

function importAndSave(file: string, confirmAll = true) {
  const id = svc.importDocx(db, read(file), file);
  const rv = svc.getReview(db, id);
  const mappings = rv.analysis.mappings.map((m) => (confirmAll && m.status === 'confirm' ? { ...m, status: 'confirmed' as const } : m));
  const groups = rv.analysis.groups.map((g) => ({ ...g, status: 'confirmed' as const }));
  const input = { id, mappings, groups, name: 'Uji ' + file, description: '', category_id: rv.summary.category_id, protected_keys: [] as string[] };
  svc.saveReview(db, input);
  const templateId = svc.saveAsTemplate(db, id);
  return { id, templateId, mappings, groups };
}
/** Nilai lengkap: default tiap isian wajib + override (validasi menolak placeholder yang belum terisi). */
const vals = (templateId: string, over: Record<string, string> = {}) => {
  const t = repo.getTemplate(db, templateId)!;
  const v: Record<string, string> = {};
  for (const f of t.fields) v[f.key] = f.default_value || (f.required ? 'x' : '');
  return { ...v, ...over };
};
const bodyText = (z: Zip) => scanPart('word/document.xml', z.text('word/document.xml') as string).paras.map((p) => p.text);

describe('migrasi v2', () => {
  it('versi skema terbaru dan tabel baru ada', () => {
    expect(currentVersion(db)).toBe(LATEST_SCHEMA);
    for (const t of ['imported_templates', 'template_mappings', 'template_assets']) expect(!!db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t)).toBe(true);
    const cols = (db.prepare('PRAGMA table_info(templates)').all() as any[]).map((c) => c.name);
    expect(cols).toContain('kind');
    expect((db.prepare('PRAGMA table_info(documents)').all() as any[]).map((c) => c.name)).toContain('docx_blob');
  });
  it('template lama tetap kind=editor', () => {
    const t = repo.listTemplates(db);
    expect(t.length).toBeGreaterThan(0);
    expect(t.every((x) => x.kind === 'editor')).toBe(true);
  });
});

describe('impor DOCX', () => {
  it('menyimpan sumber persis dan menolak perubahan sumber', () => {
    const buf = read('01_surat_satu_halaman.docx');
    const id = svc.importDocx(db, buf, '01.docx');
    const row = db.prepare('SELECT original_blob, original_sha256 FROM imported_templates WHERE id=?').get(id) as any;
    expect(Buffer.compare(row.original_blob, buf)).toBe(0);
    expect(row.original_sha256).toBe(sha256(buf));
    expect(() => db.prepare('UPDATE imported_templates SET original_blob = ? WHERE id = ?').run(Buffer.from('x'), id)).toThrow(/tidak boleh diubah/);
    expect(() => db.prepare('UPDATE imported_templates SET original_sha256 = ? WHERE id = ?').run('x', id)).toThrow();
  });
  it('menolak berkas bukan DOCX', () => {
    expect(() => svc.importDocx(db, Buffer.from('bukan docx sama sekali'), 'x.docx')).toThrow(/bukan dokumen Word/);
    expect(() => svc.importDocx(db, Buffer.alloc(0), 'x.docx')).toThrow();
  });
  it('review memuat pemetaan dan ringkasan', () => {
    const id = svc.importDocx(db, read('01_surat_satu_halaman.docx'), '01.docx');
    const rv = svc.getReview(db, id);
    expect(rv.summary.auto_count).toBeGreaterThan(5);
    expect(rv.summary.confirm_count).toBeGreaterThan(0);
    expect(rv.analysis.paras.length).toBeGreaterThan(5);
    expect(svc.listImports(db).length).toBe(1);
  });
  it('analisis ulang mengganti pemetaan hasil edit', () => {
    const id = svc.importDocx(db, read('01_surat_satu_halaman.docx'), '01.docx');
    const rv = svc.getReview(db, id);
    svc.saveReview(db, { id, mappings: rv.analysis.mappings.slice(0, 2), groups: [], name: 'x', description: '', category_id: null, protected_keys: [] });
    expect(svc.getReview(db, id).analysis.mappings.length).toBe(2);
    svc.reanalyze(db, id);
    expect(svc.getReview(db, id).analysis.mappings.length).toBe(rv.analysis.mappings.length);
  });
});

describe('versi template, area terlindungi, validasi ekspor', () => {
  it('menyimpan ulang membuat versi baru; restore memulihkan pemetaan lama', () => {
    const { id, mappings, groups } = importAndSave('01_surat_satu_halaman.docx');
    expect(svc.getReview(db, id).versions.length).toBe(1);
    const fewer = mappings.filter((m) => m.placeholder_name !== 'PERIHAL' || m.status === 'rejected').concat([]).map((m) => (m.placeholder_name === 'PERIHAL' ? { ...m, status: 'rejected' as const } : m));
    svc.saveReview(db, { id, mappings: fewer, groups, name: 'v2', description: '', category_id: null, protected_keys: [] });
    const tid = svc.saveAsTemplate(db, id);
    expect(repo.getTemplate(db, tid)!.fields.map((f) => f.key)).not.toContain('PERIHAL');
    const rv = svc.getReview(db, id);
    expect(rv.versions.map((v) => v.version_no)).toEqual([2, 1]);
    svc.restoreVersion(db, id, rv.versions.find((v) => v.version_no === 1)!.id);
    expect(repo.getTemplate(db, tid)!.fields.map((f) => f.key)).toContain('PERIHAL');
    expect(svc.getReview(db, id).versions.length).toBe(3);
  });
  it('mapping manual di header/footer atau paragraf terkunci ditolak', () => {
    const id = svc.importDocx(db, read('06_header_footer.docx'), '06.docx');
    const rv = svc.getReview(db, id);
    const hf = rv.analysis.paras.find((p) => p.part !== 'word/document.xml' && p.text.trim())!;
    const m = { ...rv.analysis.mappings[0], id: 'aaaaaaaa-0000-0000-0000-000000000000', part: hf.part, para_index: hf.index, start: 0, end: hf.text.length, source_text: hf.text, status: 'manual' as const, confidence: 1 };
    const base = { id, groups: [], name: 'x', description: '', category_id: null };
    expect(() => svc.saveReview(db, { ...base, mappings: [m], protected_keys: [] })).toThrow(/terlindungi/);
    const body = rv.analysis.mappings[0];
    expect(() => svc.saveReview(db, { ...base, mappings: [body], protected_keys: [`${body.part}#${body.para_index}`] })).toThrow(/terlindungi/);
  });
  it('ekspor dihentikan bila berkas tersimpan berubah dari hasil validasi', () => {
    const { templateId } = importAndSave('03_kop_logo.docx');
    const doc = svc.createDocxDocument(db, { template_id: templateId, title: 'V', values: vals(templateId), category_id: null, template_name: 'T', doc_date: '', letter_number: '', recipient: '', subject: '' });
    expect(svc.verifyForExport(db, doc.id).ok).toBe(true);
    db.prepare('UPDATE documents SET docx_blob = ? WHERE id = ?').run(Buffer.concat([svc.getDocumentDocx(db, doc.id).buf as Buffer, Buffer.from('x')]), doc.id);
    expect(() => svc.verifyForExport(db, doc.id)).toThrow(/berbeda dari hasil validasi/);
  });
  it('placeholder wajib kosong → pembuatan dokumen ditolak oleh validasi', () => {
    const { templateId } = importAndSave('01_surat_satu_halaman.docx');
    expect(() => svc.createDocxDocument(db, { template_id: templateId, title: 'V', values: {}, category_id: null, template_name: 'T', doc_date: '', letter_number: '', recipient: '', subject: '' })).toThrow(/Validasi dokumen gagal/);
  });
  it('token {{BLOCK:NAMA}} dikenali sebagai blok multi-baris', () => {
    const z = read && Zip.read(read('01_surat_satu_halaman.docx'));
    z.set('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{BLOCK:DAFTAR_PESERTA}}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
    const id = svc.importDocx(db, z.toBuffer(), 'blok.docx');
    const m = svc.getReview(db, id).analysis.mappings[0];
    expect(m.placeholder_name).toBe('BLOCK_DAFTAR_PESERTA');
    expect(m.field_type).toBe('textarea');
  });
});

describe('backup parsial dokumen DOCX', () => {
  it('docx_blob selamat melewati export JSON → import', () => {
    const { templateId } = importAndSave('01_surat_satu_halaman.docx');
    const doc = svc.createDocxDocument(db, { template_id: templateId, title: 'B', values: vals(templateId, { PERIHAL: 'Backup' }), category_id: null, template_name: 'T', doc_date: '', letter_number: '', recipient: '', subject: '' });
    const json = JSON.parse(JSON.stringify(repo.exportAllDocuments(db)));
    const db2 = openDatabase(':memory:'); runMigrations(db2); seedDefaults(db2);
    expect(repo.importDocuments(db2, json)).toBe(1);
    const a = svc.getDocumentDocx(db, doc.id); const b = svc.getDocumentDocx(db2, doc.id);
    expect(b.kind).toBe('docx');
    expect(Buffer.compare(a.buf as Buffer, b.buf as Buffer)).toBe(0);
    db2.close();
  });
});

describe('template DOCX → dokumen', () => {
  it('template tersimpan kind=docx dengan field dari pemetaan', () => {
    const { templateId } = importAndSave('01_surat_satu_halaman.docx');
    const t = repo.getTemplate(db, templateId)!;
    expect(t.kind).toBe('docx');
    expect(t.fields.map((f) => f.key)).toContain('PERIHAL');
    expect(t.fields.find((f) => f.key === 'TANGGAL_SURAT')?.type).toBe('date');
  });
  it('generate mengisi nilai baru tanpa mengubah template/sumber', () => {
    const { id, templateId } = importAndSave('01_surat_satu_halaman.docx');
    const adaptedBefore = (db.prepare('SELECT adapted_blob FROM imported_templates WHERE id=?').get(id) as any).adapted_blob as Buffer;
    const doc = svc.createDocxDocument(db, { template_id: templateId, title: 'Surat Uji', values: vals(templateId, { PERIHAL: 'Perihal Baru', NOMOR_SURAT: 'B-999/X/2026', TANGGAL_SURAT: '24 November 2026' }), category_id: null, template_name: 'T', doc_date: '2026-11-24', letter_number: 'B-999/X/2026', recipient: '', subject: 'Perihal Baru' });
    expect(doc.source_kind).toBe('docx');
    expect(doc.docx_state).toBe('pristine');
    const out = svc.getDocumentDocx(db, doc.id);
    const txt = bodyText(Zip.read(out.buf as Buffer)).join('\n');
    expect(txt).toContain('Perihal Baru');
    expect(txt).toContain('B-999/X/2026');
    expect(txt).not.toContain('Permohonan Rapat Pembahasan IP HUB');
    const adaptedAfter = (db.prepare('SELECT adapted_blob FROM imported_templates WHERE id=?').get(id) as any).adapted_blob as Buffer;
    expect(Buffer.compare(adaptedBefore, adaptedAfter)).toBe(0);
    expect(sha256((db.prepare('SELECT original_blob FROM imported_templates WHERE id=?').get(id) as any).original_blob)).toBe(sha256(read('01_surat_satu_halaman.docx')));
  });
  it('isian tanggal ISO ditulis dalam format Indonesia', () => {
    const { templateId } = importAndSave('01_surat_satu_halaman.docx');
    const g = svc.generateFromTemplate(db, templateId, { TANGGAL_SURAT: '2026-12-01' });
    expect(bodyText(g.zip).join('\n')).toContain('1 Desember 2026');
  });
  it('dokumen lama tidak terpengaruh saat template dihapus', () => {
    const { templateId } = importAndSave('01_surat_satu_halaman.docx');
    const doc = svc.createDocxDocument(db, { template_id: templateId, title: 'A', values: vals(templateId), category_id: null, template_name: 'T', doc_date: '', letter_number: '', recipient: '', subject: '' });
    repo.deleteTemplate(db, templateId);
    expect(svc.getDocumentDocx(db, doc.id).buf).toBeTruthy();
    expect(repo.getDocument(db, doc.id)?.template_id).toBeNull();
  });
  it('menyunting di editor menandai docx_state=edited; regenerasi memulihkan', () => {
    const { templateId } = importAndSave('01_surat_satu_halaman.docx');
    const doc = svc.createDocxDocument(db, { template_id: templateId, title: 'A', values: vals(templateId, { PERIHAL: 'P1' }), category_id: null, template_name: 'T', doc_date: '', letter_number: '', recipient: '', subject: '' });
    const { id: _i, category_name: _a, category_code: _b, created_at: _c, updated_at: _d, source_kind: _s, docx_state: _x, ...rest } = doc;
    repo.saveDocument(db, { ...rest, id: doc.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'diubah' }] }] } } as any);
    expect(svc.getDocumentDocx(db, doc.id).state).toBe('edited');
    svc.regenerateDocxDocument(db, doc.id, vals(templateId, { PERIHAL: 'P2' }));
    const s = svc.getDocumentDocx(db, doc.id);
    expect(s.state).toBe('pristine');
    expect(bodyText(Zip.read(s.buf as Buffer)).join('\n')).toContain('P2');
  });
  it('baris tabel berulang mengikuti jumlah data', () => {
    const { templateId } = importAndSave('04_surat_tabel.docx');
    const info = svc.getDocxTemplateInfo(db, templateId)!;
    expect(info.groups[0].name).toBe('PEGAWAI');
    const rows = [{ NAMA: 'A', NIP: '1', JABATAN: 'X' }, { NAMA: 'B', NIP: '2', JABATAN: 'Y' }, { NAMA: 'C', NIP: '3', JABATAN: 'Z' }, { NAMA: 'D', NIP: '4', JABATAN: 'W' }, { NAMA: 'E', NIP: '5', JABATAN: 'V' }];
    const g = svc.generateFromTemplate(db, templateId, { '@PEGAWAI': JSON.stringify(rows) });
    const t = bodyText(g.zip);
    expect(t).toContain('E');
    expect(t).toContain('5');
    expect(g.unresolved).not.toContain('PEGAWAI');
  });
  it('perbandingan: format terjaga, tanpa peringatan merah untuk fixture sederhana', () => {
    const { id } = importAndSave('03_kop_logo.docx');
    const c = svc.compare(db, id);
    expect(c.report.format_preserved).toBe(true);
    expect(c.generated_diff.length).toBe(0);
    expect(c.adapted_diff.length).toBeGreaterThan(0);
    expect(c.adapted_tokens).toContain('NOMOR_SURAT');
    expect(c.report.notes.filter((n) => n.level === 'warn')).toEqual([]);
  });
  it('restore sumber: adaptasi dibuang dan pemetaan dianalisis ulang', () => {
    const { id } = importAndSave('01_surat_satu_halaman.docx');
    svc.restoreSource(db, id);
    expect((db.prepare('SELECT adapted_blob FROM imported_templates WHERE id=?').get(id) as any).adapted_blob).toBeNull();
    expect(svc.getReview(db, id).summary.import_status).toBe('analyzed');
  });
  it('hapus impor (beserta template) membersihkan semua tabel terkait', () => {
    const { id, templateId } = importAndSave('01_surat_satu_halaman.docx');
    svc.deleteImport(db, id, true);
    expect(db.prepare('SELECT 1 FROM template_mappings WHERE imported_template_id=?').get(id)).toBeUndefined();
    expect(repo.getTemplate(db, templateId)).toBeNull();
  });
  it('menolak menyimpan template tanpa isian', () => {
    const id = svc.importDocx(db, read('01_surat_satu_halaman.docx'), '01.docx');
    const rv = svc.getReview(db, id);
    svc.saveReview(db, { id, mappings: [], groups: [], name: 'x', description: '', category_id: null, protected_keys: [] });
    void rv;
    expect(() => svc.saveAsTemplate(db, id)).toThrow(/Belum ada isian/);
  });
});
