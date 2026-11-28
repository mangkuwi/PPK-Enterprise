import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { createUser, setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { setPpkRole } from '../electron/main/ppk/access';
import { archiveTask, listTasks, saveTask, setTaskDone } from '../electron/main/ppk/tasks';
import { recentActivity } from '../electron/main/ppk/activity';
import type { TaskInput } from '@shared/ppk/tasks';
import type { Actor } from '@shared/numbering';

const base: TaskInput = { title: 'Verifikasi berkas', notes: '', due_date: null, priority: 'sedang', category: 'Kontrak', assignee_user_id: null };
let db: DB; let s: PpkStore; let admin: Actor; let budi: Actor; let citra: Actor;

beforeEach(async () => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
  setPin(db, admin, admin.id, '123456');
  budi = createUser(db, admin, { name: 'Budi', role: 'operator', pin: '2222' }) as Actor; await setPpkRole(s, admin, budi.id, 'staf');
  citra = createUser(db, admin, { name: 'Citra', role: 'operator', pin: '3333' }) as Actor; await setPpkRole(s, admin, citra.id, 'pembaca');
});

describe('To Do List', () => {
  it('urut: berjalan dulu, tenggat terdekat, prioritas; selesai bisa dibuka lagi', async () => {
    const a = await saveTask(s, budi, null, null, { ...base, title: 'Tanpa tenggat', priority: 'tinggi' });
    const b = await saveTask(s, budi, null, null, { ...base, title: 'Besok', due_date: '2026-11-28', assignee_user_id: citra.id });
    const c = await saveTask(s, budi, null, null, { ...base, title: 'Hari ini', due_date: '2026-11-27', priority: 'rendah' });
    expect(b.assignee_name).toBe('Citra');
    await setTaskDone(s, budi, c.id, true);
    expect((await listTasks(s, citra)).map((t) => t.title)).toEqual(['Besok', 'Tanpa tenggat', 'Hari ini']);
    const r = await setTaskDone(s, budi, c.id, false);
    expect(r.status).toBe('berjalan'); expect(r.done_at).toBeNull();
    await expect(saveTask(s, budi, a.id, 1, { ...base, title: 'Ubah' })).resolves.toMatchObject({ title: 'Ubah', version: 2 });
    await expect(saveTask(s, budi, a.id, 1, { ...base, title: 'Basi' })).rejects.toThrow(/pengguna lain/);
  });
  it('arsip menyembunyikan tanpa menghapus; pembaca tidak bisa menulis; validasi', async () => {
    const a = await saveTask(s, admin, null, null, base);
    await archiveTask(s, admin, a.id);
    expect(await listTasks(s, admin)).toEqual([]);
    expect(db.prepare('SELECT count(*) n FROM ppk_tasks').get()).toEqual({ n: 1 });
    expect(() => db.prepare('DELETE FROM ppk_tasks').run()).toThrow(/arsipkan/);
    await expect(saveTask(s, citra, null, null, base)).rejects.toThrow();
    await expect(saveTask(s, budi, null, null, { ...base, title: ' ' })).rejects.toThrow(/wajib/);
    await expect(saveTask(s, budi, null, null, { ...base, due_date: '2026-02-30' })).rejects.toThrow(/tanggal/);
    expect((db.prepare("SELECT action FROM audit_log WHERE action LIKE 'ppk.task.%' ORDER BY at").all() as Array<{ action: string }>).map((r) => r.action)).toEqual(['ppk.task.create', 'ppk.task.archive']);
  });
  it('Aktivitas Terbaru dari log audit, terbaru dulu, dengan judul tugas', async () => {
    const a = await saveTask(s, budi, null, null, { ...base, title: 'Rekonsiliasi billing' });
    await setTaskDone(s, budi, a.id, true);
    const act = await recentActivity(s, citra);
    expect(act.map((x) => x.text)).toEqual(['Tugas selesai: Rekonsiliasi billing', 'Tugas ditambahkan: Rekonsiliasi billing']);
    expect(act[0]).toMatchObject({ actor: 'Budi', kind: 'tugas', done: true });
  });
});
