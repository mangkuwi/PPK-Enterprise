import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { MIGRATIONS, LATEST_SCHEMA, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { saveMaster } from '../electron/main/ppk/master';
import { createVendor } from '../electron/main/ppk/vendors';
import { createBudgetLine, getBudgetLine } from '../electron/main/ppk/budget';
import { addAddendum, createContract, getContract, setContractStatus } from '../electron/main/ppk/contracts';
import { addPayment, getBill, listBills, saveBill, setBillStatus, voidPayment } from '../electron/main/ppk/bills';
import { billStage, fundingOrder, splitByRemaining, type BillInput } from '@shared/ppk/bills';
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

describe('migrasi v10', () => {
  it('menambah tabel tagihan dari v9 tanpa mengubah kontrak lama', () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 9)) old.exec(m.sql);
    old.pragma('user_version = 9');
    expect(runMigrations(old)).toBe(LATEST_SCHEMA);
    expect(old.prepare('SELECT COUNT(*) n FROM ppk_bills').get()).toEqual({ n: 0 });
    old.close();
  });
});

describe('tagihan', () => {
  it('kontrak draf tidak bisa ditagih', async () => {
    await expect(saveBill(s, admin, null, null, bill())).rejects.toThrow(/Aktif atau Selesai/);
  });

  describe('kontrak aktif', () => {
    beforeEach(async () => { await setContractStatus(s, admin, contractId, 'aktif', ''); });

    it('pajak FP 02: DPP = bruto/1,11, PPN 11%, PPh 23 2%; FP 04 hanya PPh; pass-through tanpa pajak', async () => {
      const a = (await saveBill(s, admin, null, null, bill({ pass_through: 90_000_000, funding: [{ budget_line_id: rm, amount: 1_200_000_000 }] }))).data;
      expect(a).toMatchObject({ dpp: 1_000_000_000, ppn: 110_000_000, pph23: 20_000_000, total: 1_200_000_000, net: 1_070_000_000, status: 'draft' });
      const b = (await saveBill(s, admin, null, null, bill({ bill_number: 'INV-07', service_month: '2026-07', faktur_code: '04', amount: 111_000_000, funding: [{ budget_line_id: blu, amount: 111_000_000 }] }))).data;
      expect(b).toMatchObject({ dpp: 100_000_000, ppn: 0, pph23: 2_000_000, net: 109_000_000 });
      const c = (await saveBill(s, admin, null, null, bill({ bill_number: 'INV-08', faktur_code: null, amount: 5, funding: [{ budget_line_id: blu, amount: 5 }] }))).data;
      expect(c).toMatchObject({ ppn: 0, pph23: 0, net: 5 });
    });

    it('angka faktur boleh beda dari usulan (diberi peringatan); PPN pada FP 04 ditolak', async () => {
      const r = await saveBill(s, admin, null, null, bill({ ppn: 110_000_001 }));
      expect(r.data.ppn).toBe(110_000_001);
      expect(r.warnings[0]).toMatch(/berbeda dari usulan/);
      await expect(saveBill(s, admin, null, null, bill({ bill_number: 'X', faktur_code: '04', ppn: 1 }))).rejects.toThrow(/faktur 02/);
    });

    it('menolak: sumber dana tidak sama dengan nilai, melebihi sisa kontrak, potongan tanpa alasan, nomor ganda', async () => {
      await expect(saveBill(s, admin, null, null, bill({ funding: [{ budget_line_id: rm, amount: 1 }] }))).rejects.toThrow(/harus sama/);
      await expect(saveBill(s, admin, null, null, bill({ amount: 3_000_000_001, funding: [{ budget_line_id: blu, amount: 3_000_000_001 }] }))).rejects.toThrow(/sisa kontrak/);
      await expect(saveBill(s, admin, null, null, bill({ deduction: 1000 }))).rejects.toThrow(/Alasan potongan/);
      await expect(saveBill(s, admin, null, null, bill({ fx_rate: '15.850,25' }))).rejects.toThrow(/desimal/);
      await saveBill(s, admin, null, null, bill());
      await expect(saveBill(s, admin, null, null, bill())).rejects.toThrow(/sudah ada/);
    });

    it('pagu terlampaui = peringatan; tagihan terpecah RM + BLU; realisasi di baris anggaran dan sisa kontrak', async () => {
      const lines = [{ id: rm, remaining: 1_500_000_000 }, { id: blu, remaining: 5_000_000_000 }];
      const r = await saveBill(s, admin, null, null, bill({ amount: 2_220_000_000, funding: splitByRemaining(2_220_000_000, lines) }));
      expect(r.warnings).toEqual([]);
      expect((await getBill(s, admin, r.data.id)).funding.map((f) => [f.source_code, f.amount]).sort()).toEqual([['BLU', 720_000_000], ['RM', 1_500_000_000]]);
      expect(await getBudgetLine(s, admin, rm)).toMatchObject({ billed: 1_500_000_000, sisa_realisasi: 0, paid: 0 });
      expect((await getContract(s, admin, contractId)).contract).toMatchObject({ billed: 2_220_000_000, sisa_kontrak: 780_000_000 });
      const over = await saveBill(s, admin, null, null, bill({ bill_number: 'INV-07', amount: 1, funding: [{ budget_line_id: rm, amount: 1 }] }));
      expect(over.warnings[0]).toMatch(/melebihi pagu terakhir/);
      // Addendum tidak boleh membuat nilai kontrak di bawah total tagihan.
      await expect(addAddendum(s, admin, contractId, { addendum_number: 'A1', addendum_date: '2026-08-01', value_change: -800_000_000, period_start: null, period_end: null, new_end_date: null, description: '' }))
        .rejects.toThrow(/lebih kecil dari total tagihan/);
    });

    it('verifikasi mengunci tagihan; pembayaran per porsi; lunas; batal bayar lalu batal tagihan', async () => {
      const { data } = await saveBill(s, admin, null, null, bill({ amount: 2_220_000_000, funding: [{ budget_line_id: rm, amount: 1_500_000_000 }, { budget_line_id: blu, amount: 720_000_000 }] }));
      const fid = (await getBill(s, admin, data.id)).funding;
      await expect(addPayment(s, admin, fid[0].id, { channel: 'SAKTI', reference_number: 'SP2D-1', payment_date: '2026-07-20', amount: 1, notes: '' })).rejects.toThrow(/diverifikasi/);
      const v = await setBillStatus(s, admin, data.id, 'diverifikasi', '');
      await expect(saveBill(s, admin, data.id, v.version, bill({ amount: 2_220_000_000, funding: [{ budget_line_id: blu, amount: 2_220_000_000 }] }))).rejects.toThrow(/Hanya tagihan draf/);
      expect(() => db.prepare('UPDATE ppk_bills SET amount = 1 WHERE id = ?').run(data.id)).toThrow(/tidak dapat diubah/);
      expect(() => db.prepare('DELETE FROM ppk_bill_funding WHERE bill_id = ?').run(data.id)).toThrow(/terkunci/);
      const byCode = Object.fromEntries(fid.map((f) => [f.source_code, f]));
      const p1 = await addPayment(s, admin, byCode.RM.id, { channel: 'SAKTI', reference_number: 'SP2D-001', payment_date: '2026-07-20', amount: 1_500_000_000, notes: '' });
      expect(p1.warnings).toEqual([]);
      expect(billStage(p1.data)).toBe('Dibayar sebagian');
      await expect(addPayment(s, admin, byCode.RM.id, { channel: 'SAKTI', reference_number: 'SP2D-002', payment_date: '2026-07-21', amount: 1, notes: '' })).rejects.toThrow(/sudah ada/);
      await expect(addPayment(s, admin, byCode.BLU.id, { channel: 'FO', reference_number: 'FO-1', payment_date: '2026-07-22', amount: 720_000_001, notes: '' })).rejects.toThrow(/melebihi porsi/);
      const w = await addPayment(s, admin, byCode.BLU.id, { channel: 'SAKTI', reference_number: 'FO-1', payment_date: '2026-07-22', amount: 720_000_000, notes: '' });
      expect(w.warnings[0]).toMatch(/Kanal SAKTI berbeda/);
      expect(billStage(w.data)).toBe('Lunas');
      expect(await getBudgetLine(s, admin, rm)).toMatchObject({ paid: 1_500_000_000 });
      await expect(setBillStatus(s, admin, data.id, 'dibatalkan', 'salah')).rejects.toThrow(/sudah dibayar/);
      await expect(setContractStatus(s, admin, contractId, 'dibatalkan', 'x')).rejects.toThrow(/masih punya tagihan/);
      const pays = (await getBill(s, admin, data.id)).funding.flatMap((f) => f.payments);
      await expect(voidPayment(s, admin, pays[0].id, '')).rejects.toThrow(/wajib/);
      for (const p of pays) await voidPayment(s, admin, p.id, 'Salah input');
      expect(() => db.prepare('DELETE FROM ppk_payments').run()).toThrow(/tidak boleh dihapus/);
      const x = await setBillStatus(s, admin, data.id, 'dibatalkan', 'Tagihan ganda');
      expect(x).toMatchObject({ status: 'dibatalkan', paid: 0 });
      expect(await getBudgetLine(s, admin, rm)).toMatchObject({ billed: 0, paid: 0 });
      expect((await getContract(s, admin, contractId)).contract.sisa_kontrak).toBe(3_000_000_000);
      expect(await listBills(s, admin, { status: 'dibatalkan' })).toHaveLength(1);
      // Nomor tagihan yang dibatalkan tidak bisa dipakai ulang: koreksi = nomor baru.
      expect(() => db.prepare("UPDATE ppk_bills SET status = 'draft' WHERE id = ?").run(data.id)).toThrow(/tidak dapat diubah/);
    });
  });
});

