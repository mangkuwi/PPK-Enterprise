/** Peran PPK dan izinnya. Peran tetap; tabel izin baru dibuat bila pemilik ingin izin bisa diatur sendiri. */
export const PPK_ROLES = ['admin', 'ppk', 'staf', 'pembaca'] as const;
export type PpkRole = (typeof PPK_ROLES)[number];
export const PPK_ROLE_LABEL: Record<PpkRole, string> = { admin: 'Admin PPK', ppk: 'Pejabat PPK', staf: 'Staf Input', pembaca: 'Pembaca' };

/** read = lihat; write = ubah data transaksi; master = ubah data master; roles = atur peran pengguna. */
export type PpkPerm = 'read' | 'write' | 'master' | 'roles';
const PERMS: Record<PpkRole, PpkPerm[]> = {
  admin: ['read', 'write', 'master', 'roles'],
  ppk: ['read', 'write', 'master'],
  staf: ['read', 'write'],
  pembaca: ['read']
};
export const permsOf = (role: PpkRole | null): PpkPerm[] => (role ? PERMS[role] : []);

export interface PpkAccess { user_id: string; user_name: string; role: PpkRole | null; perms: PpkPerm[]; has_pin: boolean }
export interface PpkUserRow { id: string; name: string; app_role: string; is_active: boolean; has_pin: boolean; ppk_role: PpkRole | null }
