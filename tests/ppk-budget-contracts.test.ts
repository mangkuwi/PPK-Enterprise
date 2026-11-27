import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { MIGRATIONS, LATEST_SCHEMA, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { createUser, setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { setPpkRole } from '../electron/main/ppk/access';
import { saveMaster } from '../electron/main/ppk/master';
import { createVendor, setVendorStatus } from '../electron/main/ppk/vendors';
import { addBudgetRevision, createBudgetLine, listBudgetLines, listBudgetVersions, updateBudgetLine } from '../electron/main/ppk/budget';
import {
  addAddendum, createContract, getContract, listContracts, setAllocations, setContractStatus, setSchedule, updateContract, voidAddendum
} from '../electron/main/ppk/contracts';
import { contractProject, monthsBetween, splitEven, daysUntil, type ContractInput } from '@shared/ppk/contracts';
import type { BudgetLineInput } from '@shared/ppk/budget';
import type { Actor } from '@shared/numbering';

let db: DB; let s: PpkStore; let admin: Actor; let reader: Actor;
let ref: { fy: string; fy2: string; unit: string; prog: string; act: string; mak: string; rm: string; blu: string; vendor: string };

const pagu = (amount: number, effective_date = '2026-01-02', source_document = 'DIPA 2026') => ({ amount, effective_date, source_document, notes: '' });
const line = (o: Partial<BudgetLineInput> = {}): BudgetLineInput => ({
  fiscal_year_id: ref.fy, unit_id: ref.unit, program_id: ref.prog, activity_id: ref.act, budget_account_id: ref.mak,
  output_detail: 'Sewa transponder', funding_source_id: ref.rm, kind: 'dipa', description: '', ...o
});
const kontrak = (o: Partial<ContractInput> = {}): ContractInput => ({
  fiscal_year_id: ref.fy, unit_id: ref.unit, vendor_id: ref.vendor, program_id: ref.prog, activity_id: ref.act, service_package_id: null,
  contract_type: 'biasa', contract_number: 'KTR-001', vendor_contract_number: '', contract_date: '2026-01-05', description: 'Sewa kapasitas satelit',
  initial_value: 1_200_000_000, start_date: '2026-01-01', end_date: '2026-12-31', is_multi_year: false, term_start: null, term_end: null,
  prior_year_paid: 0, notes: '', ...o
});

beforeEach(async () => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
  setPin(db, admin, admin.id, '123456');
  const u = createUser(db, admin, { name: 'Pembaca', role: 'operator', pin: '2222' });
  reader = { id: u.id, name: u.name, role: 'operator' };
  await setPpkRole(s, admin, reader.id, 'pembaca');
  const id = (sql: string) => (db.prepare(sql).get() as { id: string }).id;
  const unit = await saveMaster(s, admin, 'units', { code: 'PPK1', name: 'PPK Satelit', is_active: true });
  const prog = await saveMaster(s, admin, 'programs', { code: 'SATRIA', name: 'SATRIA-1', is_active: true });
  const act = await saveMaster(s, admin, 'activities', { program_id: prog.id, code: 'K1', name: 'Layanan', is_active: true });
  const mak = await saveMaster(s, admin, 'budget_accounts', { code: '525112', name: 'Belanja barang', is_active: true });
  const fy2 = await saveMaster(s, admin, 'fiscal_years', { year: 2027, is_active: true });
  const vendor = await createVendor(s, admin, {
    name: 'PT Satelit Nusantara', npwp: '', nib: '', address: '', contact_person: '', email: '', phone: '',
    bank_name: '', account_number: '', account_holder: '', service_category_id: null, notes: ''
  });
  ref = {
    fy: id('SELECT id FROM ppk_fiscal_years WHERE year = 2026'), fy2: fy2.id as string, unit: unit.id as string, prog: prog.id as string, act: act.id as string,
    mak: mak.id as string, rm: id("SELECT id FROM ppk_funding_sources WHERE code='RM'"), blu: id("SELECT id FROM ppk_funding_sources WHERE code='BLU'"), vendor: vendor.id
  };
});

describe('migrasi v9', () => {
  it('menambah tabel anggaran dan kontrak dari v8 tanpa mengubah data PPK lama', () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 8)) old.exec(m.sql);
    old.pragma('user_version = 8');
    const t = new Date().toISOString();
    old.prepare("INSERT INTO ppk_vendors (id, name, name_key, created_by, created_at, updated_by, updated_at) VALUES ('v1','PT Lama','pt lama','x',?,'x',?)").run(t, t);
    expect(runMigrations(old)).toBe(LATEST_SCHEMA);
    expect((old.prepare("SELECT name FROM ppk_vendors WHERE id='v1'").get() as { name: string }).name).toBe('PT Lama');
    expect(old.prepare('SELECT COUNT(*) n FROM ppk_contracts').get()).toEqual({ n: 0 });
    old.close();
  });
});

