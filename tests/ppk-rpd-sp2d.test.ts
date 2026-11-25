import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { MIGRATIONS, LATEST_SCHEMA, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { saveMaster } from '../electron/main/ppk/master';
import { createVendor } from '../electron/main/ppk/vendors';
import { createBudgetLine, getBudgetPlan, setBudgetPlan } from '../electron/main/ppk/budget';
import { createContract, getContract, setContractStatus, setYearValues, updateContract } from '../electron/main/ppk/contracts';
import { addPayment, getBill, saveBill, setBillStatus } from '../electron/main/ppk/bills';
import { addSp2d, sp2dReport, voidSp2d } from '../electron/main/ppk/sp2d';
import { ppkReport } from '../electron/main/ppk/reports';
import type { BillInput } from '@shared/ppk/bills';
import type { ContractInput } from '@shared/ppk/contracts';
import type { Actor } from '@shared/numbering';

let db: DB; let s: PpkStore; let admin: Actor;
let rm: string; let blu: string; let contractId: string;

const bill = (o: Partial<BillInput> = {}): BillInput => ({
  contract_id: contractId, bill_number: 'INV-06', bill_date: '2026-07-05', received_date: null, service_month: '2026-06', period_start: null, period_end: null,
  amount: 1_110_000_000, pass_through: 0, faktur_code: '02', faktur_number: '010.000-26.00000001', ppn: null, pph23: null, deduction: 0, deduction_reason: '',
  fx_rate: '', fx_amount: '', ba_number: '', ba_date: null, official_id: null, notes: '', funding: [{ budget_line_id: rm, amount: 1_110_000_000 }], ...o
});

beforeEach(async () => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
  setPin(db, admin, admin.id, '123456');
  const id = (sql: string) => (db.prepare(sql).get() as { id: string }).id;
  const fy = id('SELECT id FROM ppk_fiscal_years WHERE year = 2026');
  const unit = await saveMaster(s, admin, 'units', { code: 'PPK6', name: 'PPK 6', is_active: true });
  const prog = await saveMaster(s, admin, 'programs', { code: 'SATRIA', name: 'SATRIA-1', is_active: true });
  const act = await saveMaster(s, admin, 'activities', { program_id: prog.id, code: 'K1', name: 'Layanan', is_active: true });
  const mak = await saveMaster(s, admin, 'budget_accounts', { code: '525112', name: 'Belanja barang', is_active: true });
  const vendor = await createVendor(s, admin, { name: 'PT Satelit Nusantara', npwp: '', nib: '', address: '', contact_person: '', email: '', phone: '',
    bank_name: '', account_number: '', account_holder: '', service_category_id: null, notes: '' });
  const base = { fiscal_year_id: fy, unit_id: unit.id as string, program_id: prog.id as string, activity_id: act.id as string, budget_account_id: mak.id as string,
    output_detail: 'Sewa', kind: 'dipa' as const, description: '' };
  const p = (amount: number) => ({ amount, effective_date: '2026-01-02', source_document: 'DIPA', notes: '' });
  rm = (await createBudgetLine(s, admin, { ...base, funding_source_id: id("SELECT id FROM ppk_funding_sources WHERE code='RM'") }, p(1_500_000_000))).id;
  blu = (await createBudgetLine(s, admin, { ...base, funding_source_id: id("SELECT id FROM ppk_funding_sources WHERE code='BLU'") }, p(5_000_000_000))).id;
  const c = await createContract(s, admin, { fiscal_year_id: fy, unit_id: unit.id as string, vendor_id: vendor.id, program_id: prog.id as string, activity_id: act.id as string,
    service_package_id: null, contract_type: 'biasa', contract_number: 'KTR-1', vendor_contract_number: '', contract_date: '2026-01-05', description: 'Sewa',
    initial_value: 3_000_000_000, start_date: '2026-01-01', end_date: '2026-12-31', is_multi_year: false, term_start: null, term_end: null, prior_year_paid: 0, notes: '' });
  contractId = c.id;
});

const fy = () => (db.prepare('SELECT id FROM ppk_fiscal_years WHERE year = 2026').get() as { id: string }).id;

describe('migrasi v11', () => {
  it('menambah tabel RPD, SP2D, dan nilai tahunan dari v10 tanpa mengubah data lama', () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 10)) old.exec(m.sql);
    old.pragma('user_version = 10');
    expect(runMigrations(old)).toBe(LATEST_SCHEMA);
    expect(old.prepare('SELECT COUNT(*) n FROM ppk_sp2d_records').get()).toEqual({ n: 0 });
    old.close();
  });
});

