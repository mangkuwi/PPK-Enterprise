/**
 * Modul PPK di PostgreSQL (Tahap 6, multiuser LAN). Hanya tabel PPK + pengguna + audit yang pindah ke server;
 * modul dokumen dan penomoran tetap di SQLite lokal tiap komputer (keputusan Fase 0, jalur A).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import type { Actor } from '@shared/numbering';
import { MIGRATIONS } from '../migrations';
import type { Param, PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';

export interface PgConfig { host: string; port: number; database: string; user: string; password: string }

// int8 (rupiah BIGINT, COUNT) dan numeric (SUM atas BIGINT) dikembalikan sebagai number seperti di SQLite.
// Rupiah aman sebagai number sampai 9 kuadriliun (Number.MAX_SAFE_INTEGER).
const types = {
  getTypeParser: (oid: number, format?: 'text' | 'binary') =>
    oid === 20 || oid === 1700 ? (v: string) => (v === null ? null : Number(v)) : pg.types.getTypeParser(oid, format as 'text')
};

export function createPool(c: PgConfig): pg.Pool {
  const pool = new pg.Pool({ ...c, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, types, application_name: 'PPK Management' });
  pool.on('error', () => { /* koneksi menganggur putus (server restart); pool membuat koneksi baru saat dipakai */ });
  return pool;
}

/** `?` → `$1, $2, ...`, melewati teks dalam tanda kutip. */
const cache = new Map<string, string>();
export function toPg(sql: string): string {
  let out = cache.get(sql);
  if (out !== undefined) return out;
  let n = 0; let q: string | null = null; out = '';
  for (const ch of sql) {
    if (q) { if (ch === q) q = null; out += ch; }
    else if (ch === "'" || ch === '"') { q = ch; out += ch; }
    else out += ch === '?' ? `$${++n}` : ch;
  }
  cache.set(sql, out);
  return out;
}

type Querier = Pick<pg.Pool, 'query'> | pg.PoolClient;

/** Galat koneksi/izin server diterjemahkan; galat lain (constraint, trigger) diteruskan apa adanya. */
const NET: Record<string, string> = {
  ECONNREFUSED: 'Server PPK menolak koneksi. Pastikan PostgreSQL berjalan dan port tidak diblokir firewall.',
  ETIMEDOUT: 'Server PPK tidak menjawab. Periksa alamat server dan jaringan LAN.',
  ENOTFOUND: 'Alamat server PPK tidak ditemukan.', EHOSTUNREACH: 'Server PPK tidak dapat dijangkau dari komputer ini.',
  '28P01': 'Nama pengguna atau kata sandi database server salah.', '28000': 'Komputer ini belum diizinkan di pg_hba.conf server.',
  '3D000': 'Nama database di server tidak ditemukan.', '57P01': 'Server PPK sedang dimatikan; coba lagi sebentar.'
};
export function pgFriendly(e: unknown): unknown {
  const code = (e as { code?: string })?.code ?? '';
  const msg = NET[code] ?? (/timeout exceeded when trying to connect|Connection terminated/i.test(String((e as Error)?.message)) ? NET.ETIMEDOUT : null);
  return msg ? Object.assign(new Error(msg), { code }) : e;
}
const ask = (q: Querier, sql: string, p: Param[]) => q.query(toPg(sql), p).catch((e) => { throw pgFriendly(e); });
const RETRY = new Set(['40001', '40P01']); // serialization_failure, deadlock_detected

/**
 * Transaksi SERIALIZABLE: dua pengguna yang membebani sisa pagu yang sama tidak bisa sama-sama lolos.
 * PostgreSQL membatalkan salah satunya (40001); transaksi itu diulang otomatis sampai 5 kali.
 */
