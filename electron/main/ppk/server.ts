/**
 * Pilihan penyimpanan PPK komputer ini: SQLite lokal (bawaan) atau server PostgreSQL bersama di LAN.
 * Konfigurasi disimpan di tabel settings lokal; kata sandi server dienkripsi safeStorage dan tidak pernah dikirim ke renderer.
 */
import { safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type pg from 'pg';
import type { Actor } from '@shared/numbering';
import type { DB } from '../db';
import { getRawSetting, setSettings } from '../repo';
import { currentActor } from '../numbering/session';
import { sqliteStore, type PpkStore } from './store';
import { PpkError, requirePpk } from './access';
import { createPool, dumpServer, pgStatus, pgStore, PG_SCHEMA_VERSION, PG_TABLES, type PgConfig, type PgStatus } from './pg';

export type PpkDbMode = 'lokal' | 'server';
export type ServerConf = Omit<PgConfig, 'password'>;
const MODE = 'ppk_db_mode'; const CONF = 'ppk_server'; const PW = 'ppk_server_pw_enc';

let pool: pg.Pool | null = null; let poolKey = '';
let session: Actor | null = null;

export const dbMode = (db: DB): PpkDbMode => (getRawSetting(db, MODE) === 'server' ? 'server' : 'lokal');
export function serverConf(db: DB): ServerConf | null {
  const raw = getRawSetting(db, CONF);
  return raw ? (JSON.parse(raw) as ServerConf) : null;
}
const hasPassword = (db: DB) => !!getRawSetting(db, PW);

function fullConf(db: DB): PgConfig {
  const c = serverConf(db);
  if (!c) throw new PpkError('INVALID', 'Server PPK belum diatur.');
  const enc = getRawSetting(db, PW);
  return { ...c, password: enc ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : '' };
}

export function serverPool(db: DB): pg.Pool {
  const key = `${getRawSetting(db, CONF)}|${getRawSetting(db, PW)}`;
  if (!pool || key !== poolKey) { void pool?.end().catch(() => undefined); pool = createPool(fullConf(db)); poolKey = key; }
  return pool;
}

/** Simpan alamat server. Kata sandi kosong = pakai kata sandi tersimpan. Sesi server direset. */
export function saveServerConf(db: DB, c: PgConfig) {
  const values: Record<string, string> = { [CONF]: JSON.stringify({ host: c.host, port: c.port, database: c.database, user: c.user }) };
  if (c.password) {
    if (!safeStorage.isEncryptionAvailable()) throw new PpkError('INVALID', 'Penyimpanan aman sistem operasi tidak tersedia; kata sandi server tidak disimpan.');
    values[PW] = safeStorage.encryptString(c.password).toString('base64');
  }
  setSettings(db, values);
  session = null;
}

/** Uji koneksi dengan isian form (kata sandi kosong = kata sandi tersimpan) tanpa menyimpan. */
export async function testServer(db: DB, c: PgConfig): Promise<PgStatus> {
  const password = c.password || (hasPassword(db) ? fullConf(db).password : '');
  const p = createPool({ ...c, password });
  try { return await pgStatus(p); } finally { await p.end().catch(() => undefined); }
}

export function setDbMode(db: DB, mode: PpkDbMode) { setSettings(db, { [MODE]: mode }); session = null; }

/** Store PPK aktif sesuai mode. */
export const ppkStore = (db: DB): PpkStore => (dbMode(db) === 'server' ? pgStore(serverPool(db)) : sqliteStore(db));

/** Pengguna PPK aktif: di mode server = pengguna yang masuk ke server dengan PIN. */
export function ppkActor(db: DB): Actor {
  if (dbMode(db) === 'lokal') return currentActor(db);
  if (!session) throw new PpkError('LOGIN_REQUIRED', 'Masuk ke server PPK dengan PIN terlebih dahulu.');
  return session;
}
export function peekPpkActor(db: DB): Actor | null { try { return ppkActor(db); } catch { return null; } }
export const setServerSession = (a: Actor | null) => { session = a; };
export const serverSession = () => session;

/** Pengaturan server hanya oleh administrator lokal ber-PIN (sama dengan restore backup). */
export async function requireLocalAdmin(db: DB): Promise<Actor> {
  const a = currentActor(db);
  await requirePpk(sqliteStore(db), a, 'roles');
  if (a.role !== 'admin') throw new PpkError('FORBIDDEN', 'Hanya administrator aplikasi yang dapat mengatur server PPK.');
  return a;
}

/** Komputer dengan versi aplikasi lain tidak boleh menulis ke skema yang berbeda. */
export function assertSchema(st: PgStatus) {
  if (st.schema === null) throw new PpkError('INVALID', 'Database server masih kosong. Siapkan server dulu dari komputer administrator.');
  if (st.schema !== PG_SCHEMA_VERSION)
    throw new PpkError('INVALID', `Versi data server (${st.schema}) berbeda dengan aplikasi ini (${PG_SCHEMA_VERSION}). Samakan versi aplikasi di semua komputer.`);
}

// ---------- Backup server ----------

const SERVER_RE = /^ppk-server-\d{8}-\d{6}\.json\.gz$/;
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

export interface ServerBackup { format: 'ppk-server-backup'; schema: number; created_at: string; tables: Record<string, Record<string, unknown>[]> }

/** Tulis backup server (JSON gzip) lalu baca ulang dan cocokkan jumlah baris sebelum dianggap jadi. */
export async function writeServerBackup(p: pg.Pool, dir: string, now = new Date()): Promise<{ path: string; size: number; rows: number }> {
  const tables = await dumpServer(p);
  const data: ServerBackup = { format: 'ppk-server-backup', schema: PG_SCHEMA_VERSION, created_at: now.toISOString(), tables };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ppk-server-${stamp(now)}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(data)));
  const back = readServerBackup(file);
  const rows = PG_TABLES.reduce((a, t) => a + (tables[t]?.length ?? 0), 0);
  if (PG_TABLES.some((t) => (back.tables[t]?.length ?? 0) !== (tables[t]?.length ?? 0))) { fs.rmSync(file, { force: true }); throw new Error('Backup server gagal diverifikasi.'); }
  return { path: file, size: fs.statSync(file).size, rows };
}

