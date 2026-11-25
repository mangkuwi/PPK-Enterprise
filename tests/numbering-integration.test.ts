import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import * as repo from '../electron/main/repo';
import * as svc from '../electron/main/importer-service';
import { Zip } from '../electron/main/ooxml/zip';
import type { Actor } from '../shared/numbering';
import { createUser, listUsers } from '../electron/main/numbering/users';
import { ensureDefaultMappings, getRegister, setTemplateMap } from '../electron/main/numbering/registers';
import { applyToValues, bindDocument, contextForTemplate, documentNumbering, forcedValuesForDocument, onDocumentDeleting, onDocumentStatus, releaseDraft, selectNumber } from '../electron/main/numbering/integration';
import { createManual, documentsReferencing, generateBatch, getRecord, issueNumber, queryRecords, recordEvents } from '../electron/main/numbering/records';

const FX = path.join(__dirname, 'fixtures');
let db: DB; let admin: Actor; let op: Actor;
beforeEach(() => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); ensureDefaultMappings(db);
  const a = listUsers(db).find((u) => u.role === 'admin')!; admin = { id: a.id, name: a.name, role: 'admin' };
  const u = createUser(db, admin, { name: 'Budi', role: 'operator' }); op = { id: u.id, name: u.name, role: 'operator' };
});
afterEach(() => db.close());
const err = (fn: () => unknown): string => { try { fn(); } catch (e) { return `${(e as { code?: string }).code}:${(e as Error).message}`; } return 'NO_ERROR'; };
/** Alur baru: nomor dibuat lebih dulu di bank, lalu dipilih untuk draf. Pembantu ini = generate 1 nomor + pilih. */
const reserveForTemplate = (d: DB, who: Actor, templateId: string, date: string) => {
  const ctx = contextForTemplate(d, templateId);
  if (!ctx.register) return null;
  const rec = generateBatch(d, who, { register_id: ctx.register.id, number_date: date, quantity: 1 }).records[0];
  return { record: selectNumber(d, who, templateId, rec.id), context: ctx };
};
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

/** Impor fixture → simpan sebagai template; rename: kunci lama → kunci baru. */
function makeTemplate(file: string, rename: Record<string, string> = {}, regCode?: string) {
  const f = fs.readdirSync(FX).find((x) => x.startsWith(file))!;
  const id = svc.importDocx(db, fs.readFileSync(path.join(FX, f)), f);
  const rv = svc.getReview(db, id);
  const mappings = rv.analysis.mappings.map((m) => ({ ...m, status: m.status === 'confirm' ? 'confirmed' as const : m.status, placeholder_name: rename[m.placeholder_name] ?? m.placeholder_name }));
  const groups = rv.analysis.groups.map((g) => ({ ...g, status: 'confirmed' as const }));
  svc.saveReview(db, { id, mappings, groups, name: `Tpl ${file}`, description: '', category_id: null, protected_keys: [] });
  const templateId = svc.saveAsTemplate(db, id);
  if (regCode) setTemplateMap(db, admin, templateId, getRegister(db, regCode).id);
  return templateId;
}
const baseValues = (templateId: string): Record<string, string> => {
  const v: Record<string, string> = {};
  for (const f of repo.getTemplate(db, templateId)!.fields) v[f.key] = f.default_value || (f.required ? 'isi' : '');
  return v;
};
const docXml = (docId: string) => (Zip.read(svc.getDocumentDocx(db, docId).buf as Buffer).text('word/document.xml') as string);
const plain = (xml: string) => xml.replace(/<[^>]+>/g, '');