export function pgStore(pool: pg.Pool): PpkStore {
  const on = (q: Querier, depth: number): PpkStore => {
    const s: PpkStore = {
      all: async <T>(sql: string, p: Param[] = []) => (await ask(q, sql, p)).rows as T[],
      get: async <T>(sql: string, p: Param[] = []) => (await ask(q, sql, p)).rows[0] as T | undefined,
      run: async (sql, p = []) => ({ changes: (await ask(q, sql, p)).rowCount ?? 0 }),
      tx: async (fn) => {
        if (depth > 0) {
          const sp = `sp_${depth}`;
          await q.query(`SAVEPOINT ${sp}`);
          try { const r = await fn(on(q, depth + 1)); await q.query(`RELEASE SAVEPOINT ${sp}`); return r; }
          catch (e) { await q.query(`ROLLBACK TO SAVEPOINT ${sp}`); await q.query(`RELEASE SAVEPOINT ${sp}`); throw e; }
        }
        for (let attempt = 1; ; attempt++) {
          const c = await pool.connect().catch((e) => { throw pgFriendly(e); });
          try {
            await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            const r = await fn(on(c, 1));
            await c.query('COMMIT');
            return r;
          } catch (e) {
            await c.query('ROLLBACK').catch(() => undefined);
            if (attempt < 5 && RETRY.has((e as { code?: string }).code ?? '')) { await new Promise((ok) => setTimeout(ok, 20 * attempt + Math.random() * 50)); continue; }
            throw e;
          } finally { c.release(); }
        }
      }
    };
    return s;
  };
  return on(pool, 0);
}

// ---------- Skema ----------

/** Urutan tabel = urutan pembuatan (aman untuk foreign key saat menyalin). */
export const PG_TABLES = ['app_users', 'audit_log', 'ppk_user_roles', 'ppk_fiscal_years', 'ppk_units', 'ppk_officials', 'ppk_programs', 'ppk_activities',
  'ppk_funding_sources', 'ppk_budget_accounts', 'ppk_service_categories', 'ppk_service_packages', 'ppk_tax_rates', 'ppk_vendors',
  'ppk_budget_lines', 'ppk_budget_versions', 'ppk_contracts', 'ppk_contract_addendums', 'ppk_contract_schedules', 'ppk_contract_funding_allocations',
  'ppk_bills', 'ppk_bill_funding', 'ppk_payments', 'ppk_budget_plans', 'ppk_sp2d_records', 'ppk_contract_year_values', 'ppk_invitations', 'ppk_files', 'ppk_invitation_extractions', 'ppk_agendas', 'ppk_agenda_assignees',
  'ppk_user_phones', 'ppk_notifications'] as const;

/** Migrasi SQLite yang berisi tabel PPK (v12 = tabel undangan modul dokumen, tetap lokal). */
const PG_MIGRATIONS = [8, 9, 10, 11, 13, 14];
export const PG_SCHEMA_VERSION = PG_MIGRATIONS[PG_MIGRATIONS.length - 1];

/** Satu migrasi SQLite → PostgreSQL: INTEGER → BIGINT, trigger dan data awal SQLite dibuang (trigger ditulis ulang di PG_TRIGGERS). */
const convert = (v: number) => MIGRATIONS.find((m) => m.version === v)!.sql
  .replace(/CREATE TRIGGER[\s\S]*?\bEND;/g, '')
  .replace(/INSERT INTO[\s\S]*?\);\s*(?=\n|$)/g, '')
  .replace(/\bINTEGER\b/g, 'BIGINT')
  .replace(/\bBLOB\b/g, 'BYTEA');

/**
 * Skema server = migrasi SQLite PPK (satu sumber kolom dan constraint) + trigger PostgreSQL dengan aturan yang sama.
 * tests/ppk-postgres.test.ts mencocokkan kolom kedua skema dan menguji pembaruan server lama.
 */
export function pgSchemaSql(upTo = PG_SCHEMA_VERSION): string {
  return PG_MIGRATIONS.filter((v) => v <= upTo).map((v) => (v === 8 ? BASE : '') + convert(v) + (PG_TRIGGERS[v] ?? '')).join('\n');
}