export function readServerBackup(file: string): ServerBackup {
  let b: ServerBackup;
  try { b = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')); } catch { throw new PpkError('INVALID', 'Berkas bukan backup server PPK yang valid.'); }
  if (b?.format !== 'ppk-server-backup' || typeof b.tables !== 'object') throw new PpkError('INVALID', 'Berkas bukan backup server PPK yang valid.');
  // Backup versi lama boleh: tabel yang belum ada saat itu dipulihkan kosong.
  if (!(b.schema <= PG_SCHEMA_VERSION)) throw new PpkError('INVALID', `Backup dari aplikasi versi lebih baru (data ${b.schema}); aplikasi ini versi ${PG_SCHEMA_VERSION}.`);
  return b;
}

/** Backup otomatis harian server (dipanggil penjadwal backup); simpan `keep` terbaru di folder yang sama. */
export async function autoServerBackup(db: DB, dir: string, keep: number, now = new Date()) {
  if (dbMode(db) !== 'server') return null;
  const last = getRawSetting(db, 'ppk_server_backup_at');
  if (last && now.getTime() - Date.parse(last) < 24 * 3600_000) return null;
  const r = await writeServerBackup(serverPool(db), dir, now);
  setSettings(db, { ppk_server_backup_at: now.toISOString() });
  for (const n of fs.readdirSync(dir).filter((x) => SERVER_RE.test(x)).sort().reverse().slice(Math.max(1, keep))) fs.rmSync(path.join(dir, n), { force: true });
  return r;
}
