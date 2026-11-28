import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, ExternalLink, FileText, FileUp, Pencil, RotateCcw, Trash2, Video, XCircle } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { useActor } from '@/features/numbering/NumberingContext';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { formatBytes, formatDateTime } from '@/lib/utils';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, agendaToInput } from '@/features/ppk/AgendaForm';
import { timeText, useDeleteAgenda } from '@/features/ppk/AgendaViews';
import { api } from '@/services/api';
import { formatDateID, jakartaToday } from '@shared/date';
import { agendaDisplay, ASSIGN_STATUS_LABEL, dayName, joinLabel, type Agenda, type AssignStatus } from '@shared/ppk/agenda';

const ACTION: Record<string, string> = {
  'agenda.create': 'Agenda dibuat', 'agenda.update': 'Agenda diubah', 'agenda.selesai': 'Ditandai selesai', 'agenda.dibatalkan': 'Dibatalkan',
  'agenda.archive': 'Diarsipkan', 'agenda.unarchive': 'Dikembalikan dari arsip', 'agenda.delete': 'Dihapus', 'agenda.restore': 'Dikembalikan dari hapus',
  'agenda.assignment': 'Penugasan diubah', 'agenda.report': 'Laporan rapat diunggah'
};

/** Penugasan per orang: tugas (staf PPK) dan status Ditugaskan/Diterima/Selesai (orang itu sendiri atau staf PPK). */
function Assignments({ a, reload }: { a: Agenda; reload: () => void }) {
  const { can } = usePpkAccess();
  const { actor } = useActor();
  const { toast } = useFeedback();
  const people = [...(a.pic ? [{ ...a.pic, utama: true }] : []), ...a.support.map((x) => ({ ...x, utama: false }))];
  const editable = !a.deleted_at && a.status !== 'dibatalkan';
  const save = async (userId: string, status: AssignStatus, duty?: string) => {
    try { await api.ppk.agendas.assignment(a.id, userId, status, duty); toast('Penugasan disimpan.', 'success'); reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <Card className="p-4">
      <div className="mb-2 font-semibold text-navy-900">Penugasan</div>
      {!people.length ? <p className="text-sm text-slate-500">Belum ada yang ditugaskan. Pilih PIC dan staf yang ikut lewat Ubah agenda.</p>
        : <ul className="divide-y divide-slate-100 text-sm">{people.map((p) => {
          const st = p.status ?? 'ditugaskan';
          return (
            <li key={p.id} className="grid items-center gap-2 py-2 sm:grid-cols-[180px_1fr_150px]">
              <div><div className="font-medium text-navy-900">{p.name}</div><div className="text-xs text-slate-500">{p.utama ? 'PIC' : 'Ikut rapat'}</div></div>
              {can('write') && editable
                ? <Input aria-label={`Tugas ${p.name}`} defaultValue={p.duty ?? ''} placeholder="Tugas, mis. menyiapkan bahan paparan" maxLength={300}
                  onBlur={(e) => { if (e.target.value.trim() !== (p.duty ?? '')) void save(p.id, st, e.target.value); }} />
                : <div className="text-slate-700">{p.duty || <span className="text-slate-400">Tugas belum diisi</span>}</div>}
              {editable && (can('write') || actor?.id === p.id)
                ? <Select aria-label={`Status ${p.name}`} value={st} onChange={(e) => void save(p.id, e.target.value as AssignStatus)}>
                  {Object.entries(ASSIGN_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                : <Badge tone={st === 'selesai' ? 'green' : st === 'diterima' ? 'navy' : 'amber'}>{ASSIGN_STATUS_LABEL[st]}</Badge>}
            </li>);
        })}</ul>}
    </Card>
  );
}

/** Laporan rapat: file asli (notulen, daftar hadir, foto) yang tidak bisa diubah atau dihapus. */
function Reports({ a }: { a: Agenda }) {
  const { can } = usePpkAccess();
  const { toast } = useFeedback();
  const files = useAsync(() => api.ppk.agendas.reports(a.id), [a.id]);
  const upload = async () => {
    try { const f = await api.ppk.agendas.uploadReport(a.id); if (f) { toast('Laporan rapat disimpan.', 'success'); files.reload(); } } catch (e) { toast(errMsg(e), 'error'); }
  };
  const past = a.agenda_date < jakartaToday();
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between gap-2"><div className="font-semibold text-navy-900">Laporan rapat</div>
        {can('write') && !a.deleted_at && <Button size="sm" variant="outline" onClick={upload}><FileUp size={14} /> Unggah</Button>}</div>
      {files.data?.length ? <ul className="space-y-1 text-sm">{files.data.map((f) => (
        <li key={f.id}><button className="inline-flex items-center gap-1 text-left text-navy-700 hover:underline" onClick={() => api.ppk.invitations.openFile(f.id).catch((e) => toast(errMsg(e), 'error'))}>
          <FileText size={14} /> {f.filename}</button> <span className="text-xs text-slate-500">({formatBytes(f.size_bytes)} · {formatDateTime(f.created_at)})</span></li>))}</ul>
        : <p className={past && a.status !== 'dibatalkan' ? 'text-sm text-amber-800' : 'text-sm text-slate-500'}>{past && a.status !== 'dibatalkan' ? 'Belum ada laporan, padahal kegiatan sudah lewat.' : 'Belum ada laporan. Unggah notulen, daftar hadir, atau foto setelah kegiatan.'}</p>}
    </Card>
  );
}

function Detail({ a, reload }: { a: Agenda; reload: () => void }) {
  const { toast, confirm } = useFeedback();
  const { can } = usePpkAccess();
  const [edit, setEdit] = useState(false);
  const reason = useRef('');
  const files = useAsync(() => (a.invitation_id ? api.ppk.invitations.files(a.invitation_id) : Promise.resolve([])), [a.invitation_id]);
  const history = useAsync(() => api.ppk.agendas.history(a.id), [a.id, a.version]);
  const clash = useAsync(() => (a.start_time && a.status === 'terjadwal' && !a.deleted_at ? api.ppk.agendas.conflicts({ agenda_date: a.agenda_date, start_time: a.start_time, end_time: a.end_time, exclude_id: a.id,
    user_ids: [...(a.pic ? [a.pic.id] : []), ...a.support.map((x) => x.id)] }) : Promise.resolve([])), [a.id, a.version]);
  const programs = useAsync(() => (a.program_id ? api.ppk.masterList('programs') : Promise.resolve([])), [a.program_id]);
  const program = programs.data?.find((p) => p.id === a.program_id);
  const st = agendaDisplay(a);
  const open = a.status === 'terjadwal' && !a.archived_at && !a.deleted_at;
  const remove = useDeleteAgenda(() => reload());
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  const cancel = async () => {
    reason.current = '';
    const ok = await confirm({ title: `Batalkan "${a.title}"?`, destructive: true, confirmLabel: 'Batalkan agenda',
      message: <div><p className="mb-2">Agenda tetap tersimpan dengan status Dibatalkan.</p><Input autoFocus placeholder="Alasan pembatalan" onChange={(e) => { reason.current = e.target.value; }} /></div> });
    if (ok) await run(() => api.ppk.agendas.setStatus(a.id, 'dibatalkan', reason.current), 'Agenda dibatalkan.');
  };
  const rows: Array<[string, React.ReactNode]> = [
    ['Tanggal & jam kegiatan', `${dayName(a.agenda_date)}, ${formatDateID(a.agenda_date)} · ${timeText(a)} WIB`],
    ['Penyelenggara', a.organizer], ['Nomor surat', a.letter_number], ['Tanggal surat', a.letter_date && formatDateID(a.letter_date)],
    ['Lokasi', a.location], ['Tautan rapat', a.meeting_url && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all text-navy-700 underline">{a.meeting_url}<ExternalLink size={12} /></a>],
    ['Program', program && `${program.code ?? ''} ${program.name ?? ''}`],
    ['PIC', a.pic?.name ?? 'Belum ditentukan'], ['Staf yang ikut', a.support.map((x) => x.name).join(', ')],
    ['Peserta diundang', a.participants && <span className="whitespace-pre-line">{a.participants}</span>],
    ['Agenda rapat', a.agenda_text && <span className="whitespace-pre-line">{a.agenda_text}</span>], ['Catatan', a.notes],
    ['Alasan batal', a.cancel_reason], ['Diverifikasi', a.verified_by && `${a.verified_by} · ${formatDateTime(a.verified_at!)}`],
    ['Dibuat', `${a.created_by} · ${formatDateTime(a.created_at)}`], ['Terakhir diubah', `${a.updated_by} · ${formatDateTime(a.updated_at)}`]
  ];
  return (
    <>
      <Link to="/ppk/agenda" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-600 hover:underline"><ArrowLeft size={14} /> Semua agenda</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><h1 className="text-2xl font-bold text-navy-900">{a.title}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Badge tone={st.tone}>{st.label}</Badge>{dayName(a.agenda_date)}, {formatDateID(a.agenda_date)} · {timeText(a)}</div></div>
        <div className="flex flex-wrap gap-2">
          {a.meeting_url && open && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800"><Video size={16} /> {joinLabel(a.meeting_url)}</a>}
          {a.deleted_at && can('master') && <Button onClick={() => run(() => api.ppk.agendas.restore(a.id), 'Agenda dikembalikan.')}><RotateCcw size={14} /> Kembalikan agenda</Button>}
          {can('write') && a.status !== 'dibatalkan' && !a.deleted_at && <Button onClick={() => setEdit(true)}><Pencil size={14} /> Ubah agenda</Button>}
          {can('write') && open && <>
            <Button variant="outline" onClick={() => run(() => api.ppk.agendas.setStatus(a.id, 'selesai'), 'Agenda ditandai selesai.')}><CheckCircle2 size={14} /> Selesai</Button>
            <Button variant="outline" onClick={cancel}><XCircle size={14} /> Batalkan</Button>
          </>}
          {can('master') && !a.deleted_at && <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => remove(a)}><Trash2 size={14} /> Hapus</Button>}
          {can('write') && !a.deleted_at && <Button variant="ghost" onClick={() => run(() => api.ppk.agendas.archive(a.id, !a.archived_at), a.archived_at ? 'Agenda dikembalikan dari arsip.' : 'Agenda diarsipkan.')}>
            {a.archived_at ? <><ArchiveRestore size={14} /> Kembalikan</> : <><Archive size={14} /> Arsipkan</>}</Button>}
        </div>
      </div>

      {a.deleted_at && <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="status">
        <b>Agenda ini dihapus</b> oleh {a.deleted_by} pada {formatDateTime(a.deleted_at)}. Alasan: {a.delete_reason}. Agenda tidak tampil di jadwal sampai dikembalikan.</div>}
      {!!clash.data?.length && <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        <b>Jadwal bentrok:</b> {clash.data.map((c) => <span key={c.id}> <Link className="underline" to={`/ppk/agenda/${c.id}`}>{c.title}</Link> ({c.start_time}{c.end_time && `–${c.end_time}`}){c.shared_staff.length > 0 && `, staf sama: ${c.shared_staff.join(', ')}`};</span>)}
      </div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
        <Card className="p-4">
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[160px_1fr]">
            {rows.filter(([, v]) => v).map(([k, v]) => <div key={k} className="contents"><dt className="text-slate-500">{k}</dt><dd className="min-w-0 break-words text-slate-900">{v}</dd></div>)}
          </dl>
        </Card>
        <Assignments a={a} reload={reload} />
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-2 font-semibold text-navy-900">Undangan asli</div>
            {!a.invitation_id ? <p className="text-sm text-slate-500">Agenda ini diisi manual, tanpa file undangan.</p>
              : files.data?.length ? <ul className="space-y-1 text-sm">{files.data.map((f) => (
                <li key={f.id}><button className="inline-flex items-center gap-1 text-left text-navy-700 hover:underline" onClick={() => api.ppk.invitations.openFile(f.id).catch((e) => toast(errMsg(e), 'error'))}>
                  <FileText size={14} /> {f.filename}</button> <span className="text-xs text-slate-500">({Math.ceil(f.size_bytes / 1024)} KB)</span></li>))}</ul>
              : <p className="text-sm text-slate-500">Undangan tanpa lampiran.</p>}
          </Card>
          <Reports a={a} />
          <Card className="p-4">
            <div className="mb-2 font-semibold text-navy-900">Riwayat</div>
            <ol className="space-y-2 text-sm">{history.data?.map((h, i) => (
              <li key={i} className="border-l-2 border-navy-200 pl-3"><div className="font-medium">{ACTION[h.action] ?? h.action}</div>
                <div className="text-xs text-slate-500">{h.actor_name} · {formatDateTime(h.at)}{typeof h.detail.reason === 'string' && h.detail.reason && ` · ${h.detail.reason}`}</div></li>))}</ol>
          </Card>
        </div>
      </div>
      <Dialog open={edit} onOpenChange={setEdit}>
        {edit && <AgendaForm initial={agendaToInput(a)} existing={a} onSaved={() => { setEdit(false); reload(); }} />}
      </Dialog>
    </>
  );
}

export default function AgendaDetailPage() {
  const { id = '' } = useParams();
  const a = useAsync(() => api.ppk.agendas.get(id), [id]);
  return <Page><PpkGate>{a.error ? <Empty>{a.error}</Empty> : a.data ? <Detail a={a.data} reload={a.reload} /> : <Empty>Memuat…</Empty>}</PpkGate></Page>;
}
