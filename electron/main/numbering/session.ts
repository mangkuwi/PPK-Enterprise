import type { DB } from '../db';
import type { Actor } from '@shared/numbering';
import { NumberingError } from './errors';
import { authenticate, toActor } from './users';
import { getRawSetting, setSettings } from '../repo';

let current: Actor | null = null;

const anyPassword = (db: DB) => !!db.prepare('SELECT 1 FROM app_users WHERE is_active=1 AND pin_hash IS NOT NULL').get();
/** Belum ada satu pun kata sandi: aplikasi baru/lama, administrator diminta membuat kata sandi dulu. */
export const needsSetup = (db: DB) => getRawSetting(db, 'ppk_db_mode') !== 'server' && !anyPassword(db);
/** Masuk otomatis tanpa kata sandi hanya saat pertama kali, atau di mode server (staf masuk lewat akun server; dokumen tetap seperti dulu). */
const autoAllowed = (db: DB) => getRawSetting(db, 'ppk_db_mode') === 'server' || !anyPassword(db);

/** Pengguna aktif. Mode lokal: wajib masuk dengan kata sandi, kecuali saat belum ada kata sandi sama sekali. */
export function currentActor(db: DB): Actor {
  if (current) {
    const r = db.prepare('SELECT id, name, role, is_active FROM app_users WHERE id=?').get(current.id) as any;
    if (r && r.is_active) { current = toActor(r); return current; }
    current = null;
  }
  if (!autoAllowed(db)) throw new NumberingError('LOGIN_REQUIRED', 'Masuk dengan akun Anda terlebih dahulu.');
  const last = getRawSetting(db, 'active_user_id');
  // Saat pertama kali, selalu administrator agar dialah yang membuat kata sandi pertama.
  const order = needsSetup(db) ? 'role ASC, (id = ?) DESC' : '(id = ?) DESC, role ASC';
  const rows = db.prepare(`SELECT id, name, role, pin_hash FROM app_users WHERE is_active=1 ORDER BY ${order}, name`).all(last ?? '') as any[];
  const open = rows.find((r) => !r.pin_hash);
  if (!open) throw new NumberingError('LOGIN_REQUIRED', 'Masuk sebagai pengguna terlebih dahulu (PIN diperlukan).');
  current = toActor(open);
  return current;
}

export function peekActor(db: DB): Actor | null { try { return currentActor(db); } catch { return null; } }

export function login(db: DB, userId: string, pin?: string | null): Actor {
  current = authenticate(db, userId, pin, autoAllowed(db));
  setSettings(db, { active_user_id: current.id });
  return current;
}
export function logout() { current = null; }
export function resetSessionForTests() { current = null; }
