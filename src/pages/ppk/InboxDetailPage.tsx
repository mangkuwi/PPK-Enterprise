import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, CalendarPlus, CheckCheck, ExternalLink, FileText, MessageCircle, Upload } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { cn, formatBytes, formatDateTime } from '@/lib/utils';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, agendaFromMessage } from '@/features/ppk/AgendaForm';
import { renderPages } from '@/features/importer/ReportDialog';
import { api } from '@/services/api';
import { formatDateID } from '@shared/date';
import { INVITATION_STATUS_LABEL, type InvitationDetail, type InvitationFile } from '@shared/ppk/agenda';
import { INVITATION_TONE } from './InboxPage';

const ACTION: Record<string, string> = {
  'invitation.whatsapp': 'Diterima dari WhatsApp', 'invitation.upload': 'Diunggah manual', 'invitation.convert': 'Agenda dibuat dari pesan ini',
  'invitation.processed': 'Ditandai diproses tanpa agenda', 'invitation.archive': 'Diarsipkan'
};
const PREVIEWABLE = ['application/pdf', 'image/jpeg', 'image/png'];

/** Pratinjau di dalam aplikasi: PDF dirender per halaman (pdfjs), foto tampil langsung. Isi lewat IPC, tanpa URL file. */
function FilePreview({ file }: { file: InvitationFile }) {
  const [state, setState] = useState<{ pages?: HTMLCanvasElement[]; img?: string; error?: string }>({});
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true; setState({});
    api.ppk.invitations.preview(file.id)
      .then(async (r) => r.mime_type === 'application/pdf' ? { pages: await renderPages(r.data, 1.4) } : { img: `data:${r.mime_type};base64,${r.data}` })
      .then((s) => { if (live) setState(s); }, (e) => { if (live) setState({ error: errMsg(e) }); });
    return () => { live = false; };
  }, [file.id]);
  useEffect(() => { const el = box.current; if (el && state.pages) el.replaceChildren(...state.pages.map((c) => Object.assign(c, { className: 'mb-3 h-auto w-full border border-slate-200 bg-white shadow-sm' }))); }, [state.pages]);
  if (state.error) return <p className="text-sm text-red-700" role="alert">{state.error}</p>;
  if (state.img) return <img src={state.img} alt={`Pratinjau ${file.filename}`} className="mx-auto max-h-[80vh] rounded border border-slate-200" />;
  if (!state.pages) return <p className="text-sm text-slate-500">Memuat pratinjau…</p>;
  return <div ref={box} aria-label={`Pratinjau ${file.filename}`} />;
}