const BASE = `
CREATE TABLE app_users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, role TEXT NOT NULL CHECK (role IN ('admin','operator')),
  pin_hash TEXT, pin_salt TEXT, is_active BIGINT NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor_id TEXT, actor_name TEXT NOT NULL, action TEXT NOT NULL,
  entity TEXT NOT NULL DEFAULT '', entity_id TEXT, detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_at ON audit_log(at);
-- Pemeriksaan dilewati hanya saat menyalin data lama ke server kosong (SET LOCAL ppk.copy = 'on' di satu transaksi).
CREATE FUNCTION ppk_copying() RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('ppk.copy', true), '') = 'on' $$;
CREATE FUNCTION ppk_forbid() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '%', TG_ARGV[0]; END $$;
CREATE TRIGGER trg_audit_noupd BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Log audit bersifat append-only.');
`;

const TRIGGERS_V8_11 = `
CREATE TRIGGER trg_ppk_vendors_nodel BEFORE DELETE ON ppk_vendors FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Penyedia tidak boleh dihapus; arsipkan saja.');
CREATE TRIGGER trg_ppk_bl_nodel BEFORE DELETE ON ppk_budget_lines FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Baris anggaran tidak boleh dihapus; nonaktifkan saja.');
CREATE TRIGGER trg_ppk_bv_noupd BEFORE UPDATE ON ppk_budget_versions FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Riwayat pagu tidak boleh diubah; catat revisi baru.');
CREATE TRIGGER trg_ppk_bv_nodel BEFORE DELETE ON ppk_budget_versions FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Riwayat pagu tidak boleh dihapus; catat revisi baru.');
CREATE TRIGGER trg_ppk_contracts_nodel BEFORE DELETE ON ppk_contracts FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Kontrak tidak boleh dihapus; ubah status menjadi dibatalkan.');
CREATE TRIGGER trg_ppk_add_nodel BEFORE DELETE ON ppk_contract_addendums FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Addendum tidak boleh dihapus; batalkan dengan alasan.');
CREATE TRIGGER trg_ppk_bills_nodel BEFORE DELETE ON ppk_bills FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Tagihan tidak boleh dihapus; batalkan dengan alasan.');
CREATE TRIGGER trg_ppk_bf_upd BEFORE UPDATE ON ppk_bill_funding FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Sumber dana tagihan tidak diubah; ganti selama draf.');
CREATE TRIGGER trg_ppk_pay_nodel BEFORE DELETE ON ppk_payments FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Pembayaran tidak boleh dihapus; batalkan dengan alasan.');
CREATE TRIGGER trg_ppk_sp2d_nodel BEFORE DELETE ON ppk_sp2d_records FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Data SP2D tidak boleh dihapus; batalkan dengan alasan.');

CREATE FUNCTION ppk_add_upd() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
    OR (NEW.contract_id, NEW.addendum_number, NEW.addendum_date, NEW.value_change, NEW.period_start, NEW.period_end, NEW.new_end_date, NEW.description)
       IS DISTINCT FROM (OLD.contract_id, OLD.addendum_number, OLD.addendum_date, OLD.value_change, OLD.period_start, OLD.period_end, OLD.new_end_date, OLD.description)
  THEN RAISE EXCEPTION 'Addendum hanya dapat dibatalkan sekali; isinya tidak dapat diubah.'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER trg_ppk_add_upd BEFORE UPDATE ON ppk_contract_addendums FOR EACH ROW EXECUTE FUNCTION ppk_add_upd();

CREATE FUNCTION ppk_bills_lock() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.status = 'dibatalkan' OR (OLD.status = 'diverifikasi' AND (NEW.status <> 'dibatalkan' OR length(trim(NEW.cancel_reason)) = 0
    OR (NEW.contract_id, NEW.bill_number, NEW.bill_date, NEW.service_month, NEW.amount, NEW.pass_through, NEW.faktur_code, NEW.dpp, NEW.ppn, NEW.pph23, NEW.deduction)
       IS DISTINCT FROM (OLD.contract_id, OLD.bill_number, OLD.bill_date, OLD.service_month, OLD.amount, OLD.pass_through, OLD.faktur_code, OLD.dpp, OLD.ppn, OLD.pph23, OLD.deduction)))
  THEN RAISE EXCEPTION 'Tagihan terverifikasi atau dibatalkan tidak dapat diubah; batalkan lalu buat tagihan baru.'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER trg_ppk_bills_lock BEFORE UPDATE ON ppk_bills FOR EACH ROW EXECUTE FUNCTION ppk_bills_lock();

CREATE FUNCTION ppk_bf_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT ppk_copying() AND (SELECT status FROM ppk_bills WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.bill_id ELSE NEW.bill_id END) <> 'draft'
  THEN RAISE EXCEPTION 'Sumber dana tagihan terkunci setelah diverifikasi.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_ppk_bf_ins BEFORE INSERT OR DELETE ON ppk_bill_funding FOR EACH ROW EXECUTE FUNCTION ppk_bf_check();

CREATE FUNCTION ppk_pay_upd() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR length(trim(coalesce(NEW.void_reason, ''))) = 0
    OR (NEW.bill_funding_id, NEW.channel, NEW.reference_number, NEW.payment_date, NEW.amount)
       IS DISTINCT FROM (OLD.bill_funding_id, OLD.channel, OLD.reference_number, OLD.payment_date, OLD.amount)
  THEN RAISE EXCEPTION 'Pembayaran hanya dapat dibatalkan sekali dengan alasan; isinya tidak dapat diubah.'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER trg_ppk_pay_upd BEFORE UPDATE ON ppk_payments FOR EACH ROW EXECUTE FUNCTION ppk_pay_upd();

CREATE FUNCTION ppk_sp2d_upd() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL OR length(trim(coalesce(NEW.void_reason, ''))) = 0
    OR (NEW.fiscal_year_id, NEW.sp2d_number, NEW.sp2d_date, NEW.amount) IS DISTINCT FROM (OLD.fiscal_year_id, OLD.sp2d_number, OLD.sp2d_date, OLD.amount)
  THEN RAISE EXCEPTION 'Data SP2D hanya dapat dibatalkan sekali dengan alasan; isinya tidak dapat diubah.'; END IF;
  RETURN NEW; END $$;
CREATE TRIGGER trg_ppk_sp2d_upd BEFORE UPDATE ON ppk_sp2d_records FOR EACH ROW EXECUTE FUNCTION ppk_sp2d_upd();
`;

