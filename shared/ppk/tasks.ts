/** To Do List staf PPK. */
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
