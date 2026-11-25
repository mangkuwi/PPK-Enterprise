import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type DB } from '../electron/main/db';
import { LATEST_SCHEMA, currentVersion, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import * as repo from '../electron/main/repo';
import { commitFullRestore, createBackup, prepareFullRestore, readManifest, restorePartial } from '../electron/main/backup';
import { generateContent } from '@shared/placeholder';
import { DEFAULT_SETTINGS, layoutFromSettings } from '@shared/settings';
import type { DocumentInput, TipTapNode } from '@shared/types';

let dir: string;
let db: DB;
const layout = layoutFromSettings(DEFAULT_SETTINGS);
const para = (text: string): TipTapNode => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

function fresh(file = ':memory:'): DB {
  const d = openDatabase(file);
  runMigrations(d);
  seedDefaults(d);
  return d;
}

const docInput = (over: Partial<DocumentInput> = {}): DocumentInput => ({
  template_id: null, template_name: '', category_id: null, title: 'Dok Uji', letter_number: 'B-1', recipient: 'Kepala', subject: 'Uji',
  doc_date: '2026-11-23', status: 'draft', content: para('isi awal'), header_text: '', footer_text: '', layout, form_values: {}, use_kop: true, ...over
});

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-test-')); db = fresh(); });
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('skema & seed', () => {
  it('migrasi menetapkan versi skema dan seed hanya berjalan sekali', () => {
    expect(currentVersion(db)).toBe(LATEST_SCHEMA);
    seedDefaults(db);
    expect(repo.listCategories(db)).toHaveLength(10);
    const n = repo.listTemplates(db).length;
    seedDefaults(db);
    expect(repo.listTemplates(db)).toHaveLength(n);
    expect(n).toBeGreaterThanOrEqual(5);
  });

  it('template contoh memiliki placeholder yang terdeteksi', () => {
    const nd = repo.listTemplates(db).find((t) => t.name === 'Nota Dinas Standar')!;
    const full = repo.getTemplate(db, nd.id)!;
    const keys = full.fields.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['NOMOR_SURAT', 'TUJUAN_SURAT', 'PENGIRIM', 'PERIHAL', 'TANGGAL', 'NAMA_PEJABAT', 'JABATAN_PEJABAT']));
    expect(full.fields.find((f) => f.key === 'SIFAT')).toMatchObject({ type: 'select', required: false });
  });

  it('migrasi memanggil beforeMigrate hanya untuk DB lama yang berisi data', () => {
    const file = path.join(dir, 'x.db');
    let called = 0;
    const d = openDatabase(file);
    runMigrations(d, { beforeMigrate: () => called++ });
    expect(called).toBe(0);
    d.close();
  });
});

describe('template vs dokumen', () => {
  it('template dapat dipakai berkali-kali tanpa berubah', () => {
    const t = repo.getTemplate(db, repo.listTemplates(db)[0].id)!;
    const before = JSON.stringify(t.content);
    generateContent(t.content, t.fields, { NOMOR_SURAT: 'X' });
    generateContent(t.content, t.fields, { NOMOR_SURAT: 'Y' });
    expect(JSON.stringify(repo.getTemplate(db, t.id)!.content)).toBe(before);
  });

  it('mengedit template tidak mengubah dokumen lama; menghapus template tidak menghapus dokumen', () => {
    const tid = repo.saveTemplate(db, { category_id: null, name: 'T1', description: '', content: para('[A]'), header_text: '', footer_text: '', layout, is_active: true, fields: [] });
    const t = repo.getTemplate(db, tid)!;
    const doc = repo.saveDocument(db, docInput({ template_id: tid, template_name: 'T1', content: generateContent(t.content, t.fields, { A: 'nilai' }).content }));
    repo.saveTemplate(db, { ...t, content: para('[A] [B] diubah'), fields: t.fields });
    expect(JSON.stringify(repo.getDocument(db, doc.id)!.content)).toContain('nilai');
    expect(JSON.stringify(repo.getDocument(db, doc.id)!.content)).not.toContain('diubah');
    repo.deleteTemplate(db, tid);
    const after = repo.getDocument(db, doc.id)!;
    expect(after.template_id).toBeNull();
    expect(after.template_name).toBe('T1');
  });

  it('duplikasi template membuat identitas baru', () => {
    const src = repo.listTemplates(db)[0];
    const copy = repo.getTemplate(db, repo.duplicateTemplate(db, src.id))!;
    expect(copy.id).not.toBe(src.id);
    expect(copy.name).toContain('(Salinan)');
    expect(copy.fields.length).toBe(src.field_count);
  });

  it('import/export template round-trip', () => {
    const ids = repo.listTemplates(db).map((t) => t.id);
    const payload = repo.exportTemplates(db, ids);
    const other = fresh();
    const before = repo.listTemplates(other).length;
    expect(repo.importTemplates(other, payload)).toBe(ids.length);
    expect(repo.listTemplates(other)).toHaveLength(before + ids.length);
    other.close();
  });
});

