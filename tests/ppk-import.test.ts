import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { saveMaster } from '../electron/main/ppk/master';
import { runPpkImport } from '../electron/main/ppk/import';
import { parseIdDate, parsePpkWorkbook, splitNumberDate, type Cell, type ImportSheet } from '@shared/ppk/import';
import type { Actor } from '@shared/numbering';

const MAK = '6378.QDB.001.051.A.525112';
const DETAIL = 'Sewa transponder';
const summary: ImportSheet = { name: 'SUMMARY', rows: [
  ['REKAP PPK 6'],
  ['UNIT', 'MATA ANGGARAN', 'MAK', 'DETAIL RKA-KL', 'PAGU AWAL', 'SALDO KAS 2025'],
  ['PPK 6', 'RM', MAK, DETAIL, 2_000_000_000, null],
  ['PPK 6', 'BLU', MAK, DETAIL, 500_000_000, null],
  ['PPK 6', 'BLU', MAK, DETAIL, 0, 300_000_000],
  ['TOTAL', null, null, null, 2_500_000_000, 300_000_000]
] };
const H = ['NO', 'PENYEDIA', 'URAIAN', 'NOMOR KONTRAK', 'NILAI KONTRAK', 'JADWAL PEKERJAAN MULAI', 'JADWAL PEKERJAAN SELESAI', 'PERIODE TAGIHAN', 'NILAI TAGIHAN',
  'NOMOR & TANGGAL INVOICE', 'NOMOR & TANGGAL BA PEMBAYARAN', 'FP 04/02', 'PPN', 'PPH 23', 'SUMBER DANA', 'MAK'];
