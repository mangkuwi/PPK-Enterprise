import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db';
import type { Actor, AppUser, Role } from '@shared/numbering';
import { NumberingError } from './errors';
import { audit } from './audit';

import { nowIso } from './clock';
const now = nowIso;
const hash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

interface Row { id: string; name: string; role: Role; pin_hash: string | null; pin_salt: string | null; is_active: number }
const toUser = (r: Row): AppUser => ({ id: r.id, name: r.name, role: r.role, has_pin: !!r.pin_hash, is_active: !!r.is_active });
export const toActor = (r: { id: string; name: string; role: Role }): Actor => ({ id: r.id, name: r.name, role: r.role });

export function listUsers(db: DB): AppUser[] {
  return (db.prepare('SELECT * FROM app_users ORDER BY role, name').all() as Row[]).map(toUser);
}

export function requireAdmin(a: Actor) {
  if (a.role !== 'admin') throw new NumberingError('FORBIDDEN', 'Tindakan ini hanya untuk administrator.');
}

const validPin = (pin: string) => /^\d{4,12}$/.test(pin);
const adminCount = (db: DB, exceptId?: string) =>
  (db.prepare("SELECT COUNT(*) n FROM app_users WHERE role='admin' AND is_active=1 AND id != ?").get(exceptId ?? '') as { n: number }).n;

export function createUser(db: DB, actor: Actor, i: { name: string; role: Role; pin?: string | null }): AppUser {
  requireAdmin(actor);
  const name = i.name.trim();
  if (!name || name.length > 80) throw new NumberingError('INVALID', 'Nama pengguna wajib diisi (maks. 80 karakter).');
  if (i.pin && !validPin(i.pin)) throw new NumberingError('INVALID', 'PIN harus 4–12 digit angka.');
  const id = randomUUID();
  const salt = i.pin ? randomBytes(16).toString('hex') : null;
  try {
    db.prepare('INSERT INTO app_users (id, name, role, pin_hash, pin_salt, is_active, created_at) VALUES (?,?,?,?,?,1,?)')
      .run(id, name, i.role, i.pin && salt ? hash(i.pin, salt) : null, salt, now());
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) throw new NumberingError('INVALID', `Nama pengguna "${name}" sudah dipakai.`);
    throw e;
  }
  audit(db, actor, 'user.create', 'user', id, { name, role: i.role });
  return toUser(db.prepare('SELECT * FROM app_users WHERE id=?').get(id) as Row);
}

export function updateUser(db: DB, actor: Actor, id: string, p: { name?: string; role?: Role; is_active?: boolean }): AppUser {
  requireAdmin(actor);
  const cur = db.prepare('SELECT * FROM app_users WHERE id=?').get(id) as Row | undefined;
  if (!cur) throw new NumberingError('NOT_FOUND', 'Pengguna tidak ditemukan.');
  const role = p.role ?? cur.role; const active = p.is_active ?? !!cur.is_active;
  if (cur.role === 'admin' && (role !== 'admin' || !active) && adminCount(db, id) === 0) throw new NumberingError('INVALID', 'Harus ada minimal satu administrator aktif.');
  const name = (p.name ?? cur.name).trim();
  if (!name) throw new NumberingError('INVALID', 'Nama pengguna wajib diisi.');
  db.prepare('UPDATE app_users SET name=?, role=?, is_active=? WHERE id=?').run(name, role, active ? 1 : 0, id);
  audit(db, actor, 'user.update', 'user', id, { before: { name: cur.name, role: cur.role, active: !!cur.is_active }, after: { name, role, active } });
  return toUser(db.prepare('SELECT * FROM app_users WHERE id=?').get(id) as Row);
}

/** Admin boleh mengatur PIN siapa pun; pengguna lain hanya PIN sendiri. pin=null menghapus PIN. */
export function setPin(db: DB, actor: Actor, id: string, pin: string | null) {
  if (actor.role !== 'admin' && actor.id !== id) throw new NumberingError('FORBIDDEN', 'Anda hanya dapat mengubah PIN sendiri.');
  if (pin !== null && !validPin(pin)) throw new NumberingError('INVALID', 'PIN harus 4–12 digit angka.');
  const salt = pin ? randomBytes(16).toString('hex') : null;
  const r = db.prepare('UPDATE app_users SET pin_hash=?, pin_salt=? WHERE id=?').run(pin && salt ? hash(pin, salt) : null, salt, id);
  if (!r.changes) throw new NumberingError('NOT_FOUND', 'Pengguna tidak ditemukan.');
  audit(db, actor, pin ? 'user.set_pin' : 'user.clear_pin', 'user', id, {});
}

export function authenticate(db: DB, id: string, pin?: string | null): Actor {
  const r = db.prepare('SELECT * FROM app_users WHERE id=?').get(id) as Row | undefined;
  if (!r || !r.is_active) throw new NumberingError('NOT_FOUND', 'Pengguna tidak ditemukan atau nonaktif.');
  if (r.pin_hash && r.pin_salt) {
    const ok = !!pin && timingSafeEqual(Buffer.from(hash(pin, r.pin_salt), 'hex'), Buffer.from(r.pin_hash, 'hex'));
    if (!ok) { audit(db, toActor(r), 'user.login_failed', 'user', id, {}); throw new NumberingError('FORBIDDEN', 'PIN salah.'); }
  }
  const a = toActor(r);
  audit(db, a, 'user.login', 'user', id, {});
  return a;
}
