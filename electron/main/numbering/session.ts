import type { DB } from '../db';
import type { Actor } from '@shared/numbering';
import { NumberingError } from './errors';
import { authenticate, toActor } from './users';
import { getRawSetting, setSettings } from '../repo';

let current: Actor | null = null;

/** Pengguna aktif. Dimulai otomatis hanya bila pengguna terakhir/administrator tidak memakai PIN; selain itu perlu login. */
export function currentActor(db: DB): Actor {
  if (current) {
    const r = db.prepare('SELECT id, name, role, is_active FROM app_users WHERE id=?').get(current.id) as any;
    if (r && r.is_active) { current = toActor(r); return current; }
    current = null;
  }
  const last = getRawSetting(db, 'active_user_id');
  const rows = db.prepare("SELECT id, name, role, pin_hash FROM app_users WHERE is_active=1 ORDER BY (id = ?) DESC, role ASC, name").all(last ?? '') as any[];
  const open = rows.find((r) => !r.pin_hash);
  if (!open) throw new NumberingError('LOGIN_REQUIRED', 'Masuk sebagai pengguna terlebih dahulu (PIN diperlukan).');
  current = toActor(open);
  return current;
}

export function peekActor(db: DB): Actor | null { try { return currentActor(db); } catch { return null; } }

export function login(db: DB, userId: string, pin?: string | null): Actor {
  current = authenticate(db, userId, pin);
  setSettings(db, { active_user_id: current.id });
  return current;
}
export function logout() { current = null; }
export function resetSessionForTests() { current = null; }