/** Trigger PostgreSQL per migrasi, aturan sama dengan trigger SQLite. */
const PG_TRIGGERS: Record<number, string> = {
  11: TRIGGERS_V8_11,
  13: `CREATE TRIGGER trg_ppk_agendas_nodel BEFORE DELETE ON ppk_agendas FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Agenda tidak boleh dihapus; batalkan dengan alasan.');`,
  14: `
CREATE TRIGGER trg_ppk_inv_nodel BEFORE DELETE ON ppk_invitations FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Undangan tidak boleh dihapus; arsipkan saja.');
CREATE TRIGGER trg_ppk_files_noupd BEFORE UPDATE OR DELETE ON ppk_files FOR EACH ROW EXECUTE FUNCTION ppk_forbid('File asli tidak boleh diubah atau dihapus.');
CREATE TRIGGER trg_ppk_ext_noupd BEFORE UPDATE OR DELETE ON ppk_invitation_extractions FOR EACH ROW EXECUTE FUNCTION ppk_forbid('Hasil ekstraksi bersifat append-only.');`
};

/** Data awal untuk server baru yang tidak diisi dari data lama (sama dengan migrasi v8 SQLite). */
const SEED = `
INSERT INTO ppk_funding_sources (id, code, name, payment_channel, created_at, updated_at) VALUES
 (md5(random()::text), 'RM', 'Rupiah Murni', 'SAKTI', $1, $1),
 (md5(random()::text), 'PNBP', 'Penerimaan Negara Bukan Pajak', 'SAKTI', $1, $1),
 (md5(random()::text), 'BLU', 'Badan Layanan Umum', 'FO', $1, $1);
INSERT INTO ppk_tax_rates (id, valid_from, ppn_bp, pph23_bp, note, created_at) VALUES (md5(random()::text), '2022-04-01', 1100, 200, 'PPN 11% (UU HPP), PPh 23 2%', $1);`;

