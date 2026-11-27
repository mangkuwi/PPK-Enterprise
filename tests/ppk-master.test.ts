import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { MIGRATIONS, LATEST_SCHEMA, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { createUser, setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { listPpkUsers, ppkAccess, setPpkRole } from '../electron/main/ppk/access';
import { listMaster, listTaxRates, saveMaster } from '../electron/main/ppk/master';
import { createVendor, listVendors, setVendorStatus, similarVendors, updateVendor } from '../electron/main/ppk/vendors';
import { vendorNameKey, normalizeNpwp, type VendorInput } from '@shared/ppk/vendors';
import type { Actor } from '@shared/numbering';

let db: DB; let s: PpkStore; let admin: Actor; let staf: Actor; let reader: Actor;

const vin = (o: Partial<VendorInput> = {}): VendorInput => ({
  name: 'PT Telkom Satelit Indonesia', npwp: '', nib: '', address: '', contact_person: '', email: '', phone: '',
  bank_name: '', account_number: '', account_holder: '', service_category_id: null, notes: '', ...o
});

beforeEach(async () => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  const a = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
  admin = a;
  setPin(db, admin, admin.id, '123456');
  const u1 = createUser(db, admin, { name: 'Staf', role: 'operator', pin: '1111' });
  const u2 = createUser(db, admin, { name: 'Pembaca', role: 'operator', pin: '2222' });
  staf = { id: u1.id, name: u1.name, role: 'operator' }; reader = { id: u2.id, name: u2.name, role: 'operator' };
  await setPpkRole(s, admin, staf.id, 'staf');
  await setPpkRole(s, admin, reader.id, 'pembaca');
});

describe('migrasi v8', () => {
  it('menambah tabel PPK dari v7 tanpa mengubah data lama', () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 7)) old.exec(m.sql);
    old.pragma('user_version = 7');
    const t = new Date().toISOString();
    old.prepare("INSERT INTO documents (id, title, status, content_json, layout_json, created_at, updated_at) VALUES ('d1','Lama','final','{}','{}',?,?)").run(t, t);
    let from = -1;
    expect(runMigrations(old, { beforeMigrate: (v) => { from = v; } })).toBe(LATEST_SCHEMA);
    expect(from).toBe(7);
    expect((old.prepare("SELECT title FROM documents WHERE id='d1'").get() as { title: string }).title).toBe('Lama');
    expect((old.prepare('SELECT group_concat(code) c FROM (SELECT code FROM ppk_funding_sources ORDER BY code)').get() as { c: string }).c).toBe('BLU,PNBP,RM');
    old.close();
  });
  it('penyedia tidak bisa dihapus permanen', async () => {
    await createVendor(s, admin, vin());
    expect(() => db.prepare('DELETE FROM ppk_vendors').run()).toThrow(/arsipkan/);
  });
});

