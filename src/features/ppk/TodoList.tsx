import { useState, type ReactNode } from 'react';
import { AlarmClock, CalendarDays, Check, MoreVertical, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Empty } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { addDays } from '@shared/date';
import { shortDate } from './AgendaViews';
import { usePpkAccess } from './usePpkAccess';
import { dueState, TASK_CATEGORIES, TASK_PRIORITIES, TASK_PRIORITY_LABEL, type Task, type TaskInput } from '@shared/ppk/tasks';

type Filter = 'saya' | 'semua' | 'tinggi' | 'berjalan' | 'selesai';
const EMPTY: TaskInput = { title: '', notes: '', due_date: null, priority: 'sedang', category: '', assignee_user_id: null };
const TONE = { tinggi: 'red', sedang: 'amber', rendah: 'slate' } as const;

/** To Do List staf PPK: centang selesai, tambah/ubah lewat dialog, arsipkan (tidak dihapus). */
type Tasks = { data?: Task[]; error?: string; loading: boolean; reload: () => void };

/** Dashboard memuat tugas sekali lalu membaginya ke kartu ringkasan dan daftar ini; tanpa prop, daftar memuat sendiri. */
export function TodoList({ today, tasks: shared, title }: { today: string; tasks?: Tasks; title?: ReactNode }) {
  const own = useAsync(() => (shared ? Promise.resolve(undefined) : api.ppk.tasks.list()), [!!shared]);
  return <TodoListView today={today} tasks={shared ?? own} title={title} />;
}