export interface PgStatus { schema: number | null; users: number; data_rows: number }

/** Versi skema di server; null = database kosong (belum dipasang). */
export async function pgStatus(pool: pg.Pool): Promise<PgStatus> {
  try { return await status(pool); } catch (e) { throw pgFriendly(e); }
}
async function status(pool: pg.Pool): Promise<PgStatus> {
  const has = (await pool.query("SELECT to_regclass('public.ppk_schema_version') IS NOT NULL AS ok")).rows[0].ok as boolean;
  if (!has) return { schema: null, users: 0, data_rows: 0 };
  const v = (await pool.query('SELECT max(version) v FROM ppk_schema_version')).rows[0].v as number;
  const users = (await pool.query('SELECT count(*) n FROM app_users')).rows[0].n as number;
  const data = (await pool.query('SELECT (SELECT count(*) FROM ppk_budget_lines) + (SELECT count(*) FROM ppk_contracts) + (SELECT count(*) FROM ppk_vendors) n')).rows[0].n as number;
  return { schema: v, users, data_rows: data };
}

/** Pasang skema di database kosong, atau perbarui server lama. Kunci advisory mencegah dua komputer memasang bersamaan. */
export async function installPgSchema(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7262011)');
    const exists = (await c.query("SELECT to_regclass('public.ppk_schema_version') IS NOT NULL AS ok")).rows[0].ok;
    const at = new Date().toISOString();
    if (!exists) {
      await c.query(pgSchemaSql());
      await c.query('CREATE TABLE ppk_schema_version (version BIGINT PRIMARY KEY, applied_at TEXT NOT NULL)');
      await c.query('INSERT INTO ppk_schema_version VALUES ($1, $2)', [PG_SCHEMA_VERSION, at]);
    } else {
      // Server dari versi aplikasi lama: terapkan migrasi PPK yang belum ada (hanya menambah tabel), satu transaksi.
      const cur = Number((await c.query('SELECT max(version) v FROM ppk_schema_version')).rows[0].v);
      if (cur > PG_SCHEMA_VERSION) throw new PpkError('INVALID', `Server dibuat aplikasi versi lebih baru (data ${cur}). Perbarui aplikasi di komputer ini.`);
      for (const v of PG_MIGRATIONS.filter((x) => x > cur)) {
        await c.query(convert(v) + (PG_TRIGGERS[v] ?? ''));
        await c.query('INSERT INTO ppk_schema_version VALUES ($1, $2)', [v, at]);
      }
    }
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}

// ---------- Pengguna server ----------

const hash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex'); // sama dengan numbering/users.ts
const validPin = (pin: string) => /^\d{4,12}$/.test(pin);

/** Server baru tanpa data lama: administrator pertama + data awal. PIN wajib karena server dipakai bersama. */
export async function initFreshServer(pool: pg.Pool, admin: { id: string; name: string }, pin: string) {
  if (!validPin(pin)) throw new PpkError('INVALID', 'PIN harus 4–12 digit angka.');
  const st = await pgStatus(pool);
  if (st.users > 0) throw new PpkError('CONFLICT', 'Server sudah berisi pengguna. Masuk dengan pengguna yang ada.');
  const now = new Date().toISOString(); const salt = randomBytes(16).toString('hex');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const stmt of SEED.split(';').map((x) => x.trim()).filter(Boolean)) await c.query(stmt, [now]);
    await c.query('INSERT INTO ppk_fiscal_years (id, year, created_at, updated_at) VALUES (md5(random()::text), $1, $2, $2)', [new Date().getFullYear(), now]);
    await c.query("INSERT INTO app_users (id, name, role, pin_hash, pin_salt, is_active, created_at) VALUES ($1,$2,'admin',$3,$4,1,$5)", [admin.id, admin.name, hash(pin, salt), salt, now]);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}

