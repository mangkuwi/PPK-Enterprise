// Modul PPK di PostgreSQL asli. Jalan bila PPK_TEST_PG diisi, mis. postgres://postgres@127.0.0.1:5432/postgres
// (pengguna yang boleh CREATE DATABASE). Tanpa itu dilewati; CI menjalankannya di job "postgres".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { listMaster, listTaxRates, saveMaster } from '../electron/main/ppk/master';
import { runPpkImport } from '../electron/main/ppk/import';
import { ppkReport } from '../electron/main/ppk/reports';
import { listVendors, createVendor } from '../electron/main/ppk/vendors';
import { getBudgetPlan, listBudgetLines, listBudgetVersions, setBudgetPlan } from '../electron/main/ppk/budget';
import { getContract, listContracts } from '../electron/main/ppk/contracts';
import { addPayment, getBill, listBills, saveBill, setBillStatus, voidPayment } from '../electron/main/ppk/bills';
import { addSp2d, sp2dReport } from '../electron/main/ppk/sp2d';
import { listPpkUsers } from '../electron/main/ppk/access';
import {
  copyIntoServer, createPool, createServerUser, dumpServer, initFreshServer, installPgSchema, listServerUsers, pgStatus, pgStore, PG_TABLES,
  serverLogin, sqliteSource, toPg, type PgConfig
} from '../electron/main/ppk/pg';
import { MASTER_KEYS } from '@shared/ppk/master';
import type { BillInput } from '@shared/ppk/bills';
import type { Actor } from '@shared/numbering';
import { detail, summary } from './fixtures/ppkSheets';

const URL_ = process.env.PPK_TEST_PG;

it('toPg mengganti ? menjadi $n kecuali di dalam kutipan', () => {
  expect(toPg("SELECT * FROM t WHERE a = ? AND b LIKE '%?%' AND c IN (?, ?)")).toBe("SELECT * FROM t WHERE a = $1 AND b LIKE '%?%' AND c IN ($2, $3)");
});