function Detail({ m, reload }: { m: InvitationDetail; reload: () => void }) {
  const { toast, confirm } = useFeedback();
  const { can } = usePpkAccess();
  const navigate = useNavigate();
  const [form, setForm] = useState<ReturnType<typeof agendaFromMessage> | null>(null);
  const [shown, setShown] = useState<InvitationFile | null>(m.files.find((f) => PREVIEWABLE.includes(f.mime_type)) ?? null);
  const reason = useRef('');
  const open = ['baru', 'diproses', 'menunggu_verifikasi', 'gagal'].includes(m.status);
  const mark = async (action: 'diproses' | 'arsip') => {
    reason.current = '';
    const ok = await confirm(action === 'diproses'
      ? { title: 'Tandai diproses tanpa agenda?', confirmLabel: 'Tandai diproses', message: <div><p className="mb-2">Pesan pindah ke "Sudah diproses" tanpa membuat agenda, misalnya karena bukan undangan atau agendanya sudah ada.</p>
        <Input autoFocus placeholder="Alasan (wajib), mis. bukan undangan" onChange={(e) => { reason.current = e.target.value; }} /></div> }
      : { title: 'Arsipkan pesan ini?', confirmLabel: 'Arsipkan', message: <div><p className="mb-2">Pesan pindah ke tab "Diarsipkan". Pesan dan lampirannya tetap tersimpan.</p>
        <Input autoFocus placeholder="Catatan (boleh kosong)" onChange={(e) => { reason.current = e.target.value; }} /></div> });
    if (!ok) return;
    try { await api.ppk.invitations.mark(m.id, action, reason.current); toast(action === 'diproses' ? 'Pesan ditandai sudah diproses.' : 'Pesan diarsipkan.', 'success'); reload(); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  const openFile = (id: string) => api.ppk.invitations.openFile(id).catch((e) => toast(errMsg(e), 'error'));
  return (
    <>
      <Link to="/ppk/kotak-masuk" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-600 hover:underline"><ArrowLeft size={14} /> Kotak Masuk</Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-navy-100 text-navy-800">{m.source === 'whatsapp' ? <MessageCircle size={18} /> : <Upload size={18} />}</div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-navy-900">{m.sender_name || m.sender_phone || 'Unggah manual'}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <Badge tone={INVITATION_TONE[m.status]}>{INVITATION_STATUS_LABEL[m.status]}</Badge>
              {m.source === 'whatsapp' ? <>WhatsApp{m.sender_phone && ` · +${m.sender_phone}`}</> : 'Unggah manual'} · diterima {formatDateTime(m.received_at)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('write') && ['baru', 'menunggu_verifikasi', 'diproses'].includes(m.status) && <Button onClick={() => setForm(agendaFromMessage(m.id, m.message_text))}><CalendarPlus size={14} /> Buat agenda</Button>}
          {can('write') && open && <Button variant="outline" onClick={() => mark('diproses')}><CheckCheck size={14} /> Tandai diproses</Button>}
          {can('write') && m.status !== 'diarsipkan' && <Button variant="ghost" onClick={() => mark('arsip')}><Archive size={14} /> Arsipkan</Button>}
        </div>
      </div>

      {m.agenda && <div className="mb-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-900" role="status">
        Agenda dari pesan ini: <Link className="font-semibold underline" to={`/ppk/agenda/${m.agenda.id}`}>{m.agenda.title}</Link> ({formatDateID(m.agenda.agenda_date)}).</div>}
      {m.status === 'ditolak' && <div className="mb-4 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm" role="status">Diproses tanpa agenda. Alasan: {m.reject_reason || '-'}</div>}
      {m.error_message && <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">{m.error_message}</div>}
      {m.duplicate_of && <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        File yang sama persis pernah diterima. <Link className="underline" to={`/ppk/kotak-masuk/${m.duplicate_of}`}>Lihat pesan sebelumnya</Link> agar agenda tidak ganda.</div>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-2 font-semibold text-navy-900">Isi pesan</div>
            {m.message_text ? <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{m.message_text}</p> : <p className="text-sm text-slate-500">Tanpa teks.</p>}
          </Card>
          {shown && <Card className="p-4">
            <div className="mb-2 flex items-center justify-between gap-2"><div className="font-semibold text-navy-900">Pratinjau: {shown.filename}</div>
              <Button size="sm" variant="ghost" onClick={() => openFile(shown.id)}><ExternalLink size={14} /> Buka di aplikasi</Button></div>
            <div className="max-h-[80vh] overflow-auto rounded bg-slate-100 p-3"><FilePreview file={shown} /></div>
          </Card>}
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-2 font-semibold text-navy-900">Lampiran</div>
            {m.files.length ? <ul className="space-y-2 text-sm">{m.files.map((f) => (
              <li key={f.id} className={cn('rounded-md border p-2', shown?.id === f.id ? 'border-navy-300 bg-navy-50' : 'border-slate-200')}>
                <div className="flex items-center gap-1 font-medium text-navy-900"><FileText size={14} /> <span className="break-all">{f.filename}</span></div>
                <div className="text-xs text-slate-500">{formatBytes(f.size_bytes)}</div>
                <div className="mt-1 flex gap-1">
                  {PREVIEWABLE.includes(f.mime_type) && <Button size="sm" variant="outline" onClick={() => setShown(f)}>Pratinjau</Button>}
                  <Button size="sm" variant="ghost" onClick={() => openFile(f.id)}><ExternalLink size={14} /> {PREVIEWABLE.includes(f.mime_type) ? 'Buka' : 'Buka di Word'}</Button>
                </div>
              </li>))}</ul> : <p className="text-sm text-slate-500">Pesan ini tanpa lampiran.</p>}
          </Card>
          <Card className="p-4">
            <div className="mb-2 font-semibold text-navy-900">Riwayat</div>
            <ol className="space-y-2 text-sm">{m.history.map((h, i) => (
              <li key={i} className="border-l-2 border-navy-200 pl-3"><div className="font-medium">{ACTION[h.action] ?? h.action}</div>
                <div className="text-xs text-slate-500">{h.actor_name} · {formatDateTime(h.at)}{typeof h.detail.reason === 'string' && h.detail.reason && ` · ${h.detail.reason}`}</div></li>))}</ol>
          </Card>
        </div>
      </div>
      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        {form && <AgendaForm initial={form.input} parsed={form.parsed} onSaved={(a) => { setForm(null); navigate(`/ppk/agenda/${a.id}`); }} />}
      </Dialog>
    </>
  );
}

export default function InboxDetailPage() {
  const { id = '' } = useParams();
  const m = useAsync(() => api.ppk.invitations.get(id), [id]);
  return <Page><PpkGate>{m.error ? <Empty>{m.error}</Empty> : m.data ? <Detail key={m.data.id} m={m.data} reload={m.reload} /> : <Empty>Memuat…</Empty>}</PpkGate></Page>;
}