describe('arsip dokumen', () => {
  it('menyimpan, mencari, memfilter, dan mengurutkan', () => {
    const cats = repo.listCategories(db);
    repo.saveDocument(db, docInput({ title: 'Alfa', category_id: cats[0].id, content: para('kata-kunci-unik') }));
    repo.saveDocument(db, docInput({ title: 'Beta', category_id: cats[1].id, status: 'final', doc_date: '2026-01-10' }));
    expect(repo.listDocuments(db, { search: 'kata-kunci-unik' }).map((d) => d.title)).toEqual(['Alfa']);
    expect(repo.listDocuments(db, { categoryId: cats[1].id })).toHaveLength(1);
    expect(repo.listDocuments(db, { status: 'final' })[0].title).toBe('Beta');
    expect(repo.listDocuments(db, { dateTo: '2026-06-01' }).map((d) => d.title)).toEqual(['Beta']);
    expect(repo.listDocuments(db, { sortBy: 'title', sortDir: 'asc' }).map((d) => d.title)).toEqual(['Alfa', 'Beta']);
    expect(repo.listDocuments(db, { search: '%' })).toHaveLength(0); // wildcard di-escape
  });

  it('versi dibuat saat isi berubah, dapat dipulihkan, dan duplikasi menghasilkan draft baru', () => {
    const d = repo.saveDocument(db, docInput());
    repo.saveDocument(db, docInput({ id: d.id, title: 'Dok Uji' })); // isi sama -> tidak ada versi baru
    expect(repo.listVersions(db, d.id)).toHaveLength(1);
    repo.saveDocument(db, docInput({ id: d.id, content: para('isi kedua') }));
    const vs = repo.listVersions(db, d.id);
    expect(vs).toHaveLength(2);
    const restored = repo.restoreVersion(db, vs[vs.length - 1].id);
    expect(JSON.stringify(restored.content)).toContain('isi awal');
    expect(repo.listVersions(db, d.id)).toHaveLength(3);
    const copy = repo.duplicateDocument(db, d.id);
    expect(copy.id).not.toBe(d.id);
    expect(copy.status).toBe('draft');
    repo.deleteDocument(db, d.id);
    expect(repo.listVersions(db, d.id)).toHaveLength(0);
  });

  it('statistik dashboard', () => {
    repo.saveDocument(db, docInput());
    const s = repo.getStats(db);
    expect(s.totalDocuments).toBe(1);
    expect(s.documentsThisMonth).toBe(1);
    expect(s.lastDocument?.title).toBe('Dok Uji');
    expect(s.totalTemplates).toBeGreaterThanOrEqual(5);
  });
});

describe('backup & restore', () => {
  it('backup penuh lalu restore ke database lain mengembalikan data', async () => {
    const file = path.join(dir, 'asal.db');
    const src = fresh(file);
    const d = repo.saveDocument(src, docInput({ title: 'Penting' }));
    repo.setSettings(src, { institution_name: 'Instansi X' });
    const zip = path.join(dir, 'b.zip');
    await createBackup(src, 'full', zip);
    expect(readManifest(zip)).toMatchObject({ type: 'full', counts: { documents: 1 } });
    src.close();

    const target = path.join(dir, 'tujuan.db');
    fs.writeFileSync(target, '');
    const tmp = prepareFullRestore(zip, path.join(dir, 'tmp'));
    commitFullRestore(tmp, target);
    const restored = openDatabase(target);
    runMigrations(restored);
    expect(repo.getDocument(restored, d.id)?.title).toBe('Penting');
    expect(repo.getSettings(restored).institution_name).toBe('Instansi X');
    restored.close();
  });

  it('menolak berkas backup yang rusak atau bukan backup', () => {
    const bad = path.join(dir, 'bad.zip');
    fs.writeFileSync(bad, 'bukan zip');
    expect(() => readManifest(bad)).toThrow();
  });

  it('backup parsial template & arsip digabung tanpa menimpa data yang ada', async () => {
    const d = repo.saveDocument(db, docInput({ title: 'Arsip A' }));
    const zDoc = path.join(dir, 'doc.zip'); const zTpl = path.join(dir, 'tpl.zip');
    await createBackup(db, 'documents', zDoc);
    await createBackup(db, 'templates', zTpl);
    const other = fresh();
    const nTpl = repo.listTemplates(other).length;
    expect(restorePartial(other, zDoc)).toMatchObject({ type: 'documents', imported: 1 });
    expect(restorePartial(other, zDoc).imported).toBe(0);
    expect(repo.getDocument(other, d.id)?.title).toBe('Arsip A');
    expect(restorePartial(other, zTpl).imported).toBe(0); // template dengan id sama sudah ada
    expect(repo.listTemplates(other)).toHaveLength(nTpl);
    other.close();
  });
});