describe('Surat Keluar (DOCX)', () => {
  it('konteks: register, kunci nomor & tanggal terdeteksi dari template', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const c = contextForTemplate(db, t);
    expect(c.register!.code).toBe('SURAT_KELUAR');
    expect(c.own_keys).toEqual(['NOMOR_SURAT']); expect(c.date_key).toBe('TANGGAL_SURAT'); expect(c.party_key).toBe('TUJUAN_SURAT');
  });
  it('alur lengkap: pesan → isi DOCX → tautkan → terbitkan; nomor palsu dari klien diabaikan', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const res = reserveForTemplate(db, op, t, '2026-06-15')!;
    expect(res.record.status).toBe('assigned');
    const spoof = { ...baseValues(t), NOMOR_SURAT: '999/PALSU/2026', TANGGAL_SURAT: '2020-01-01', PERIHAL: 'Undangan Rapat', TUJUAN_SURAT: 'PT Mitra' };
    const ap = applyToValues(db, t, res.record.id, spoof, []);
    expect(ap.values.NOMOR_SURAT).toBe(res.record.number_text); expect(ap.values.TANGGAL_SURAT).toBe('2026-06-15');
    const doc = svc.createDocxDocument(db, { template_id: t, title: 'Undangan Rapat', values: ap.values, category_id: null, template_name: 'T', doc_date: '2026-06-15', letter_number: ap.values.NOMOR_SURAT, recipient: 'PT Mitra', subject: 'Undangan Rapat' });
    const b = bindDocument(db, op, { record_id: res.record.id, document_id: doc.id, values: ap.values, refs: [], template_id: t });
    expect(b.in_content).toBe(true);
    const text = plain(docXml(doc.id));
    expect(text).toContain('1501'); expect(text).not.toContain('PALSU');
    expect(text).toContain('Juni 2026');
    const rec = getRecord(db, res.record.id);
    expect(rec.document_id).toBe(doc.id); expect(rec.counterparty).toBe('PT Mitra'); expect(rec.subject).toBe('Undangan Rapat'); expect(rec.status).toBe('assigned');
    expect(repo.getDocument(db, doc.id)!.letter_number).toBe(rec.number_text);
    // finalisasi → terbit; riwayat tercatat
    expect(onDocumentStatus(db, op, doc.id, 'review')).toBeNull();
    expect(onDocumentStatus(db, op, doc.id, 'final')!.status).toBe('issued');
    expect(recordEvents(db, rec.id).map((e) => e.event)).toEqual(['generated', 'assigned', 'linked', 'issued']);
    expect(documentNumbering(db, doc.id).record!.number_text).toBe(rec.number_text);
  });
  it('regenerate memaksa nomor tertaut walau nilai formulir diubah', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const r = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    const ap = applyToValues(db, t, r.id, baseValues(t), []);
    const doc = svc.createDocxDocument(db, { template_id: t, title: 'A', values: ap.values, category_id: null, template_name: 'T', doc_date: '2026-06-15', letter_number: '', recipient: '', subject: '' });
    bindDocument(db, op, { record_id: r.id, document_id: doc.id, values: ap.values, refs: [], template_id: t });
    const forced = forcedValuesForDocument(db, doc.id, t, { ...ap.values, NOMOR_SURAT: '5/LAIN/2026', TANGGAL_SURAT: '2031-01-01' });
    expect(forced.NOMOR_SURAT).toBe(r.number_text); expect(forced.TANGGAL_SURAT).toBe('2026-06-15');
    svc.regenerateDocxDocument(db, doc.id, forced);
    expect(plain(docXml(doc.id))).toContain(r.number_text);
  });
  it('dokumen satu nomor; nomor tidak bisa diganti atau dipakai dokumen lain', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const r1 = reserveForTemplate(db, op, t, '2026-06-15')!.record; const r2 = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    const v = baseValues(t);
    const d1 = svc.createDocxDocument(db, { template_id: t, title: 'A', values: applyToValues(db, t, r1.id, v, []).values, category_id: null, template_name: 'T', doc_date: '2026-06-15', letter_number: '', recipient: '', subject: '' });
    bindDocument(db, op, { record_id: r1.id, document_id: d1.id, values: v, refs: [], template_id: t });
    expect(err(() => bindDocument(db, op, { record_id: r2.id, document_id: d1.id, values: v, refs: [], template_id: t }))).toContain('LINKED');
    expect(err(() => applyToValues(db, t, r1.id, v, []))).toContain('LINKED');
  });
  it('template tanpa register tidak memesan nomor', () => {
    const t = makeTemplate('04_');
    expect(reserveForTemplate(db, op, t, '2026-06-15')).toBeNull();
    expect(count('SELECT COUNT(*) n FROM number_records')).toBe(0);
  });
});

