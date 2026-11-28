/** To Do List staf PPK. */
import { addDays } from '../date';
export const TASK_PRIORITIES = ['tinggi', 'sedang', 'rendah'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { tinggi: 'Prioritas Tinggi', sedang: 'Prioritas Sedang', rendah: 'Prioritas Rendah' };
/** Saran kategori; isian bebas tetap boleh. */
export const TASK_CATEGORIES = ['Kontrak', 'Keuangan', 'Naskah Dinas', 'Agenda', 'Anggaran', 'Lainnya'];

export interface TaskInput { title: string; notes: string; due_date: string | null; priority: TaskPriority; category: string; assignee_user_id: string | null }
export interface Task extends TaskInput {
  id: string; status: 'berjalan' | 'selesai'; version: number; assignee_name: string | null;
  done_at: string | null; done_by: string | null; created_by: string; created_at: string; updated_at: string;
}

const RANK: Record<TaskPriority, number> = { tinggi: 0, sedang: 1, rendah: 2 };
/** Urutan tampil: yang berjalan dulu; lalu tenggat terdekat (tanpa tenggat di akhir); lalu prioritas. */
export function sortTasks<T extends Pick<Task, 'status' | 'due_date' | 'priority' | 'created_at'>>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.status === b.status ? 0 : a.status === 'berjalan' ? -1 : 1)
    || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || RANK[a.priority] - RANK[b.priority] || a.created_at.localeCompare(b.created_at));
}

/** Status tenggat tugas yang masih berjalan: terlambat, hari ini, atau ≤ 3 hari lagi (pengingat). Selesai/tanpa tenggat = null. */
export function dueState(t: Pick<Task, 'status' | 'due_date'>, today: string): 'terlambat' | 'hari_ini' | 'segera' | null {
  if (t.status === 'selesai' || !t.due_date) return null;
  if (t.due_date < today) return 'terlambat';
  if (t.due_date === today) return 'hari_ini';
  return t.due_date <= addDays(today, 3) ? 'segera' : null;
}

/** Angka kartu ringkasan Dashboard, dihitung dari daftar tugas (tidak disimpan). */
export function taskStats(list: Array<Pick<Task, 'status' | 'due_date' | 'created_at'>>, today: string) {
  const open = list.filter((t) => t.status === 'berjalan');
  const states = open.map((t) => dueState(t, today));
  return { total: list.length, open: open.length, done: list.length - open.length, near: states.filter(Boolean).length,
    late: states.filter((s) => s === 'terlambat').length, newThisWeek: list.filter((t) => t.created_at.slice(0, 10) >= addDays(today, -6)).length };
}