export async function listServerUsers(s: PpkStore) {
  return s.all<{ id: string; name: string }>('SELECT id, name FROM app_users WHERE is_active = 1 ORDER BY name');
}

/** Masuk ke server PPK. Semua pengguna server wajib ber-PIN. */
export async function serverLogin(s: PpkStore, userId: string, pin: string): Promise<Actor> {
  const r = await s.get<{ id: string; name: string; role: 'admin' | 'operator'; pin_hash: string | null; pin_salt: string | null }>(
    'SELECT id, name, role, pin_hash, pin_salt FROM app_users WHERE id = ? AND is_active = 1', [userId]);
  if (!r) throw new PpkError('NOT_FOUND', 'Pengguna tidak ditemukan atau nonaktif.');
  const ok = !!r.pin_hash && !!r.pin_salt && !!pin && timingSafeEqual(Buffer.from(hash(pin, r.pin_salt), 'hex'), Buffer.from(r.pin_hash, 'hex'));
  const actor: Actor = { id: r.id, name: r.name, role: r.role };
  await ppkAudit(s, actor, ok ? 'server.login' : 'server.login_failed', 'user', r.id, {});
  if (!ok) throw new PpkError('FORBIDDEN', 'PIN salah.');
  return actor;
}

export async function createServerUser(s: PpkStore, actor: Actor, i: { name: string; pin: string }) {
  const name = i.name.trim();
  if (!name || name.length > 80) throw new PpkError('INVALID', 'Nama pengguna wajib diisi (maks. 80 karakter).');
  if (!validPin(i.pin)) throw new PpkError('INVALID', 'PIN harus 4–12 digit angka.');
  return s.tx(async (t) => {
    await requirePpk(t, actor, 'roles');
    if (await t.get('SELECT 1 FROM app_users WHERE lower(name) = lower(?)', [name])) throw new PpkError('DUPLICATE', `Nama pengguna "${name}" sudah dipakai.`);
    const id = randomBytes(16).toString('hex'); const salt = randomBytes(16).toString('hex');
    await t.run("INSERT INTO app_users (id, name, role, pin_hash, pin_salt, is_active, created_at) VALUES (?,?,'operator',?,?,1,?)", [id, name, hash(i.pin, salt), salt, new Date().toISOString()]);
    await ppkAudit(t, actor, 'server.user_create', 'user', id, { name });
    return { id, name };
  });
}

export async function setServerUserPin(s: PpkStore, actor: Actor, userId: string, pin: string) {
  if (!validPin(pin)) throw new PpkError('INVALID', 'PIN harus 4–12 digit angka.');
  await s.tx(async (t) => {
    if (actor.id !== userId) await requirePpk(t, actor, 'roles');
    const salt = randomBytes(16).toString('hex');
    const r = await t.run('UPDATE app_users SET pin_hash = ?, pin_salt = ? WHERE id = ?', [hash(pin, salt), salt, userId]);
    if (!r.changes) throw new PpkError('NOT_FOUND', 'Pengguna tidak ditemukan.');
    await ppkAudit(t, actor, 'server.user_pin', 'user', userId, {});
  });
}

export async function setServerUserActive(s: PpkStore, actor: Actor, userId: string, active: boolean) {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'roles');
    const u = await t.get<{ role: string; is_active: number }>('SELECT role, is_active FROM app_users WHERE id = ?', [userId]);
    if (!u) throw new PpkError('NOT_FOUND', 'Pengguna tidak ditemukan.');
    if (u.role === 'admin' && !active && ((await t.get<{ n: number }>("SELECT count(*) n FROM app_users WHERE role = 'admin' AND is_active = 1 AND id <> ?", [userId]))?.n ?? 0) === 0)
      throw new PpkError('INVALID', 'Harus ada minimal satu administrator aktif.');
    await t.run('UPDATE app_users SET is_active = ? WHERE id = ?', [active ? 1 : 0, userId]);
    await ppkAudit(t, actor, 'server.user_active', 'user', userId, { before: !!u.is_active, after: active });
  });
}