describe.skipIf(!URL_)('PostgreSQL', () => {
  const cfg = (database: string): PgConfig => {
    const u = new URL(URL_!);
    return { host: u.hostname, port: Number(u.port || 5432), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database };
  };
  const made: string[] = [];
  const pools: pg.Pool[] = [];
  let root: pg.Pool;
  const freshPool = async () => {
    const name = `ppk_test_${randomBytes(4).toString('hex')}`;
    await root.query(`CREATE DATABASE ${name}`); made.push(name);
    const p = createPool(cfg(name)); pools.push(p);
    await installPgSchema(p);
    return p;
  };

  // Data SQLite: impor spreadsheet + pembayaran + SP2D + RPD, sama seperti pemakaian satu komputer.
  let db: DB; let lite: PpkStore; let admin: Actor; let fy: string;
  let pool: pg.Pool; let srv: PpkStore;

  beforeAll(async () => {
    root = createPool(cfg(new URL(URL_!).pathname.slice(1) || 'postgres'));
    db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); lite = sqliteStore(db);
    admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
    setPin(db, admin, admin.id, '123456');
    fy = (db.prepare('SELECT id FROM ppk_fiscal_years WHERE year = 2026').get() as { id: string }).id;
    const prog = String((await saveMaster(lite, admin, 'programs', { code: 'SATRIA', name: 'SATRIA-1', is_active: true })).id);
    await runPpkImport(lite, admin, [summary, detail()], { fiscal_year_id: fy, program_id: prog, file_name: 'rekap.xlsx' }, true);
    const b = (await listBills(lite, admin, {})).find((x) => x.status === 'diverifikasi')!;
    const f = (await getBill(lite, admin, b.id)).funding[0];
    await addPayment(lite, admin, f.id, { channel: 'SAKTI', reference_number: 'SP2D-X', payment_date: '2026-03-01', amount: f.amount, notes: '' });
    await voidPayment(lite, admin, (await getBill(lite, admin, b.id)).funding[0].payments[0].id, 'salah nomor');
    await addPayment(lite, admin, f.id, { channel: 'SAKTI', reference_number: 'SP2D-1', payment_date: '2026-03-02', amount: f.amount, notes: 'ok' });
    await addSp2d(lite, admin, fy, { sp2d_number: 'SP2D-1', sp2d_date: '2026-03-02', amount: f.amount, notes: '' });
    const line = (await listBudgetLines(lite, admin, { fiscal_year_id: fy }))[0];
    await setBudgetPlan(lite, admin, line.id, [{ month: '2026-01', amount: 100_000_000 }, { month: '2026-02', amount: 200_000_000 }]);

    pool = await freshPool(); srv = pgStore(pool);
  }, 60_000);

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end()));
    for (const n of made) await root.query(`DROP DATABASE IF EXISTS ${n} WITH (FORCE)`);
    await root?.end();
  });

  it('kolom tabel server sama persis dengan SQLite', async () => {
    for (const t of PG_TABLES) {
      const a = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
      const b = (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position', [t])).rows.map((r) => r.column_name);
      expect(b, t).toEqual(a);
    }
  });

  it('salin SQLite → server: jumlah baris dan total rupiah cocok, semua tampilan sama', async () => {
    const r = await copyIntoServer(pool, sqliteSource(db));
    expect(r.tables.find((x) => x.table === 'ppk_bills')).toMatchObject({ rows: 5 });
    expect((await pgStatus(pool)).schema).toBe(11);
    const same = async <T>(f: (s: PpkStore) => Promise<T>) => expect(await f(srv)).toEqual(await f(lite));
    await same((s) => listBudgetLines(s, admin, { fiscal_year_id: fy, include_inactive: true }));
    await same((s) => listContracts(s, admin, {}));
    await same((s) => listBills(s, admin, {}));
    await same((s) => listVendors(s, admin, {}));
    await same((s) => listTaxRates(s, admin));
    await same((s) => listPpkUsers(s, admin));
    for (const k of MASTER_KEYS) await same((s) => listMaster(s, admin, k));
    for (const c of await listContracts(lite, admin, {})) await same((s) => getContract(s, admin, c.id));
    for (const b of await listBills(lite, admin, {})) await same((s) => getBill(s, admin, b.id));
    for (const l of await listBudgetLines(lite, admin, { fiscal_year_id: fy })) {
      await same((s) => listBudgetVersions(s, admin, l.id));
      await same((s) => getBudgetPlan(s, admin, l.id));
    }
    for (const cutoff of ['2026-01', '2026-03', '2026-12']) for (const ext of [false, true]) await same((s) => ppkReport(s, admin, fy, cutoff, ext));
    await same((s) => sp2dReport(s, admin, fy));
    // Server yang sudah berisi tidak bisa ditimpa.
    await expect(copyIntoServer(pool, sqliteSource(db))).rejects.toThrow(/sudah berisi data/);
  });

  it('aturan riwayat tetap dijaga trigger PostgreSQL', async () => {
    const verified = (await listBills(srv, admin, {})).find((x) => x.status === 'diverifikasi')!;
    await expect(pool.query('UPDATE ppk_bills SET amount = 1 WHERE id = $1', [verified.id])).rejects.toThrow(/tidak dapat diubah/);
    await expect(pool.query("DELETE FROM ppk_vendors WHERE true")).rejects.toThrow(/tidak boleh dihapus/);
    await expect(pool.query("UPDATE audit_log SET action = 'x' WHERE true")).rejects.toThrow(/append-only/);
    await expect(pool.query('UPDATE ppk_budget_versions SET amount = 1 WHERE true')).rejects.toThrow(/tidak boleh diubah/);
    await expect(pool.query('DELETE FROM ppk_bill_funding WHERE bill_id = $1', [verified.id])).rejects.toThrow(/terkunci/);
    await expect(pool.query("UPDATE ppk_payments SET amount = 1 WHERE true")).rejects.toThrow(/dibatalkan sekali/);
    // Domain lewat server: vendor ganda tetap ditolak.
    await expect(createVendor(srv, admin, { name: 'PT Satelit Nusantara', npwp: '', nib: '', address: '', contact_person: '', email: '', phone: '', bank_name: '', account_number: '', account_holder: '',
      service_category_id: null, notes: '' }))
      .rejects.toThrow(/sudah terdaftar/);
  });

  it('dua pengguna menagih sisa kontrak yang sama bersamaan: hanya satu yang lolos', async () => {
    const k = (await listContracts(srv, admin, {})).find((c) => c.contract_number === 'KTR-001')!;
    const remaining = k.sisa_kontrak;
    expect(remaining).toBeGreaterThan(0);
    const line = (await listBudgetLines(srv, admin, { fiscal_year_id: fy })).find((l) => l.source_code === 'RM')!;
    const half = Math.floor(remaining / 2) + 1; // dua tagihan = lebih dari sisa
    const bill = (n: string): BillInput => ({ contract_id: k.id, bill_number: n, bill_date: '2026-07-05', received_date: null, service_month: '2026-07', period_start: null,
      period_end: null, amount: half, pass_through: 0, faktur_code: null, faktur_number: '', ppn: null, pph23: null, deduction: 0, deduction_reason: '', fx_rate: '', fx_amount: '',
      ba_number: '', ba_date: null, official_id: null, notes: '', funding: [{ budget_line_id: line.id, amount: half }] } as unknown as BillInput);
    const res = await Promise.allSettled([saveBill(srv, admin, null, null, bill('CC-1')), saveBill(pgStore(pool), admin, null, null, bill('CC-2'))]);
    expect(res.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(String((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/sisa kontrak/);
    expect((await getContract(srv, admin, k.id)).contract.sisa_kontrak).toBe(remaining - half);
    const ok = res.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ data: { id: string } }>;
    await setBillStatus(srv, admin, ok.value.data.id, 'dibatalkan', 'uji');
  });

  it('masuk server wajib PIN dan tercatat di audit', async () => {
    expect((await listServerUsers(srv)).map((u) => u.id)).toContain(admin.id);
    await expect(serverLogin(srv, admin.id, '000000')).rejects.toThrow(/PIN salah/);
    expect(await serverLogin(srv, admin.id, '123456')).toEqual(admin);
    const op = await createServerUser(srv, admin, { name: 'Operator Satu', pin: '4321' });
    await expect(createServerUser(srv, admin, { name: 'operator satu', pin: '4321' })).rejects.toThrow(/sudah dipakai/);
    expect(await serverLogin(srv, op.id, '4321')).toMatchObject({ name: 'Operator Satu', role: 'operator' });
    const acts = (await pool.query("SELECT action FROM audit_log WHERE action LIKE 'ppk.server.%' ORDER BY at")).rows.map((r) => r.action);
    expect(acts).toEqual(['ppk.server.login_failed', 'ppk.server.login', 'ppk.server.user_create', 'ppk.server.login']);
  });

  it('backup server dapat dipulihkan ke server kosong lain dengan isi sama', async () => {
    const dump = await dumpServer(pool);
    const other = await freshPool();
    await copyIntoServer(other, async (t) => dump[t]);
    expect(await dumpServer(other)).toEqual(dump);
  });

  it('server baru: impor spreadsheet langsung di server (pratinjau dibatalkan, savepoint per item)', async () => {
    const p = await freshPool(); const s = pgStore(p);
    await expect(initFreshServer(p, { id: 'adm', name: 'Admin Server' }, '12')).rejects.toThrow(/PIN/);
    await initFreshServer(p, { id: 'adm', name: 'Admin Server' }, '123456');
    await expect(initFreshServer(p, { id: 'x', name: 'X' }, '123456')).rejects.toThrow(/sudah berisi/);
    const a = await serverLogin(s, 'adm', '123456');
    await s.run('UPDATE ppk_fiscal_years SET year = 2026');
    const year = (await listMaster(s, a, 'fiscal_years'))[0].id;
    const prog = String((await saveMaster(s, a, 'programs', { code: 'SATRIA', name: 'SATRIA-1', is_active: true })).id);
    const o = { fiscal_year_id: year, program_id: prog, file_name: 'rekap.xlsx' };
    const dry = await runPpkImport(s, a, [summary, detail()], o, false);
    expect((await p.query('SELECT count(*) n FROM ppk_bills')).rows[0].n).toBe(0);
    const real = await runPpkImport(s, a, [summary, detail()], o, true);
    expect(real.counts).toEqual(dry.counts);
    expect(real.counts).toMatchObject({ contracts: 2, bills_verified: 4, bills_draft: 1, billed: 1_650_000_000 });
    const r = await ppkReport(s, a, year, '2026-03', false);
    expect(r.total).toMatchObject({ pagu: 2_800_000_000, billed: 1_650_000_000, estimate: 250_000_000 });
  });
});