describe('baris anggaran dan revisi pagu', () => {
  it('pagu terakhir = versi tertinggi; riwayat tidak bisa diubah atau dihapus', async () => {
    const bl = await createBudgetLine(s, admin, line(), pagu(1_000_000_000));
    expect(bl).toMatchObject({ pagu_awal: 1_000_000_000, pagu_terakhir: 1_000_000_000, revisions: 0, allocated: 0, sisa: 1_000_000_000 });
    const r = await addBudgetRevision(s, admin, bl.id, pagu(800_000_000, '2026-06-01', 'Revisi DIPA 01'));
    expect(r.data).toMatchObject({ pagu_awal: 1_000_000_000, pagu_terakhir: 800_000_000, revisions: 1 });
    expect(r.warnings).toEqual([]);
    expect((await listBudgetVersions(s, admin, bl.id)).map((v) => [v.version_no, v.kind, v.amount])).toEqual([[1, 'awal', 1_000_000_000], [2, 'revisi', 800_000_000]]);
    expect(() => db.prepare('UPDATE ppk_budget_versions SET amount = 1').run()).toThrow(/tidak boleh diubah/);
    expect(() => db.prepare('DELETE FROM ppk_budget_versions').run()).toThrow(/tidak boleh dihapus/);
    expect(() => db.prepare('DELETE FROM ppk_budget_lines').run()).toThrow(/nonaktifkan/);
  });
  it('menolak revisi bertanggal mundur, dokumen sumber kosong, rupiah pecahan, dan duplikat', async () => {
    const bl = await createBudgetLine(s, admin, line(), pagu(100));
    await expect(addBudgetRevision(s, admin, bl.id, pagu(50, '2025-12-31'))).rejects.toThrow(/tidak boleh sebelum/);
    await expect(addBudgetRevision(s, admin, bl.id, pagu(50, '2026-02-01', ' '))).rejects.toThrow(/wajib/);
    await expect(addBudgetRevision(s, admin, bl.id, pagu(50.5, '2026-02-01'))).rejects.toThrow(/bilangan bulat/);
    await expect(createBudgetLine(s, admin, line(), pagu(1))).rejects.toThrow(/sudah ada/);
    // MAK sama boleh untuk jenis lain (saldo kas) atau sumber dana lain.
    await createBudgetLine(s, admin, line({ kind: 'saldo_kas' }), pagu(1));
    await createBudgetLine(s, admin, line({ funding_source_id: ref.blu }), pagu(1));
    expect(await listBudgetLines(s, admin, { fiscal_year_id: ref.fy })).toHaveLength(3);
  });
  it('nonaktif tersembunyi dari daftar default; versi lama ditolak', async () => {
    const bl = await createBudgetLine(s, admin, line(), pagu(100));
    await updateBudgetLine(s, admin, bl.id, bl.version, { description: 'x', is_active: false });
    expect(await listBudgetLines(s, admin)).toHaveLength(0);
    expect(await listBudgetLines(s, admin, { include_inactive: true })).toHaveLength(1);
    await expect(updateBudgetLine(s, admin, bl.id, bl.version, { description: 'y', is_active: true })).rejects.toThrow(/pengguna lain/);
  });
  it('pembaca tidak dapat menulis', async () => {
    await expect(createBudgetLine(s, reader, line(), pagu(1))).rejects.toThrow(/tidak mengizinkan/);
  });
});