// ---------- Salin data ----------

export type RowSource = (table: string) => Promise<Record<string, unknown>[]>;
export interface CopyReport { tables: Array<{ table: string; rows: number; rupiah: number }> }

/** Jumlah semua kolom rupiah (BIGINT selain penanda/versi/tahun) per tabel, untuk dicocokkan sesudah salin. */
async function rupiahColumns(c: pg.PoolClient, table: string): Promise<string[]> {
  const r = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND data_type = 'bigint' ORDER BY ordinal_position", [table]);
  return r.rows.map((x) => x.column_name as string).filter((n) => !/^(is_|version|year|ppn_bp|pph23_bp)/.test(n));
}
const sumOf = (rows: Record<string, unknown>[], cols: string[]) => rows.reduce((a, r) => a + cols.reduce((b, k) => b + (Number(r[k]) || 0), 0), 0);

/**
 * Salin seluruh data PPK (+ pengguna dan log audit PPK) ke server kosong dalam satu transaksi.
 * Sesudah salin, jumlah baris dan total rupiah tiap tabel dicocokkan; beda sedikit saja = dibatalkan semua.
 * Sumber tidak diubah (berkas SQLite atau backup tetap utuh).
 */
export async function copyIntoServer(pool: pg.Pool, source: RowSource): Promise<CopyReport> {
  const st = await pgStatus(pool);
  if (st.schema === null) throw new PpkError('INVALID', 'Skema server belum dipasang.');
  if (st.users > 0 || st.data_rows > 0) throw new PpkError('CONFLICT', 'Server sudah berisi data. Data hanya dapat disalin ke server kosong agar tidak ada yang tertimpa.');
  const c = await pool.connect();
  const report: CopyReport = { tables: [] };
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL ppk.copy = 'on'");
    for (const table of PG_TABLES) {
      const rows = await source(table);
      const cols = (await c.query('SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position', [table])).rows.map((x) => x.column_name as string);
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200);
        const vals: unknown[] = [];
        const tuples = chunk.map((r) => `(${cols.map((k) => { vals.push(r[k] ?? null); return `$${vals.length}`; }).join(',')})`);
        await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${tuples.join(',')}`, vals);
      }
      const money = await rupiahColumns(c, table);
      const got = (await c.query(`SELECT count(*) n${money.length ? `, ${money.map((k) => `coalesce(sum(${k}),0)`).join('+')} s` : ''} FROM ${table}`)).rows[0];
      const want = { n: rows.length, s: sumOf(rows, money) };
      if (got.n !== want.n || (money.length && Number(got.s) !== want.s))
        throw new PpkError('CONFLICT', `Pemeriksaan ${table} gagal: ${got.n}/${want.n} baris, total ${got.s ?? 0}/${want.s}. Tidak ada yang disimpan.`);
      report.tables.push({ table, rows: want.n, rupiah: want.s });
    }
    await c.query('COMMIT');
    return report;
  } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
}

/** Ambil semua baris tabel server (untuk backup JSON). */
export async function dumpServer(pool: pg.Pool): Promise<Record<string, Record<string, unknown>[]>> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); // satu potret yang konsisten
    const out: Record<string, Record<string, unknown>[]> = {};
    for (const t of PG_TABLES) out[t] = (await c.query(`SELECT * FROM ${t}`)).rows;
    await c.query('COMMIT');
    return out;
  } finally { c.release(); }
}

/** Sumber salin dari SQLite lokal: semua tabel PPK, semua pengguna, dan log audit milik modul PPK saja. */
export const sqliteSource = (db: { prepare(sql: string): { all(): unknown[] } }): RowSource => async (table) =>
  db.prepare(table === 'audit_log' ? "SELECT * FROM audit_log WHERE action LIKE 'ppk.%' ORDER BY at" : `SELECT * FROM ${table}`).all() as Record<string, unknown>[];