function TodoListView({ today, tasks, title }: { today: string; tasks: Tasks; title?: ReactNode }) {
  const { toast } = useFeedback();
  const { can, access } = usePpkAccess();
  const me = access?.user_id;
  const [chosen, setFilter] = useState<Filter | null>(null);
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<Task | 'baru' | null>(null);
  const list = tasks.data ?? [];
  const pick: Record<Filter, Task[]> = {
    saya: list.filter((t) => t.assignee_user_id === me && t.status === 'berjalan'), semua: list, tinggi: list.filter((t) => t.priority === 'tinggi' && t.status === 'berjalan'),
    berjalan: list.filter((t) => t.status === 'berjalan'), selesai: list.filter((t) => t.status === 'selesai')
  };
  // Bawaan: tugas saya yang masih berjalan, bila ada.
  const filter: Filter = chosen ?? (pick.saya.length ? 'saya' : 'semua');
  const shown = all ? pick[filter] : pick[filter].slice(0, 6);
  const toggle = async (t: Task) => { try { await api.ppk.tasks.setDone(t.id, t.status !== 'selesai'); tasks.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  const due = (t: Task) => {
    const d = t.due_date;
    if (!d) return <span className="text-slate-400">Tanpa tenggat</span>;
    const st = dueState(t, today);
    const late = st === 'terlambat';
    return (
      <span className="flex flex-col items-end gap-0.5">
        <span className={cn('inline-flex items-center gap-1', late || st === 'hari_ini' ? 'font-semibold text-red-600' : 'text-slate-600')}>
          <CalendarDays size={14} />{d === today ? 'Hari ini' : d === addDays(today, 1) ? 'Besok' : shortDate(d)}</span>
        {late && <span className="rounded bg-red-100 px-1.5 text-[11px] font-semibold text-red-700">Terlambat</span>}
        {st === 'segera' && <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-700" title="Pengingat: tenggat ≤ 3 hari"><AlarmClock size={11} /> Pengingat</span>}
      </span>);
  };

  const addBtn = can('write') && <Button size="sm" className="ml-auto bg-blue-600 hover:bg-blue-700" onClick={() => setEdit('baru')}><Plus size={15} /> Tambah Tugas</Button>;
  return (
    <div>
      {title && <div className="mb-3 flex items-center gap-2">{title}{addBtn}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([['semua', 'Semua'], ['saya', 'Tugas Saya'], ['tinggi', 'Prioritas Tinggi'], ['berjalan', 'Sedang Berjalan'], ['selesai', 'Selesai']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={cn('rounded-full px-3 py-1 text-sm', filter === k ? 'bg-blue-600 font-semibold text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>{l} ({pick[k].length})</button>))}
        {!title && addBtn}
      </div>
      {tasks.error && <p className="text-sm text-red-700">{tasks.error}</p>}
      {!tasks.loading && !shown.length && <Empty>{filter === 'saya' ? 'Tidak ada tugas berjalan untuk Anda.' : filter === 'semua' ? 'Belum ada tugas. Tambahkan tugas pertama Anda.' : 'Tidak ada tugas pada pilihan ini.'}</Empty>}
      <ul className="space-y-1">{shown.map((t) => {
        const done = t.status === 'selesai';
        const late = dueState(t, today) === 'terlambat';
        return (
          <li key={t.id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', done ? 'border-green-100 bg-green-50/70' : late ? 'border-red-200 bg-red-50/40' : 'border-transparent hover:bg-slate-50')}>
            <button role="checkbox" aria-checked={done} aria-label={`${done ? 'Buka lagi' : 'Tandai selesai'}: ${t.title}`} disabled={!can('write')} onClick={() => void toggle(t)}
              className={cn('grid h-5 w-5 shrink-0 place-items-center rounded border-2', done ? 'border-green-600 bg-green-600 text-white' : 'border-slate-400 hover:border-blue-600')}>{done && <Check size={13} />}</button>
            <button onClick={() => setEdit(t)} className="min-w-0 flex-1 text-left">
              <div className={cn('truncate font-medium text-navy-900 hover:underline', done && 'text-slate-500 line-through')}>{t.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                {done ? <Badge tone="green">Selesai</Badge> : <Badge tone={TONE[t.priority]}>{TASK_PRIORITY_LABEL[t.priority]}</Badge>}
                {t.category && <Badge tone="slate">{t.category}</Badge>}
                {t.assignee_name && <span className={t.assignee_user_id === me ? 'font-semibold text-blue-700' : 'text-slate-500'}>PJ: {t.assignee_user_id === me ? 'Anda' : t.assignee_name}</span>}
              </div>
            </button>
            <div className="shrink-0 text-right text-sm">{due(t)}</div>
            <button onClick={() => setEdit(t)} className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-navy-900" aria-label={`Rincian tugas: ${t.title}`} title="Rincian / ubah"><MoreVertical size={16} /></button>
          </li>);
      })}</ul>
      {pick[filter].length > 6 && <button onClick={() => setAll(!all)} className="mt-2 w-full text-center text-sm font-medium text-blue-700 hover:underline">{all ? 'Tampilkan lebih sedikit' : `Lihat semua tugas (${pick[filter].length})`}</button>}
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }}>
        {edit && <TaskForm task={edit === 'baru' ? null : edit} me={me ?? null} canEdit={can('write')} onDone={() => { setEdit(null); tasks.reload(); }} />}
      </Dialog>
    </div>
  );
}

function TaskForm({ task, me, canEdit, onDone }: { task: Task | null; me: string | null; canEdit: boolean; onDone: () => void }) {
  const { toast, confirm } = useFeedback();
  const people = useAsync(() => api.ppk.agendas.people(), []);
  const [v, setV] = useState<TaskInput>(task ? { title: task.title, notes: task.notes, due_date: task.due_date, priority: task.priority, category: task.category, assignee_user_id: task.assignee_user_id } : { ...EMPTY, assignee_user_id: me });
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<unknown>, ok: string) => { setBusy(true); try { await f(); toast(ok, 'success'); onDone(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); } };
  const save = () => run(() => api.ppk.tasks.save(task?.id ?? null, task?.version ?? null, v), task ? 'Tugas diperbarui.' : 'Tugas ditambahkan.');
  const archive = async () => { if (task && await confirm({ title: 'Arsipkan tugas', message: `Arsipkan "${task.title}"? Tugas hilang dari daftar, riwayatnya tetap tersimpan.`, confirmLabel: 'Arsipkan' })) await run(() => api.ppk.tasks.archive(task.id), 'Tugas diarsipkan.'); };
  return (
    <DialogContent title={task ? 'Ubah tugas' : 'Tambah tugas'} description={task ? `Dibuat ${task.created_by}${task.done_by ? ` · diselesaikan ${task.done_by}` : ''}` : undefined}
      footer={<>{task && canEdit && <Button variant="outline" className="mr-auto" disabled={busy} onClick={() => void archive()}>Arsipkan</Button>}
        {canEdit && <Button disabled={busy || !v.title.trim()} onClick={() => void save()}>Simpan</Button>}</>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Judul tugas" required className="col-span-2"><Input value={v.title} maxLength={300} autoFocus disabled={!canEdit} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Tenggat"><Input type="date" value={v.due_date ?? ''} disabled={!canEdit} onChange={(e) => setV({ ...v, due_date: e.target.value || null })} /></Field>
        <Field label="Prioritas"><Select value={v.priority} disabled={!canEdit} onChange={(e) => setV({ ...v, priority: e.target.value as TaskInput['priority'] })}>{TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}</Select></Field>
        <Field label="Kategori"><Input list="task-categories" value={v.category} maxLength={60} disabled={!canEdit} onChange={(e) => setV({ ...v, category: e.target.value })} />
          <datalist id="task-categories">{TASK_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Penanggung jawab"><Select value={v.assignee_user_id ?? ''} disabled={!canEdit} onChange={(e) => setV({ ...v, assignee_user_id: e.target.value || null })}>
          <option value="">Belum ditentukan</option>{(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === me ? ' (Anda)' : ''}</option>)}</Select></Field>
        <Field label="Catatan" className="col-span-2"><Textarea value={v.notes} maxLength={2000} disabled={!canEdit} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </DialogContent>
  );
}
