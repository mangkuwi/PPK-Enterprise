import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { PPK_ROLES, permsOf, type PpkAccess, type PpkPerm, type PpkRole, type PpkUserRow } from '@shared/ppk/access';
import type { PpkStore } from './store';

export class PpkError extends Error {
  constructor(public code: 'FORBIDDEN' | 'PIN_REQUIRED' | 'LOGIN_REQUIRED' | 'INVALID' | 'NOT_FOUND' | 'CONFLICT' | 'DUPLICATE', message: string) { super(message); }
}

const now = () => new Date().toISOString();

/** Administrator aplikasi otomatis Admin PPK; pengguna lain perlu peran di ppk_user_roles. */
export async function ppkAccess(s: PpkStore, actor: Actor): Promise<PpkAccess> {
  const u = await s.get<{ role: string; pin_hash: string | null; ppk_role: PpkRole | null }>(
    'SELECT u.role, u.pin_hash, r.role AS ppk_role FROM app_users u LEFT JOIN ppk_user_roles r ON r.user_id = u.id WHERE u.id = ? AND u.is_active = 1', [actor.id]);
  if (!u) throw new PpkError('FORBIDDEN', 'Pengguna tidak ditemukan atau nonaktif.');
  const role: PpkRole | null = u.role === 'admin' ? 'admin' : u.ppk_role;
  return { user_id: actor.id, user_name: actor.name, role, perms: permsOf(role), has_pin: !!u.pin_hash };
}

/** Semua izin selain baca mewajibkan PIN, karena tanpa PIN siapa pun di depan komputer bisa masuk sebagai pengguna itu. */
export async function requirePpk(s: PpkStore, actor: Actor, perm: PpkPerm): Promise<PpkAccess> {
  const a = await ppkAccess(s, actor);
  if (!a.perms.includes(perm)) throw new PpkError('FORBIDDEN', a.role ? 'Peran Anda tidak mengizinkan tindakan ini.' : 'Anda belum memiliki peran di modul PPK. Minta administrator menambahkannya.');
  if (perm !== 'read' && !a.has_pin) throw new PpkError('PIN_REQUIRED', 'Akun Anda belum punya kata sandi. Administrator atau Pejabat PPK mengaturnya di Pengaturan PPK → Akun Staf.');
  return a;
}

/** Log audit di tabel audit_log yang sudah ada (append-only). Data keuangan wajib menyertakan before/after. */
export async function ppkAudit(s: PpkStore, actor: Actor, action: string, entity: string, entityId: string | null, detail: Record<string, unknown>) {
  await s.run('INSERT INTO audit_log (id, at, actor_id, actor_name, action, entity, entity_id, detail_json) VALUES (?,?,?,?,?,?,?,?)',
    [randomUUID(), now(), actor.id, actor.name, `ppk.${action}`, entity, entityId, JSON.stringify(detail)]);
}

export async function listPpkUsers(s: PpkStore, actor: Actor): Promise<PpkUserRow[]> {
  await requirePpk(s, actor, 'accounts');
  const rows = await s.all<any>('SELECT u.id, u.name, u.role, u.is_active, u.pin_hash, r.role AS ppk_role FROM app_users u LEFT JOIN ppk_user_roles r ON r.user_id = u.id ORDER BY u.name');
  return rows.map((r) => ({ id: r.id, name: r.name, app_role: r.role, is_active: !!r.is_active, has_pin: !!r.pin_hash, ppk_role: r.role === 'admin' ? 'admin' : r.ppk_role }));
}

export async function setPpkRole(s: PpkStore, actor: Actor, userId: string, role: PpkRole | null) {
  if (role !== null && !PPK_ROLES.includes(role)) throw new PpkError('INVALID', 'Peran tidak dikenal.');
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'accounts');
    const u = await t.get<{ role: string }>('SELECT role FROM app_users WHERE id = ?', [userId]);
    if (!u) throw new PpkError('NOT_FOUND', 'Pengguna tidak ditemukan.');
    if (u.role === 'admin') throw new PpkError('INVALID', 'Administrator aplikasi selalu menjadi Admin PPK.');
    const before = (await t.get<{ role: string }>('SELECT role FROM ppk_user_roles WHERE user_id = ?', [userId]))?.role ?? null;
    // Pejabat PPK mengelola staf; memberi atau mencabut Admin PPK hanya oleh Admin PPK.
    if (role === 'admin' || before === 'admin') await requirePpk(t, actor, 'roles');
    if (userId === actor.id) throw new PpkError('INVALID', 'Peran sendiri tidak dapat diubah.');
    if (role === null) await t.run('DELETE FROM ppk_user_roles WHERE user_id = ?', [userId]);
    else if (before) await t.run('UPDATE ppk_user_roles SET role = ?, assigned_by = ?, assigned_at = ? WHERE user_id = ?', [role, actor.name, now(), userId]);
    else await t.run('INSERT INTO ppk_user_roles (user_id, role, assigned_by, assigned_at) VALUES (?,?,?,?)', [userId, role, actor.name, now()]);
    await ppkAudit(t, actor, 'role.set', 'user', userId, { before, after: role });
  });
}
