/**
 * Akun staf PPK: dibuat, dinonaktifkan, dan direset kata sandinya oleh Admin PPK atau Pejabat PPK.
 * Bekerja di store aktif (SQLite lokal atau server PostgreSQL), jadi di mode server akun berlaku di semua komputer.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { PASSWORD_RULE, validPassword, type Actor } from '@shared/numbering';
import { PPK_ROLES, type PpkRole } from '@shared/ppk/access';
import { hash, verifySecret } from '../numbering/users';
import { PpkError, ppkAudit, requirePpk } from './access';
import type { PpkStore } from './store';

const now = () => new Date().toISOString();
const secret = (password: string) => { const salt = randomBytes(16).toString('hex'); return { pin_hash: hash(password, salt), pin_salt: salt }; };
function checkPassword(p: string) { if (!validPassword(p)) throw new PpkError('INVALID', PASSWORD_RULE); }

interface Target { id: string; name: string; role: string; is_active: number; ppk_role: PpkRole | null }
/** Akun administrator aplikasi / Admin PPK hanya boleh diubah oleh Admin PPK, bukan Pejabat PPK. */
async function target(t: PpkStore, actor: Actor, id: string): Promise<Target> {
  const u = await t.get<Target>('SELECT u.id, u.name, u.role, u.is_active, r.role AS ppk_role FROM app_users u LEFT JOIN ppk_user_roles r ON r.user_id = u.id WHERE u.id = ?', [id]);
  if (!u) throw new PpkError('NOT_FOUND', 'Pengguna tidak ditemukan.');
  if (u.role === 'admin' || u.ppk_role === 'admin') await requirePpk(t, actor, 'roles');
  return u;
}

export async function createAccount(s: PpkStore, actor: Actor, i: { name: string; password: string; ppk_role: PpkRole }) {
  const name = i.name.trim();
  if (!name || name.length > 80) throw new PpkError('INVALID', 'Nama pengguna wajib diisi (maks. 80 karakter).');
  if (!PPK_ROLES.includes(i.ppk_role)) throw new PpkError('INVALID', 'Peran tidak dikenal.');
  checkPassword(i.password);
  return s.tx(async (t) => {
    await requirePpk(t, actor, 'accounts');
    if (i.ppk_role === 'admin') await requirePpk(t, actor, 'roles');
    if (await t.get('SELECT 1 FROM app_users WHERE lower(name) = lower(?)', [name])) throw new PpkError('DUPLICATE', `Nama pengguna "${name}" sudah dipakai.`);
    const id = randomUUID(); const sec = secret(i.password); const at = now();
    await t.run("INSERT INTO app_users (id, name, role, pin_hash, pin_salt, is_active, created_at) VALUES (?,?,'operator',?,?,1,?)", [id, name, sec.pin_hash, sec.pin_salt, at]);
    await t.run('INSERT INTO ppk_user_roles (user_id, role, assigned_by, assigned_at) VALUES (?,?,?,?)', [id, i.ppk_role, actor.name, at]);
    await ppkAudit(t, actor, 'account.create', 'user', id, { name, ppk_role: i.ppk_role });
    return { id, name };
  });
}

export async function setAccountActive(s: PpkStore, actor: Actor, id: string, active: boolean) {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'accounts');
    if (id === actor.id) throw new PpkError('INVALID', 'Akun sendiri tidak dapat dinonaktifkan.');
    const u = await target(t, actor, id);
    if (u.role === 'admin' && !active && ((await t.get<{ n: number }>("SELECT count(*) AS n FROM app_users WHERE role = 'admin' AND is_active = 1 AND id <> ?", [id]))?.n ?? 0) === 0)
      throw new PpkError('INVALID', 'Harus ada minimal satu administrator aktif.');
    await t.run('UPDATE app_users SET is_active = ? WHERE id = ?', [active ? 1 : 0, id]);
    await ppkAudit(t, actor, 'account.active', 'user', id, { before: !!u.is_active, after: active });
  });
}

/** Reset oleh pengelola akun; kata sandi baru disampaikan langsung ke staf. */
export async function resetAccountPassword(s: PpkStore, actor: Actor, id: string, password: string) {
  checkPassword(password);
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'accounts');
    await target(t, actor, id);
    const sec = secret(password);
    await t.run('UPDATE app_users SET pin_hash = ?, pin_salt = ? WHERE id = ?', [sec.pin_hash, sec.pin_salt, id]);
    await ppkAudit(t, actor, 'account.reset_password', 'user', id, {});
  });
}

/** Setiap pengguna boleh mengganti kata sandinya sendiri dengan menyebut kata sandi lama. */
export async function changeOwnPassword(s: PpkStore, actor: Actor, oldPassword: string, password: string) {
  checkPassword(password);
  await s.tx(async (t) => {
    const r = await t.get<{ pin_hash: string | null; pin_salt: string | null }>('SELECT pin_hash, pin_salt FROM app_users WHERE id = ? AND is_active = 1', [actor.id]);
    if (!r) throw new PpkError('NOT_FOUND', 'Pengguna tidak ditemukan atau nonaktif.');
    if (r.pin_hash && !verifySecret(oldPassword, r)) throw new PpkError('FORBIDDEN', 'Kata sandi lama salah.');
    const sec = secret(password);
    await t.run('UPDATE app_users SET pin_hash = ?, pin_salt = ? WHERE id = ?', [sec.pin_hash, sec.pin_salt, actor.id]);
    await ppkAudit(t, actor, 'account.change_password', 'user', actor.id, {});
  });
}
