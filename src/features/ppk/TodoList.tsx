import { useState } from 'react';
import { Check, Plus } from 'lucide-react';
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
import { TASK_CATEGORIES, TASK_PRIORITIES, TASK_PRIORITY_LABEL, type Task, type TaskInput } from '@shared/ppk/tasks';

type Filter = 'semua' | 'tinggi' | 'berjalan' | 'selesai';
const EMPTY: TaskInput = { title: '', notes: '', due_date: null, priority: 'sedang', category: '', assignee_user_id: null };
const TONE = { tinggi: 'red', sedang: 'amber', rendah: 'slate' } as const;

/** To Do List staf PPK: centang selesai, tambah/ubah lewat dialog, arsipkan (tidak dihapus). */
export function TodoList({ today }: { today: string }) {
  const { toast } = useFeedback();
  const { can } = usePpkAccess();
  const tasks = useAsync(() => api.ppk.tasks.list(), []);
  const [filter, setFilter] = useState<Filter>('semua');
  const [all, setAll] = useState(false);
  const [edit, setEdit] = useState<Task | 'baru' | null>(null);
  const list = tasks.data ?? [];
  const pick: Record<Filter, Task[]> = {
    semua: list, tinggi: list.filter((t) => t.priority === 'tinggi' && t.status === 'berjalan'),
    berjalan: list.filter((t) => t.status === 'berjalan'), selesai: list.filter((t) => t.status === 'selesai')
  };
  const shown = all ? pick[filter] : pick[filter].slice(0, 6);
  const toggle = async (t: Task) => { try { await api.ppk.tasks.setDone(t.id, t.status !== 'selesai'); tasks.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  const due = (d: string | null, done: boolean) => {
    if (!d) return <span className="text-slate-400">Tanpa tenggat</span>;
    const late = !done && d < today;
    return <span className={cn(late || (!done && d === today) ? 'font-semibold text-red-600' : 'text-slate-600')}>{d === today ? 'Hari ini' : d === addDays(today, 1) ? 'Besok' : shortDate(d)}{late && ' · terlambat'}</span>;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {([['semua', 'Semua'], ['tinggi', 'Prioritas Tinggi'], ['berjalan', 'Berjalan'], ['selesai', 'Selesai']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k}
            className={cn('rounded-full px-3 py-1 text-sm', filter === k ? 'bg-blue-600 font-semibold text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200')}>{l} ({pick[k].length})</button>))}
        {can('write') && <Button size="sm" className="ml-auto" onClick={() => setEdit('baru')}><Plus size={15} /> Tambah Tugas</Button>}
      </div>
      {tasks.error && <p className="text-sm text-red-700">{tasks.error}</p>}
      {!tasks.loading && !shown.length && <Empty>{filter === 'semua' ? 'Belum ada tugas. Tambahkan tugas pertama Anda.' : 'Tidak ada tugas pada pilihan ini.'}</Empty>}
      <ul className="divide-y divide-slate-100">{shown.map((t) => {
        const done = t.status === 'selesai';
        return (
          <li key={t.id} className={cn('flex items-center gap-3 py-2', done && 'opacity-60')}>
            <button role="checkbox" aria-checked={done} aria-label={`${done ? 'Buka lagi' : 'Tandai selesai'}: ${t.title}`} disabled={!can('write')} onClick={() => void toggle(t)}
              className={cn('grid h-5 w-5 shrink-0 place-items-center rounded border-2', done ? 'border-green-600 bg-green-600 text-white' : 'border-slate-400 hover:border-blue-600')}>{done && <Check size={13} />}</button>
            <button onClick={() => setEdit(t)} className="min-w-0 flex-1 text-left">
              <div className={cn('truncate font-medium text-navy-900 hover:underline', done && 'line-through')}>{t.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs">
                {done ? <Badge tone="green">Selesai</Badge> : <Badge tone={TONE[t.priority]}>{TASK_PRIORITY_LABEL[t.priority]}</Badge>}
                {t.category && <Badge tone="slate">{t.category}</Badge>}
                {t.assignee_name && <span className="text-slate-500">PJ: {t.assignee_name}</span>}
              </div>
            </button>
            <div className="shrink-0 text-right text-sm">{due(t.due_date, done)}</div>
          </li>);
      })}</ul>
      {pick[filter].length > 6 && <button onClick={() => setAll(!all)} className="mt-2 w-full text-center text-sm font-medium text-blue-700 hover:underline">{all ? 'Tampilkan lebih sedikit' : `Lihat semua tugas (${pick[filter].length})`}</button>}
      <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }}>
        {edit && <TaskForm task={edit === 'baru' ? null : edit} canEdit={can('write')} onDone={() => { setEdit(null); tasks.reload(); }} />}
      </Dialog>
    </div>
  );
}

function TaskForm({ task, canEdit, onDone }: { task: Task | null; canEdit: boolean; onDone: () => void }) {
  const { toast, confirm } = useFeedback();
  const people = useAsync(() => api.ppk.agendas.people(), []);
  const [v, setV] = useState<TaskInput>(task ? { title: task.title, notes: task.notes, due_date: task.due_date, priority: task.priority, category: task.category, assignee_user_id: task.assignee_user_id } : EMPTY);
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
          <option value="">Belum ditentukan</option>{(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Catatan" className="col-span-2"><Textarea value={v.notes} maxLength={2000} disabled={!canEdit} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </DialogContent>
  );
}
