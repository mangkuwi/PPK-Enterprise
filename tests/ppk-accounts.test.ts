import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { authenticate, createUser, setPin } from '../electron/main/numbering/users';
import { currentActor, login, needsSetup, resetSessionForTests } from '../electron/main/numbering/session';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { setPpkRole } from '../electron/main/ppk/access';
import { changeOwnPassword, createAccount, resetAccountPassword, setAccountActive } from '../electron/main/ppk/accounts';
import type { Actor } from '@shared/numbering';

let db: DB; let s: PpkStore; let admin: Actor; let ppk: Actor;
const err = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return String((e as Error).message); } };

beforeEach(async () => {
  resetSessionForTests();
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
});

const asPpk = async () => {
  setPin(db, admin, admin.id, 'rahasia-admin');
  const u = createUser(db, admin, { name: 'Pejabat', role: 'operator', pin: 'rahasia-ppk' });
  ppk = { id: u.id, name: u.name, role: 'operator' };
  await setPpkRole(s, admin, ppk.id, 'ppk');
};

describe('layar masuk', () => {
  it('pertama kali tanpa kata sandi: administrator otomatis dan diminta membuat kata sandi', () => {
    expect(needsSetup(db)).toBe(true);
    expect(currentActor(db).id).toBe(admin.id);
    setPin(db, admin, admin.id, 'rahasia-admin');
    expect(needsSetup(db)).toBe(false);
  });
  it('setelah ada kata sandi tidak ada masuk otomatis, akun tanpa kata sandi ditolak', () => {
    setPin(db, admin, admin.id, 'rahasia-admin');
    const op = createUser(db, admin, { name: 'Lama', role: 'operator' });
    resetSessionForTests();
    expect(() => currentActor(db)).toThrow(/Masuk/);
    expect(() => login(db, op.id)).toThrow(/belum punya kata sandi/);
    expect(login(db, admin.id, 'rahasia-admin').id).toBe(admin.id);
    expect(currentActor(db).id).toBe(admin.id);
  });
  it('dikunci 5 menit setelah 5 kali salah', () => {
    setPin(db, admin, admin.id, 'rahasia-admin');
    for (let i = 0; i < 5; i++) expect(() => authenticate(db, admin.id, 'salah')).toThrow(/Kata sandi salah/);
    expect(() => authenticate(db, admin.id, 'rahasia-admin')).toThrow(/5 menit/);
  });
});

describe('akun staf', () => {
  beforeEach(asPpk);
  it('Pejabat PPK membuat akun staf yang bisa langsung masuk dengan perannya', async () => {
    const a = await createAccount(s, ppk, { name: 'Sari', password: 'sandi-sari-1', ppk_role: 'staf' });
    expect(authenticate(db, a.id, 'sandi-sari-1').name).toBe('Sari');
    expect((db.prepare('SELECT role FROM ppk_user_roles WHERE user_id=?').get(a.id) as { role: string }).role).toBe('staf');
    expect(await err(createAccount(s, ppk, { name: 'sari', password: 'sandi-lain-1', ppk_role: 'staf' }))).toContain('sudah dipakai');
    expect(await err(createAccount(s, ppk, { name: 'Pendek', password: '123', ppk_role: 'staf' }))).toContain('minimal 8');
  });
  it('staf biasa tidak boleh membuat akun; Pejabat PPK tidak boleh menyentuh administrator', async () => {
    const a = await createAccount(s, ppk, { name: 'Sari', password: 'sandi-sari-1', ppk_role: 'staf' });
    const sari: Actor = { id: a.id, name: 'Sari', role: 'operator' };
    expect(await err(createAccount(s, sari, { name: 'X', password: 'sandi-xxx-1', ppk_role: 'staf' }))).toContain('tidak mengizinkan');
    expect(await err(createAccount(s, ppk, { name: 'X', password: 'sandi-xxx-1', ppk_role: 'admin' }))).toContain('tidak mengizinkan');
    expect(await err(resetAccountPassword(s, ppk, admin.id, 'ambil-alih-1'))).toContain('tidak mengizinkan');
    expect(await err(setAccountActive(s, ppk, admin.id, false))).toContain('tidak mengizinkan');
    expect(await err(setPpkRole(s, ppk, a.id, 'admin'))).toContain('tidak mengizinkan');
    expect(await err(setAccountActive(s, ppk, ppk.id, false))).toContain('sendiri');
  });
  it('nonaktif tidak bisa masuk; reset dan ganti sandi sendiri', async () => {
    const a = await createAccount(s, ppk, { name: 'Sari', password: 'sandi-sari-1', ppk_role: 'staf' });
    await setAccountActive(s, ppk, a.id, false);
    expect(() => authenticate(db, a.id, 'sandi-sari-1')).toThrow(/nonaktif/);
    await setAccountActive(s, ppk, a.id, true);
    await resetAccountPassword(s, ppk, a.id, 'sandi-baru-1');
    expect(() => authenticate(db, a.id, 'sandi-sari-1')).toThrow(/salah/);
    const sari: Actor = { id: a.id, name: 'Sari', role: 'operator' };
    expect(await err(changeOwnPassword(s, sari, 'keliru-lama', 'sandi-ketiga'))).toContain('lama salah');
    await changeOwnPassword(s, sari, 'sandi-baru-1', 'sandi-ketiga');
    expect(authenticate(db, a.id, 'sandi-ketiga').id).toBe(a.id);
    const acts = (db.prepare("SELECT action FROM audit_log WHERE entity_id=? AND action LIKE 'ppk.account.%' ORDER BY at").all(a.id) as { action: string }[]).map((r) => r.action);
    expect(acts).toEqual(['ppk.account.create', 'ppk.account.active', 'ppk.account.active', 'ppk.account.reset_password', 'ppk.account.change_password']);
  });
});

describe('sesi browser (mode web)', () => {
  it('login di browser wajib kata sandi, terpisah per browser, dan tidak mengubah pengguna desktop', async () => {
    const { webStore } = await import('../electron/main/webContext');
    const { logout } = await import('../electron/main/numbering/session');
    await asPpk();
    expect(login(db, admin.id, 'rahasia-admin').id).toBe(admin.id); // desktop
    const hp = { actor: null, server: null }; const laptop = { actor: null, server: null };
    expect(() => webStore.run(hp, () => currentActor(db))).toThrow(/Masuk/); // tidak masuk otomatis
    expect(() => webStore.run(hp, () => login(db, ppk.id))).toThrow(/Kata sandi salah/);
    expect(webStore.run(hp, () => login(db, ppk.id, 'rahasia-ppk')).id).toBe(ppk.id);
    expect(webStore.run(hp, () => currentActor(db)).id).toBe(ppk.id);
    expect(() => webStore.run(laptop, () => currentActor(db))).toThrow(/Masuk/);
    expect(currentActor(db).id).toBe(admin.id);
    webStore.run(hp, () => logout());
    expect(() => webStore.run(hp, () => currentActor(db))).toThrow(/Masuk/);
    expect(currentActor(db).id).toBe(admin.id);
  });
});
