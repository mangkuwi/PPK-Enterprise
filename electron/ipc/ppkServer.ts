import { dialog } from 'electron';
import fs from 'node:fs';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { defaultBackupDir, getDb } from '../main/database';
import { getSettings } from '../main/repo';
import { getMainWindow } from '../main/window';
import { requirePpk } from '../main/ppk/access';
import {
  copyIntoServer, createServerUser, initFreshServer, installPgSchema, listServerUsers, pgStatus, pgStore, serverLogin, setServerUserActive, setServerUserPin,
  sqliteSource, PG_SCHEMA_VERSION, type PgStatus
} from '../main/ppk/pg';
import {
  assertSchema, dbMode, ppkActor, readServerBackup, requireLocalAdmin, saveServerConf, serverConf, serverPool, serverSession, setDbMode, setServerSession,
  testServer, writeServerBackup
} from '../main/ppk/server';

const conf = z.object({ host: z.string().trim().min(1).max(200), port: z.number().int().min(1).max(65535), database: z.string().trim().min(1).max(63),
  user: z.string().trim().min(1).max(63), password: z.string().max(200) });
const pin = z.string().regex(/^\d{4,12}$/, 'PIN harus 4–12 digit angka.');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Server berisi skema: perbarui bila dibuat versi aplikasi lama (migrasi hanya menambah), lalu cek versinya sama. */
async function ready(pool: Parameters<typeof pgStatus>[0]) {
  if ((await pgStatus(pool)).schema !== null) await installPgSchema(pool);
  const st = await pgStatus(pool);
  assertSchema(st);
  return st;
}

/** Server PPK (PostgreSQL di LAN): atur koneksi, siapkan, masuk, kelola pengguna, backup. */
export function registerPpkServerHandlers() {
  const db = () => getDb();

  handle('ppk:server:status', S.empty, async () => {
    const c = serverConf(db());
    let server: PgStatus | null = null; let error: string | null = null;
    if (c) try { server = await pgStatus(serverPool(db())); } catch (e) { error = errText(e); }
    return { mode: dbMode(db()), conf: c, server, error, app_schema: PG_SCHEMA_VERSION, session: serverSession() };
  });
  handle('ppk:server:test', conf, (c) => testServer(db(), c));
  handle('ppk:server:configure', conf, async (c) => {
    await requireLocalAdmin(db());
    if (dbMode(db()) === 'server') throw new Error('Kembali ke data lokal dulu sebelum mengganti server.');
    const st = await testServer(db(), c);
    saveServerConf(db(), c);
    return st;
  });

  // copy: pindahkan data PPK komputer ini ke server kosong. fresh: server kosong baru, administrator = pengguna ini dengan PIN baru. join: server sudah berisi.
  handle('ppk:server:setup', z.object({ action: z.enum(['copy', 'fresh', 'join']), pin: z.string().max(12).optional() }), async ({ action, pin: p }) => {
    const admin = await requireLocalAdmin(db());
    const pool = serverPool(db());
    if (action !== 'join') {
      await installPgSchema(pool);
      if (action === 'copy') {
        const r = await copyIntoServer(pool, sqliteSource(db()));
        setDbMode(db(), 'server'); setServerSession(admin); // PIN sudah diperiksa di komputer ini (requireLocalAdmin)
        return { copied: r.tables };
      }
      await initFreshServer(pool, { id: admin.id, name: admin.name }, pin.parse(p ?? ''));
    } else {
      const st = await ready(pool);
      if (!st.users) throw new Error('Server belum berisi pengguna. Pilih "Pindahkan data" atau "Server baru".');
    }
    setDbMode(db(), 'server');
    return { copied: [] };
  });
  handle('ppk:server:useLocal', S.empty, async () => {
    await requireLocalAdmin(db());
    setDbMode(db(), 'lokal');
    return true;
  });

  handle('ppk:server:users', S.empty, () => listServerUsers(pgStore(serverPool(db()))));
  handle('ppk:server:login', z.object({ user_id: S.id, pin: z.string().max(12) }), async ({ user_id, pin: p }) => {
    const pool = serverPool(db());
    await ready(pool);
    const a = await serverLogin(pgStore(pool), user_id, p);
    setServerSession(a);
    return a;
  });
  handle('ppk:server:logout', S.empty, () => { setServerSession(null); return true; });
  handle('ppk:server:createUser', z.object({ name: z.string().max(80), pin }), (i) => createServerUser(pgStore(serverPool(db())), ppkActor(db()), i));
  handle('ppk:server:setPin', z.object({ user_id: S.id, pin }), async ({ user_id, pin: p }) => { await setServerUserPin(pgStore(serverPool(db())), ppkActor(db()), user_id, p); return true; });
  handle('ppk:server:setActive', z.object({ user_id: S.id, active: z.boolean() }), async ({ user_id, active }) => {
    await setServerUserActive(pgStore(serverPool(db())), ppkActor(db()), user_id, active); return true;
  });

  // Backup berisi hash PIN pengguna server, jadi hanya Admin PPK.
  handle('ppk:server:backup', S.empty, async () => {
    const pool = serverPool(db());
    await requirePpk(pgStore(pool), ppkActor(db()), 'roles');
    const s = getSettings(db());
    return writeServerBackup(pool, s.backup_dir && fs.existsSync(s.backup_dir) ? s.backup_dir : defaultBackupDir());
  });
  // Pulihkan hanya ke server kosong (tidak ada data yang tertimpa); dilakukan administrator lokal sebelum server dipakai.
  handle('ppk:server:restore', S.empty, async () => {
    await requireLocalAdmin(db());
    const res = await dialog.showOpenDialog(getMainWindow()!, { properties: ['openFile'], filters: [{ name: 'Backup server PPK', extensions: ['gz'] }] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true as const };
    const b = readServerBackup(res.filePaths[0]);
    const pool = serverPool(db());
    await installPgSchema(pool);
    const r = await copyIntoServer(pool, async (t) => b.tables[t] ?? []);
    return { canceled: false as const, tables: r.tables };
  });
}