describe('RPD', () => {
  it('menyimpan rencana bulanan, memperingatkan bila melebihi pagu, dan menolak bulan di luar tahun', async () => {
    const r = await setBudgetPlan(s, admin, rm, [{ month: '2026-01', amount: 1_000_000_000 }, { month: '2026-02', amount: 600_000_000 }, { month: '2026-03', amount: 0 }]);
    expect(r.data).toEqual([{ month: '2026-01', amount: 1_000_000_000 }, { month: '2026-02', amount: 600_000_000 }]);
    expect(r.warnings[0]).toMatch(/melebihi pagu/);
    await expect(setBudgetPlan(s, admin, rm, [{ month: '2025-12', amount: 1 }])).rejects.toThrow(/tahun 2026/);
    await setBudgetPlan(s, admin, rm, [{ month: '2026-01', amount: 5 }]);
    expect(await getBudgetPlan(s, admin, rm)).toEqual([{ month: '2026-01', amount: 5 }]);
    expect((db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'ppk.budget.plan'").get() as { n: number }).n).toBe(2);
  });
});

describe('kontrak tahun jamak', () => {
  it('nilai per tahun hanya untuk kontrak tahun jamak dan dipakai prognosis', async () => {
    await expect(setYearValues(s, admin, contractId, [{ year: 2026, amount: 1 }])).rejects.toThrow(/tahun jamak/);
    const c = (await getContract(s, admin, contractId)).contract;
    await updateContract(s, admin, contractId, c.version, { ...(c as unknown as ContractInput), is_multi_year: true, term_start: '2026-01-01', term_end: '2030-12-31', end_date: '2030-12-31' });
    await setYearValues(s, admin, contractId, [{ year: 2026, amount: 1_200_000_000 }, { year: 2027, amount: 1_300_000_000 }]);
    expect((await getContract(s, admin, contractId)).year_values).toEqual([{ year: 2026, amount: 1_200_000_000 }, { year: 2027, amount: 1_300_000_000 }]);
    await setContractStatus(s, admin, contractId, 'aktif', '');
    const rep = await ppkReport(s, admin, fy(), '2026-06', false);
    // Kontrak tanpa tagihan dan pembebanan: estimasi = nilai 2026 dibagi Jul–Des (bukan nilai kontrak 3 M sampai 2030).
    expect(rep.lines.find((l) => l.id === null)!.estimate).toBe(1_200_000_000);
  });
});

describe('rekonsiliasi SP2D', () => {
  it('mencocokkan SP2D SAKTI dengan pembayaran aplikasi dan menandai selisih', async () => {
    await setContractStatus(s, admin, contractId, 'aktif', '');
    const b = await saveBill(s, admin, null, null, bill());
    await setBillStatus(s, admin, b.data.id, 'diverifikasi', '');
    const f = (await getBill(s, admin, b.data.id)).funding[0];
    await addPayment(s, admin, f.id, { channel: 'SAKTI', reference_number: 'sp2d 001', payment_date: '2026-07-20', amount: f.amount, notes: '' });
    const y = fy();
    await addSp2d(s, admin, y, { sp2d_number: 'SP2D001', sp2d_date: '2026-07-20', amount: f.amount, notes: '' });
    const wrong = await addSp2d(s, admin, y, { sp2d_number: 'SP2D-777', sp2d_date: '2026-07-21', amount: 5, notes: '' });
    await expect(addSp2d(s, admin, y, { sp2d_number: 'sp2d001', sp2d_date: '2026-07-20', amount: 1, notes: '' })).rejects.toThrow(/sudah dicatat/);
    let rep = await sp2dReport(s, admin, y);
    expect(rep.rows.map((r) => [r.sp2d_number, r.status])).toEqual([['SP2D-777', 'hanya_sakti'], ['SP2D001', 'cocok']]);
    await expect(voidSp2d(s, admin, wrong.id, '')).rejects.toThrow(/Alasan/);
    await voidSp2d(s, admin, wrong.id, 'salah ketik');
    rep = await sp2dReport(s, admin, y);
    expect(rep.rows.map((r) => r.status)).toEqual(['cocok']);
    expect(() => db.prepare('DELETE FROM ppk_sp2d_records').run()).toThrow(/tidak boleh dihapus/);
    expect(() => db.prepare('UPDATE ppk_sp2d_records SET amount = 1 WHERE id = ?').run(wrong.id)).toThrow(/dibatalkan sekali/);
  });
});