describe('kontrak, addendum, jadwal, pembebanan', () => {
  it('nilai kontrak terakhir = awal + addendum sah; void mengembalikan nilai; isi addendum tidak bisa diubah', async () => {
    const c = await createContract(s, admin, kontrak());
    expect(c).toMatchObject({ status: 'draft', latest_value: 1_200_000_000, effective_end: '2026-12-31', addendum_count: 0 });
    const a1 = await addAddendum(s, admin, c.id, { addendum_number: 'ADD-1', addendum_date: '2026-03-01', value_change: 300_000_000, period_start: null, period_end: null, new_end_date: '2027-03-31', description: '' });
    expect(a1.data).toMatchObject({ latest_value: 1_500_000_000, effective_end: '2027-03-31', addendum_count: 1 });
    const a2 = await addAddendum(s, admin, c.id, { addendum_number: 'ADD-2', addendum_date: '2026-04-01', value_change: -100_000_000, period_start: null, period_end: null, new_end_date: null, description: '' });
    expect(a2.data.latest_value).toBe(1_400_000_000);
    await expect(addAddendum(s, admin, c.id, { addendum_number: 'ADD-3', addendum_date: '2026-05-01', value_change: -2_000_000_000, period_start: null, period_end: null, new_end_date: null, description: '' }))
      .rejects.toThrow(/negatif/);
    const add1 = (await getContract(s, admin, c.id)).addendums.find((a) => a.addendum_number === 'ADD-1')!;
    await expect(voidAddendum(s, admin, add1.id, '')).rejects.toThrow(/wajib/);
    const v = await voidAddendum(s, admin, add1.id, 'Salah input');
    expect(v.data).toMatchObject({ latest_value: 1_100_000_000, effective_end: '2026-12-31', addendum_count: 1 });
    await expect(voidAddendum(s, admin, add1.id, 'lagi')).rejects.toThrow(/sudah dibatalkan/);
    expect(() => db.prepare("UPDATE ppk_contract_addendums SET value_change = 1 WHERE addendum_number = 'ADD-2'").run()).toThrow(/tidak dapat diubah/);
    expect(() => db.prepare('DELETE FROM ppk_contract_addendums').run()).toThrow(/tidak boleh dihapus/);
    expect(() => db.prepare('DELETE FROM ppk_contracts').run()).toThrow(/dibatalkan/);
  });
  it('nilai awal terkunci setelah aktif; status final; nomor kontrak unik', async () => {
    const c = await createContract(s, admin, kontrak());
    const u = await updateContract(s, admin, c.id, c.version, kontrak({ initial_value: 1_000_000_000 }));
    expect(u.initial_value).toBe(1_000_000_000);
    await expect(updateContract(s, admin, c.id, c.version, kontrak())).rejects.toThrow(/pengguna lain/);
    const a = await setContractStatus(s, admin, c.id, 'aktif', '');
    await expect(updateContract(s, admin, c.id, a.version, kontrak({ initial_value: 2 }))).rejects.toThrow(/addendum/);
    await expect(setContractStatus(s, admin, c.id, 'dibatalkan', '')).rejects.toThrow(/wajib/);
    await setContractStatus(s, admin, c.id, 'selesai', '');
    await expect(setContractStatus(s, admin, c.id, 'aktif', '')).rejects.toThrow(/tidak dapat diubah menjadi/);
    await expect(createContract(s, admin, kontrak())).rejects.toThrow(/sudah ada/);
    await expect(createContract(s, admin, kontrak({ contract_number: 'KTR-2', end_date: '2025-01-01' }))).rejects.toThrow(/sebelum tanggal mulai/);
    expect((await listContracts(s, admin, { search: 'ktr-0' })).length).toBe(1);
    expect((await listContracts(s, admin, { search: '100%' })).length).toBe(0);
  });
  it('penyedia nonaktif tidak bisa dipakai untuk kontrak baru', async () => {
    await setVendorStatus(s, admin, ref.vendor, 'nonaktif', 'Tidak beroperasi');
    await expect(createContract(s, admin, kontrak())).rejects.toThrow(/tidak aktif/);
  });
  it('jadwal: bagi rata tepat sama dengan nilai; peringatan bila berbeda', async () => {
    const c = await createContract(s, admin, kontrak({ initial_value: 1_000_000_001 }));
    const rows = splitEven(c.latest_value, monthsBetween(c.start_date, c.end_date));
    expect(rows).toHaveLength(12);
    expect(rows.reduce((a, r) => a + r.planned_amount, 0)).toBe(1_000_000_001);
    expect((await setSchedule(s, admin, c.id, rows)).warnings).toEqual([]);
    const w = await setSchedule(s, admin, c.id, rows.slice(0, 11));
    expect(w.data.scheduled).toBe(1_000_000_001 - rows[11].planned_amount);
    expect(w.warnings[0]).toMatch(/Total jadwal/);
    await expect(setSchedule(s, admin, c.id, [{ month: '2026-13', planned_amount: 1 }])).rejects.toThrow(/tidak valid/);
    await expect(setSchedule(s, admin, c.id, [{ month: '2026-01', planned_amount: 1 }, { month: '2026-01', planned_amount: 1 }])).rejects.toThrow(/dua kali/);
  });
  it('pembebanan: total ≤ nilai kontrak (tolak), pagu terlampaui (peringatan), beda tahun (tolak), komitmen di baris anggaran', async () => {
    const bl = await createBudgetLine(s, admin, line(), pagu(1_000_000_000));
    const bl2 = await createBudgetLine(s, admin, line({ funding_source_id: ref.blu }), pagu(500_000_000));
    const c = await createContract(s, admin, kontrak());
    await expect(setAllocations(s, admin, c.id, [{ budget_line_id: bl.id, amount: 1_000_000_000 }, { budget_line_id: bl2.id, amount: 300_000_000 }])).rejects.toThrow(/melebihi nilai kontrak/);
    const ok = await setAllocations(s, admin, c.id, [{ budget_line_id: bl.id, amount: 900_000_000 }, { budget_line_id: bl2.id, amount: 300_000_000 }]);
    expect(ok.warnings).toEqual([]);
    expect(ok.data.allocated).toBe(1_200_000_000);
    const c2 = await createContract(s, admin, kontrak({ contract_number: 'KTR-002' }));
    const over = await setAllocations(s, admin, c2.id, [{ budget_line_id: bl.id, amount: 200_000_000 }]);
    expect(over.warnings[0]).toMatch(/melebihi pagu terakhir/);
    expect((await listBudgetLines(s, admin)).find((b) => b.id === bl.id)).toMatchObject({ allocated: 1_100_000_000, sisa: -100_000_000 });
    // Revisi pagu di bawah komitmen hanya peringatan.
    expect((await addBudgetRevision(s, admin, bl2.id, pagu(100_000_000, '2026-07-01', 'Revisi 02'))).warnings[0]).toMatch(/lebih kecil dari komitmen/);
    // Kontrak dibatalkan tidak dihitung sebagai komitmen.
    await setContractStatus(s, admin, c2.id, 'dibatalkan', 'Batal lelang');
    expect((await listBudgetLines(s, admin)).find((b) => b.id === bl.id)!.allocated).toBe(900_000_000);
    await expect(setAllocations(s, admin, c2.id, [])).rejects.toThrow(/tidak dapat diubah/);
    // Baris anggaran tahun lain ditolak; tahun kontrak terkunci selama ada pembebanan.
    const blNext = await createBudgetLine(s, admin, line({ fiscal_year_id: ref.fy2 }), pagu(1));
    await expect(setAllocations(s, admin, c.id, [{ budget_line_id: blNext.id, amount: 1 }])).rejects.toThrow(/bukan tahun anggaran/);
    await expect(updateContract(s, admin, c.id, ok.data.version, kontrak({ fiscal_year_id: ref.fy2 }))).rejects.toThrow(/Tahun anggaran tidak dapat diubah/);
    // Gagal di tengah = tidak ada yang berubah.
    expect((await getContract(s, admin, c.id)).allocations.map((a) => a.amount).sort()).toEqual([300_000_000, 900_000_000]);
  });
});

describe('fungsi murni kontrak', () => {
  it('monthsBetween lintas tahun dan daysUntil', () => {
    expect(monthsBetween('2026-11-15', '2027-02-01')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(splitEven(10, ['a', 'b', 'c']).map((r) => r.planned_amount)).toEqual([3, 3, 4]);
    expect(daysUntil('2026-12-25', '2026-11-25')).toBe(30);
    expect(daysUntil('2026-11-24', '2026-11-25')).toBe(-1);
  });
});

describe('project kontrak', () => {
  it('Paket Layanan dulu, lalu nama sheet dari catatan impor', () => {
    expect(contractProject({ package_code: 'HUB', package_name: 'IP HUB Timur', notes: 'Impor a.xlsx · SATRIA 1 baris 8' })).toBe('IP HUB Timur');
    expect(contractProject({ package_code: null, package_name: null, notes: 'Impor Rekap PPK 2026.xlsx · OM IP HUB baris 7' })).toBe('OM IP HUB');
    expect(contractProject({ package_code: null, package_name: null, notes: 'catatan bebas' })).toBe('');
  });
});