describe('fungsi murni tagihan', () => {
  it('splitByRemaining menghabiskan sisa pagu sesuai urutan; kelebihan ke baris terakhir', () => {
    expect(splitByRemaining(100, [{ id: 'a', remaining: 30 }, { id: 'b', remaining: 50 }])).toEqual([{ budget_line_id: 'a', amount: 30 }, { budget_line_id: 'b', amount: 70 }]);
    expect(splitByRemaining(20, [{ id: 'a', remaining: 30 }, { id: 'b', remaining: 50 }])).toEqual([{ budget_line_id: 'a', amount: 20 }]);
    expect(splitByRemaining(20, [{ id: 'a', remaining: -5 }, { id: 'b', remaining: 0 }])).toEqual([{ budget_line_id: 'b', amount: 20 }]);
    expect(splitByRemaining(0, [{ id: 'a', remaining: 5 }])).toEqual([]);
  });
  it('fundingOrder: DIPA dulu, lalu RM, PNBP, BLU', () => {
    const rows = [{ kind: 'saldo_kas', source_code: 'RM' }, { kind: 'dipa', source_code: 'BLU' }, { kind: 'dipa', source_code: 'RM' }];
    expect(rows.sort(fundingOrder).map((r) => `${r.kind}:${r.source_code}`)).toEqual(['dipa:RM', 'dipa:BLU', 'saldo_kas:RM']);
  });
});