describe('Berita Acara merujuk Kontrak', () => {
  const setup = () => {
    const t = makeTemplate('01_', { NOMOR_SURAT: 'NOMOR_BA', SIFAT: 'NOMOR_KONTRAK' }, 'BERITA_ACARA');
    const k = createManual(db, admin, { register_id: getRegister(db, 'KONTRAK').id, number_date: '2026-02-01', seq: 12, subject: 'Pengadaan Satelit', counterparty: 'PT K' });
    return { t, k };
  };
  it('kolom rujukan terdeteksi; nomor kontrak diisi tanpa alokasi baru', () => {
    const { t, k } = setup();
    const c = contextForTemplate(db, t);
    expect(c.own_keys).toEqual(['NOMOR_BA']); expect(c.ref_fields.map((f) => f.key)).toEqual(['NOMOR_KONTRAK']);
    const r = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    expect(r.register_code).toBe('BERITA_ACARA');
    const ap = applyToValues(db, t, r.id, baseValues(t), [{ key: 'NOMOR_KONTRAK', record_id: k.id }]);
    expect(ap.values.NOMOR_KONTRAK).toBe(k.number_text);
    const doc = svc.createDocxDocument(db, { template_id: t, title: 'BA', values: ap.values, category_id: null, template_name: 'T', doc_date: '2026-06-15', letter_number: '', recipient: '', subject: '' });
    bindDocument(db, op, { record_id: r.id, document_id: doc.id, values: ap.values, refs: [{ key: 'NOMOR_KONTRAK', record_id: k.id }], template_id: t });
    const text = plain(docXml(doc.id));
    expect(text).toContain(r.number_text); expect(text).toContain(k.number_text);
    expect(count(`SELECT COUNT(*) n FROM number_records WHERE register_id='${getRegister(db, 'KONTRAK').id}'`)).toBe(1);
    expect(count('SELECT COUNT(*) n FROM document_number_refs')).toBe(1);
    expect(documentsReferencing(db, k.id)).toEqual([{ document_id: doc.id, title: 'BA', key: 'NOMOR_KONTRAK' }]);
    expect(documentNumbering(db, doc.id).refs[0].record.id).toBe(k.id);
    const forced = forcedValuesForDocument(db, doc.id, t, { ...ap.values, NOMOR_KONTRAK: 'palsu' });
    expect(forced.NOMOR_KONTRAK).toBe(k.number_text);
  });
  it('rujukan salah register / kolom bukan rujukan / nomor batal ditolak', () => {
    const { t, k } = setup();
    const r = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    const nd = createManual(db, admin, { register_id: getRegister(db, 'NOTA_DINAS').id, number_date: '2026-02-01' });
    expect(err(() => applyToValues(db, t, r.id, baseValues(t), [{ key: 'NOMOR_KONTRAK', record_id: nd.id }]))).toContain('bukan dari register');
    expect(err(() => applyToValues(db, t, r.id, baseValues(t), [{ key: 'PERIHAL', record_id: k.id }]))).toContain('bukan kolom rujukan');
    const pending = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    expect(err(() => applyToValues(db, t, pending.id, baseValues(t), []))).toBe('NO_ERROR');
    const kres = db.prepare("SELECT id FROM number_registers WHERE code='KONTRAK'").get() as { id: string };
    const resK = createManual(db, admin, { register_id: kres.id, number_date: '2026-03-01' });
    expect(resK.status).toBe('issued');
    // nomor milik register lain tidak dapat dipakai sebagai nomor dokumen ini
    expect(err(() => applyToValues(db, t, k.id, baseValues(t), []))).toContain('register lain');
  });
});