const row = (o: Record<string, Cell>): Cell[] => H.map((h) => o[h] ?? null);
const detail = (extra: Cell[][] = []): ImportSheet => ({ name: 'SEWA', rows: [
  ['SEWA TRANSPONDER'], ['PAGU', 2_000_000_000], H,
  row({ NO: 1, PENYEDIA: 'PT Satelit Nusantara', 'NOMOR KONTRAK': 'KTR-001 tanggal 2 Januari 2026', 'NILAI KONTRAK': 1_200_000_000, 'JADWAL PEKERJAAN MULAI': '1 Januari 2026',
    'JADWAL PEKERJAAN SELESAI': '31 Maret 2026', 'PERIODE TAGIHAN': 'JANUARI', 'NILAI TAGIHAN': 400_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-1 tanggal 5 Februari 2026',
    'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-1 tanggal 10 Februari 2026', 'FP 04/02': 'FP 04', 'PPH 23': 7_207_207, 'SUMBER DANA': 'RM', MAK }),
  row({ 'PERIODE TAGIHAN': 'FEBRUARI - MARET', 'NILAI TAGIHAN': 800_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-2 tanggal 31 April 2026', 'SUMBER DANA': 'RM', MAK }),
  row({ 'NOMOR KONTRAK': 'KTR-001/PKS-2', 'NILAI KONTRAK': 600_000_000, 'JADWAL PEKERJAAN MULAI': '1 April 2026', 'JADWAL PEKERJAAN SELESAI': '30 Juni 2026',
    'PERIODE TAGIHAN': 'APRIL', 'NILAI TAGIHAN': 300_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-3 tanggal 5 Mei 2026', 'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-3 tanggal 8 Mei 2026',
    'SUMBER DANA': 'RM', MAK }),
  row({ 'PERIODE TAGIHAN': 'PASS THROUGH APRIL', 'NILAI TAGIHAN': 50_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-3P tanggal 5 Mei 2026',
    'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-3P tanggal 8 Mei 2026', 'SUMBER DANA': 'RM', MAK }),
  row({ NO: 2, PENYEDIA: 'PT Dua Jaya', 'NOMOR KONTRAK': 'KTR-002', 'NILAI KONTRAK': 100_000_000, 'PERIODE TAGIHAN': 'MEI', 'NILAI TAGIHAN': 100_000_000,
    'NOMOR & TANGGAL INVOICE': 'INV-9 tanggal 1 Juni 2026', 'NOMOR & TANGGAL BA PEMBAYARAN': 'BA-9 tanggal 2 Juni 2026', 'SUMBER DANA': 'BLU', MAK }),
  ...extra
] });

describe('parser spreadsheet PPK', () => {
  it('membaca tanggal Indonesia dan menjepit tanggal mustahil', () => {
    const clamped: string[] = [];
    expect(parseIdDate('5 Februari 2026')).toBe('2026-02-05');
    expect(parseIdDate('2026-03-07')).toBe('2026-03-07');
    expect(parseIdDate('31 September 2026', (_, f) => clamped.push(f))).toBe('2026-09-30');
    expect(clamped).toEqual(['2026-09-30']);
    expect(splitNumberDate('000403867 tanggal 06 Maret 2026')).toEqual({ number: '000403867', date: '2026-03-06' });
  });

  it('memecah kelompok baris menjadi kontrak, addendum, dan tagihan', () => {
    const p = parsePpkWorkbook([summary, detail()], 2026);
    expect(p.sheets.map((s) => s.kind)).toEqual(['ringkasan', 'rincian']);
    expect(p.budgetLines.map((b) => [b.source, b.kind, b.amount])).toEqual([['RM', 'dipa', 2_000_000_000], ['BLU', 'dipa', 500_000_000], ['BLU', 'saldo_kas', 300_000_000]]);
    const [a, b] = p.chains;
    expect(a.contract).toEqual({ number: 'KTR-001', date: '2026-01-02', value: 1_200_000_000, start: '2026-01-01', end: '2026-03-31' });
    expect(a.addendums).toEqual([{ row: 6, number: 'KTR-001/PKS-2', value: 600_000_000, start: '2026-04-01', end: '2026-06-30' }]);
    expect(a.output_detail).toBe(DETAIL);
    expect(a.bills.map((x) => [x.service_month, x.amount, x.pass_through, x.complete])).toEqual([
      ['2026-01', 400_000_000, 0, true], ['2026-02', 800_000_000, 0, false], ['2026-04', 300_000_000, 0, true], ['2026-04', 0, 50_000_000, true]]);
    expect(a.bills[1]).toMatchObject({ period_start: '2026-02-01', period_end: '2026-03-31', bill_date: '2026-04-30' });
    expect(a.bills[3]).toMatchObject({ pass_row: true, faktur: null });
    expect(b.contract.start).toBe('2026-01-01');
    expect(p.issues.some((i) => i.level === 'peringatan' && /31 April/.test(i.message))).toBe(true);
  });

  it('kolom DENDA ganda memakai yang terakhir', () => {
    const sh = detail(); const hdr = [...H, 'DENDA', 'NILAI DITERIMA', 'DENDA'];
    sh.rows[2] = hdr;
    for (const r of sh.rows.slice(3)) r.push(1_200_000_000, 1, null);
    sh.rows[3][hdr.length - 1] = 5_000;
    const [a] = parsePpkWorkbook([summary, sh], 2026).chains;
    expect(a.bills.map((b) => b.deduction)).toEqual([5_000, 0, 0, 0]);
  });
});

describe('impor ke database', () => {
  let db: DB; let s: PpkStore; let admin: Actor; let fy: string; let prog: string;
  const n = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  beforeEach(async () => {
    db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
    admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
    setPin(db, admin, admin.id, '123456');
    fy = (db.prepare('SELECT id FROM ppk_fiscal_years WHERE year = 2026').get() as { id: string }).id;
    prog = String((await saveMaster(s, admin, 'programs', { code: 'SATRIA', name: 'SATRIA-1', is_active: true })).id);
  });
  const run = (commit: boolean, sheets = [summary, detail()]) => runPpkImport(s, admin, sheets, { fiscal_year_id: fy, program_id: prog, file_name: 'rekap.xlsx' }, commit);

  it('pratinjau menghitung hasil tanpa menulis apa pun', async () => {
    const before = n('audit_log');
    const r = await run(false);
    expect(r.committed).toBe(false);
    expect(r.counts).toMatchObject({ budget_lines: 3, vendors: 2, contracts: 2, addendums: 1, bills_verified: 4, bills_draft: 1, bills_failed: 0, billed: 1_650_000_000 });
    expect([n('ppk_contracts'), n('ppk_bills'), n('ppk_budget_lines'), n('ppk_vendors'), n('audit_log')]).toEqual([0, 0, 0, 0, before]);
  });

  it('simpan mencatat kontrak, addendum, tagihan terverifikasi, dan pembagian dana', async () => {
    const r = await run(true);
    expect(r.counts).toMatchObject({ contracts: 2, bills_verified: 4, bills_draft: 1 });
    expect(db.prepare("SELECT status, COUNT(*) n FROM ppk_bills GROUP BY status ORDER BY status").all()).toEqual([{ status: 'diverifikasi', n: 4 }, { status: 'draft', n: 1 }]);
    expect(n('ppk_contract_addendums')).toBe(1);
    // Tagihan BLU masuk ke baris DIPA dulu, bukan saldo kas.
    expect(db.prepare(`SELECT bl.kind, f.amount FROM ppk_bill_funding f JOIN ppk_bills b ON b.id = f.bill_id JOIN ppk_budget_lines bl ON bl.id = f.budget_line_id
      JOIN ppk_contracts c ON c.id = b.contract_id WHERE c.contract_number = 'KTR-002'`).all()).toEqual([{ kind: 'dipa', amount: 100_000_000 }]);
    expect(n("audit_log WHERE action = 'ppk.import.excel'")).toBe(1);
  });

  it('impor ulang tidak menimpa atau menggandakan data', async () => {
    await run(true);
    const bills = n('ppk_bills');
    const r = await run(true);
    expect(r.counts).toMatchObject({ contracts: 0, contracts_existing: 2, budget_lines: 0, budget_lines_existing: 3, bills_verified: 0 });
    expect([n('ppk_bills'), n('ppk_vendors'), n('ppk_budget_lines')]).toEqual([bills, 2, 3]);
  });

  it('tagihan yang gagal tidak membatalkan sisa impor', async () => {
    const bad = row({ 'PERIODE TAGIHAN': 'JUNI', 'NILAI TAGIHAN': 10_000_000, 'NOMOR & TANGGAL INVOICE': 'INV-X tanggal 1 Juli 2026', 'SUMBER DANA': 'PNBP', MAK });
    const r = await run(true, [summary, detail([bad])]);
    expect(r.counts).toMatchObject({ bills_failed: 1, bills_verified: 4, bills_draft: 1 });
    expect(r.issues.some((i) => i.level === 'galat' && /PNBP/.test(i.message))).toBe(true);
    expect(n('ppk_bills')).toBe(5);
  });
});

describe('savepoint PpkStore', () => {
  it('kegagalan transaksi dalam hanya membatalkan bagiannya', async () => {
    const db = openDatabase(':memory:'); const s = sqliteStore(db);
    db.exec('CREATE TABLE t (v INTEGER)');
    await s.tx(async (o) => {
      await o.run('INSERT INTO t VALUES (1)');
      await o.tx(async (i) => { await i.run('INSERT INTO t VALUES (2)'); throw new Error('x'); }).catch(() => {});
      await o.run('INSERT INTO t VALUES (3)');
    });
    expect(db.prepare('SELECT v FROM t ORDER BY v').all()).toEqual([{ v: 1 }, { v: 3 }]);
  });
});