describe('hak akses PPK', () => {
  it('admin aplikasi = Admin PPK; operator tanpa peran tidak punya akses', async () => {
    expect((await ppkAccess(s, admin)).role).toBe('admin');
    const u = createUser(db, admin, { name: 'Baru', role: 'operator', pin: null });
    const baru = { id: u.id, name: u.name, role: 'operator' as const };
    await expect(listVendors(s, baru)).rejects.toThrow(/belum memiliki peran/);
  });
  it('pembaca hanya bisa membaca; staf bisa tulis tapi tidak ubah master', async () => {
    await expect(createVendor(s, reader, vin())).rejects.toThrow(/tidak mengizinkan/);
    await createVendor(s, staf, vin());
    expect(await listVendors(s, reader)).toHaveLength(1);
    await expect(saveMaster(s, staf, 'programs', { code: 'SATRIA', name: 'SATRIA-1', is_active: true })).rejects.toThrow(/tidak mengizinkan/);
  });
  it('mengubah data wajib PIN', async () => {
    const u = createUser(db, admin, { name: 'TanpaPIN', role: 'operator', pin: null });
    await setPpkRole(s, admin, u.id, 'staf');
    await expect(createVendor(s, { id: u.id, name: u.name, role: 'operator' }, vin())).rejects.toThrow(/PIN/);
  });
  it('hanya Admin PPK mengatur peran, tercatat di audit', async () => {
    await expect(setPpkRole(s, staf, reader.id, 'admin')).rejects.toThrow(/tidak mengizinkan/);
    await expect(setPpkRole(s, admin, admin.id, 'pembaca')).rejects.toThrow(/Administrator aplikasi/);
    expect((await listPpkUsers(s, admin)).find((u) => u.id === staf.id)?.ppk_role).toBe('staf');
    const n = (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='ppk.role.set'").get() as { n: number }).n;
    expect(n).toBe(2);
  });
});

describe('data master', () => {
  it('tambah, ubah, validasi, dan audit', async () => {
    const p = await saveMaster(s, admin, 'programs', { code: ' SATRIA ', name: 'SATRIA-1', is_active: true });
    expect(p.code).toBe('SATRIA');
    await expect(saveMaster(s, admin, 'programs', { code: 'SATRIA', name: 'Lain', is_active: true })).rejects.toThrow(/sudah ada/);
    await expect(saveMaster(s, admin, 'programs', { code: '', name: 'x' })).rejects.toThrow(/wajib/);
    const a = await saveMaster(s, admin, 'activities', { program_id: p.id, code: 'A1', name: 'Operasional', is_active: true });
    await expect(saveMaster(s, admin, 'activities', { program_id: 'tidak-ada', code: 'A2', name: 'x' })).rejects.toThrow(/rujukan/);
    await saveMaster(s, admin, 'activities', { id: a.id as string, program_id: p.id, code: 'A1', name: 'Operasional baru', is_active: false });
    expect((await listMaster(s, admin, 'activities'))[0]).toMatchObject({ name: 'Operasional baru', is_active: 0 });
    await expect(saveMaster(s, admin, 'funding_sources', { code: 'X', name: 'X', payment_channel: 'BANK' })).rejects.toThrow(/salah satu/);
    const u = await saveMaster(s, admin, 'units', { code: 'PPK6', name: 'PPK 6', is_active: true });
    await expect(saveMaster(s, admin, 'officials', { unit_id: u.id, name: 'A', start_date: '2026-09-31' })).rejects.toThrow(/tanggal/);
    await expect(saveMaster(s, admin, 'officials', { unit_id: u.id, name: 'A', start_date: '2026-06-01', end_date: '2026-01-01' })).rejects.toThrow(/aturan/);
    await saveMaster(s, admin, 'officials', { unit_id: u.id, name: 'A', start_date: '2026-06-01', end_date: '' });
    const audits = (db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'ppk.%.create' OR action LIKE 'ppk.%.update'").get() as { n: number }).n;
    expect(audits).toBe(5);
  });
  it('tarif pajak bawaan PPN 11% dan PPh 23 2%', async () => {
    expect(await listTaxRates(s, reader)).toEqual([expect.objectContaining({ valid_from: '2022-04-01', ppn_bp: 1100, pph23_bp: 200 })]);
  });
});

describe('penyedia', () => {
  it('nama dan NPWP dinormalisasi', () => {
    expect(vendorNameKey('PT. Telkom Satelit Indonesia (Persero) Tbk')).toBe('telkom satelit indonesia');
    expect(normalizeNpwp('01.234.567.8-901.000')).toBe('012345678901000');
    expect(() => normalizeNpwp('123')).toThrow(/15 atau 16/);
  });
  it('menolak penyedia ganda dari nama atau NPWP, memberi peringatan untuk yang mirip', async () => {
    const v = await createVendor(s, staf, vin({ npwp: '01.234.567.8-901.000', account_number: '123-456 789' }));
    expect(v).toMatchObject({ npwp: '012345678901000', account_number: '123456789', status: 'aktif', version: 1 });
    await expect(createVendor(s, staf, vin({ name: 'Telkom Satelit Indonesia' }))).rejects.toThrow(/sudah terdaftar/);
    await expect(createVendor(s, staf, vin({ name: 'Lain', npwp: '012345678901000' }))).rejects.toThrow(/NPWP/);
    const sim = await similarVendors(s, staf, 'Telkom Satelit', '');
    expect(sim[0]?.name).toBe('PT Telkom Satelit Indonesia');
    await expect(createVendor(s, staf, vin({ name: 'B', email: 'bukan-email' }))).rejects.toThrow(/email/);
  });
  it('ubah memakai versi agar tidak saling menimpa, arsip menyembunyikan dari daftar aktif', async () => {
    const v = await createVendor(s, staf, vin());
    const v2 = await updateVendor(s, staf, v.id, 1, vin({ phone: '021' }));
    expect(v2.version).toBe(2);
    await expect(updateVendor(s, admin, v.id, 1, vin({ phone: '022' }))).rejects.toThrow(/pengguna lain/);
    await setVendorStatus(s, staf, v.id, 'arsip', 'kontrak selesai');
    expect(await listVendors(s, staf)).toHaveLength(0);
    expect(await listVendors(s, staf, { status: 'semua', search: 'satelit' })).toHaveLength(1);
    await expect(createVendor(s, staf, vin())).rejects.toThrow(/berstatus arsip/);
    const log = db.prepare("SELECT detail_json FROM audit_log WHERE action='ppk.vendor.update'").get() as { detail_json: string };
    expect(JSON.parse(log.detail_json)).toMatchObject({ before: { phone: '' }, after: { phone: '021' } });
  });
  it('transaksi gagal tidak menyimpan apa pun', async () => {
    await expect(s.tx(async (t) => {
      await t.run("INSERT INTO ppk_service_categories (id, code, name, created_at, updated_at) VALUES ('c1','K','K','x','x')");
      throw new Error('batal');
    })).rejects.toThrow('batal');
    expect((db.prepare('SELECT COUNT(*) n FROM ppk_service_categories').get() as { n: number }).n).toBe(0);
  });
});