describe('siklus dokumen', () => {
  it('hapus dokumen draf: nomor kembali AVAILABLE (bukan void); nomor terbit tetap', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const mk = () => {
      const r = reserveForTemplate(db, op, t, '2026-06-15')!.record; const v = baseValues(t);
      const d = svc.createDocxDocument(db, { template_id: t, title: 'A', values: applyToValues(db, t, r.id, v, []).values, category_id: null, template_name: 'T', doc_date: '2026-06-15', letter_number: '', recipient: '', subject: '' });
      bindDocument(db, op, { record_id: r.id, document_id: d.id, values: v, refs: [], template_id: t }); return { r, d };
    };
    const a = mk(); const b = mk();
    onDocumentStatus(db, op, b.d.id, 'final');
    for (const x of [a, b]) { onDocumentDeleting(db, op, x.d.id); repo.deleteDocument(db, x.d.id); }
    const ra = getRecord(db, a.r.id); const rb = getRecord(db, b.r.id);
    expect(ra.status).toBe('available'); expect(ra.document_id).toBeNull(); expect(ra.released_count).toBe(1); expect(ra.void_reason).toBeNull();
    expect(rb.status).toBe('issued'); expect(rb.document_id).toBeNull();
    expect(count('SELECT COUNT(*) n FROM number_records')).toBe(2);
  });
  it('ganti pilihan nomor: nomor lama kembali AVAILABLE, nomor baru ASSIGNED, tanpa membuat nomor baru', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const rid = getRegister(db, 'SURAT_KELUAR').id;
    const [a, b] = generateBatch(db, op, { register_id: rid, number_date: '2026-07-02', quantity: 2 }).records;
    selectNumber(db, op, t, a.id);
    const n = selectNumber(db, op, t, b.id, a.id);
    expect(n.status).toBe('assigned'); expect(getRecord(db, a.id).status).toBe('available');
    expect(count('SELECT COUNT(*) n FROM number_records')).toBe(2); // tidak ada nomor baru
    // pilihan baru gagal → nomor lama tidak terlepas (transaksi utuh)
    expect(err(() => selectNumber(db, op, t, a.id, 'tidak-ada'))).toContain('NOT_FOUND');
    expect(getRecord(db, b.id).status).toBe('assigned');
    // formulir ditinggalkan → dilepas, bukan dibatalkan
    expect(releaseDraft(db, op, b.id).status).toBe('available');
    expect(releaseDraft(db, op, b.id).status).toBe('available'); // idempoten
  });
  it('tidak ada nomor otomatis: membuka konteks template tidak membuat catatan apa pun', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    contextForTemplate(db, t);
    expect(count('SELECT COUNT(*) n FROM number_records')).toBe(0);
    // tanpa memilih nomor, nomor tidak dapat dipaksakan ke dokumen
    const rec = generateBatch(db, op, { register_id: getRegister(db, 'SURAT_KELUAR').id, number_date: '2026-07-02', quantity: 1 }).records[0];
    expect(err(() => applyToValues(db, t, rec.id, baseValues(t), []))).toContain('belum dipilih');
  });
  it('batas harian: pemesanan ke-100 untuk template yang sama ditolak jelas, pesanan lain utuh', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    for (let i = 1; i <= 99; i++) reserveForTemplate(db, op, t, '2026-11-24');
    const e = err(() => reserveForTemplate(db, op, t, '2026-11-24'));
    expect(e).toContain('LIMIT'); expect(e).toContain('Administrator');
    expect(count("SELECT COUNT(*) n FROM number_records WHERE number_date='2026-11-24'")).toBe(99);
  });
  it('editor: nomor tertaut ke dokumen; peringatan bila nomor tidak ada di isi', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const r = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    const doc = repo.saveDocument(db, { template_id: null, template_name: 'x', category_id: null, title: 'Surat X', letter_number: r.number_text, recipient: 'Pak A', subject: 'Hal', doc_date: '2026-06-15', status: 'draft',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Tanpa nomor di isi' }] }] }, header_text: '', footer_text: '', layout: repo.getSettings(db) as never, form_values: {}, use_kop: true } as never);
    const b = bindDocument(db, op, { record_id: r.id, document_id: doc.id, values: {}, refs: [], template_id: t });
    expect(b.in_content).toBe(false); expect(b.record.document_id).toBe(doc.id); expect(b.record.counterparty).toBe('Pak A');
  });
  it('penyimpanan ulang dokumen: rujukan tetap; status final menerbitkan nomor; tanggal/nomor dikunci', () => {
    const t = makeTemplate('01_', { NOMOR_SURAT: 'NOMOR_BA', SIFAT: 'NOMOR_KONTRAK' }, 'BERITA_ACARA');
    const k = createManual(db, admin, { register_id: getRegister(db, 'KONTRAK').id, number_date: '2026-02-01', seq: 3 });
    const r = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    const refs = [{ key: 'NOMOR_KONTRAK', record_id: k.id }];
    const mk = (over: object) => repo.saveDocument(db, { id: docId, template_id: null, template_name: 'x', category_id: null, title: 'BA', letter_number: 'diketik-manual', recipient: '', subject: '', doc_date: '2030-01-01', status: 'draft',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: r.number_text }] }] }, header_text: '', footer_text: '', layout: repo.getSettings(db) as never, form_values: {}, use_kop: true, ...over } as never);
    let docId: string | undefined;
    docId = mk({}).id;
    bindDocument(db, op, { record_id: r.id, document_id: docId, values: {}, refs, template_id: t });
    mk({ status: 'final' });
    const b2 = bindDocument(db, op, { record_id: r.id, document_id: docId, values: {}, template_id: t });
    expect(b2.record.status).toBe('issued'); expect(b2.in_content).toBe(true);
    expect(documentNumbering(db, docId).refs).toHaveLength(1);
    const d = repo.getDocument(db, docId)!;
    expect(d.letter_number).toBe(r.number_text); expect(d.doc_date).toBe('2026-06-15');
  });
  it('daftar register menampilkan dokumen tertaut', () => {
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const r = reserveForTemplate(db, op, t, '2026-06-15')!.record; const v = baseValues(t);
    const d = svc.createDocxDocument(db, { template_id: t, title: 'Judul Dok', values: applyToValues(db, t, r.id, v, []).values, category_id: null, template_name: 'T', doc_date: '2026-06-15', letter_number: '', recipient: '', subject: '' });
    bindDocument(db, op, { record_id: r.id, document_id: d.id, values: v, refs: [], template_id: t });
    const rows = queryRecords(db, { register_id: r.register_id }).rows;
    expect(rows[0].document_title).toBe('Judul Dok'); expect(rows[0].document_id).toBe(d.id);
    expect(issueNumber(db, op, r.id).status).toBe('issued');
  });
});

describe('AI tidak membuat nomor resmi', () => {
  it('modul AI tidak mengimpor penomoran dan nomor tak dapat disisipkan lewat nilai formulir', () => {
    const root = fs.existsSync(path.join(__dirname, '..', 'shared', 'ai-guard.ts')) ? path.join(__dirname, '..') : (process.env.REPO_ROOT as string); // REPO_ROOT: hanya untuk harness sandbox
    for (const f of ['shared/ai-guard.ts', 'electron/ipc/settings.ts']) expect(fs.readFileSync(path.join(root, f), 'utf8')).not.toContain('numbering');
    const t = makeTemplate('01_', {}, 'SURAT_KELUAR');
    const r = reserveForTemplate(db, op, t, '2026-06-15')!.record;
    expect(applyToValues(db, t, r.id, { ...baseValues(t), NOMOR_SURAT: '[ISI_NOMOR] 77/AI/2026' }, []).values.NOMOR_SURAT).toBe(r.number_text);
  });
});
