import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { sortTasks, TASK_PRIORITIES, type Task, type TaskInput } from '@shared/ppk/tasks';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { date, text } from './validate';

const now = () => new Date().toISOString();
const SELECT = `SELECT t.id, t.title, t.notes, t.due_date, t.priority, t.category, t.assignee_user_id, u.name AS assignee_name, t.status, t.version,
  t.done_at, t.done_by, t.created_by, t.created_at, t.updated_at FROM ppk_tasks t LEFT JOIN app_users u ON u.id = t.assignee_user_id`;

function clean(i: TaskInput): TaskInput {
  if (!TASK_PRIORITIES.includes(i.priority)) throw new PpkError('INVALID', 'Prioritas tidak dikenal.');
  return { title: text(i.title, 'Judul tugas', { required: true, max: 300 }), notes: text(i.notes, 'Catatan', { max: 2000 }), due_date: date(i.due_date, 'Tenggat', false),
    priority: i.priority, category: text(i.category, 'Kategori', { max: 60 }), assignee_user_id: i.assignee_user_id || null };
}

/** Tugas yang belum diarsipkan. Selesai lebih dari 30 hari disembunyikan kecuali diminta. */
export async function listTasks(s: PpkStore, actor: Actor, f: { include_old?: boolean } = {}): Promise<Task[]> {
  await requirePpk(s, actor, 'read');
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  const rows = await s.all<Task>(`${SELECT} WHERE t.archived_at IS NULL${f.include_old ? '' : ' AND (t.status = ? OR t.done_at >= ?)'}`, f.include_old ? [] : ['berjalan', cutoff]);
  return sortTasks(rows);
}

async function getTask(s: PpkStore, id: string): Promise<Task> {
  const r = await s.get<Task>(`${SELECT} WHERE t.id = ?`, [id]);
  if (!r) throw new PpkError('NOT_FOUND', 'Tugas tidak ditemukan.');
  return r;
}

export async function saveTask(s: PpkStore, actor: Actor, id: string | null, version: number | null, input: TaskInput): Promise<Task> {
  const v = clean(input);
  const tid = id ?? randomUUID();
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    if (v.assignee_user_id && !(await t.get('SELECT id FROM app_users WHERE id = ? AND is_active = 1', [v.assignee_user_id]))) throw new PpkError('INVALID', 'Penanggung jawab tidak ditemukan atau nonaktif.');
    if (!id) {
      await t.run(`INSERT INTO ppk_tasks (id, title, notes, due_date, priority, category, assignee_user_id, created_by, created_at, updated_by, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [tid, v.title, v.notes, v.due_date, v.priority, v.category, v.assignee_user_id, actor.name, now(), actor.name, now()]);
      await ppkAudit(t, actor, 'task.create', 'ppk_tasks', tid, { after: v });
      return;
    }
    const before = await t.get<TaskInput & { archived_at: string | null }>('SELECT title, notes, due_date, priority, category, assignee_user_id, archived_at FROM ppk_tasks WHERE id = ?', [id]);
    if (!before || before.archived_at) throw new PpkError('NOT_FOUND', 'Tugas tidak ditemukan.');
    const r = await t.run(`UPDATE ppk_tasks SET title = ?, notes = ?, due_date = ?, priority = ?, category = ?, assignee_user_id = ?, version = version + 1, updated_by = ?, updated_at = ?
      WHERE id = ? AND version = ?`, [v.title, v.notes, v.due_date, v.priority, v.category, v.assignee_user_id, actor.name, now(), id, version]);
    if (!r.changes) throw new PpkError('CONFLICT', 'Tugas sudah diubah pengguna lain. Muat ulang lalu coba lagi.');
    await ppkAudit(t, actor, 'task.update', 'ppk_tasks', id, { before, after: v });
  });
  return getTask(s, tid);
}

export async function setTaskDone(s: PpkStore, actor: Actor, id: string, done: boolean): Promise<Task> {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const b = await t.get<{ status: string; archived_at: string | null }>('SELECT status, archived_at FROM ppk_tasks WHERE id = ?', [id]);
    if (!b || b.archived_at) throw new PpkError('NOT_FOUND', 'Tugas tidak ditemukan.');
    if ((b.status === 'selesai') === done) return;
    await t.run('UPDATE ppk_tasks SET status = ?, done_at = ?, done_by = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?',
      [done ? 'selesai' : 'berjalan', done ? now() : null, done ? actor.name : null, actor.name, now(), id]);
    await ppkAudit(t, actor, done ? 'task.done' : 'task.reopen', 'ppk_tasks', id, {});
  });
  return getTask(s, id);
}

export async function archiveTask(s: PpkStore, actor: Actor, id: string): Promise<void> {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const r = await t.run('UPDATE ppk_tasks SET archived_at = ?, archived_by = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL', [now(), actor.name, actor.name, now(), id]);
    if (!r.changes) throw new PpkError('NOT_FOUND', 'Tugas tidak ditemukan.');
    await ppkAudit(t, actor, 'task.archive', 'ppk_tasks', id, {});
  });
}
