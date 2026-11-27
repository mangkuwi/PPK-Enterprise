import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarPlus, FileUp, MessageCircle, Paperclip, RefreshCw, Settings2, Upload } from 'lucide-react';
import { Input } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, EMPTY_AGENDA } from '@/features/ppk/AgendaForm';
import { parseAgendaMessage, type AgendaMessage } from '@shared/ppk/agendaMessage';
import type { AgendaInput } from '@shared/ppk/agenda';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { PpkGate } from '@/features/ppk/PpkGate';
import { api } from '@/services/api';
import { cn, formatDateTime } from '@/lib/utils';
import { INVITATION_STATUS_LABEL, type InvitationStatus } from '@shared/ppk/agenda';

const FILTERS: Array<[InvitationStatus | '', string]> = [['', 'Semua pesan'], ['baru', 'Undangan baru'], ['diproses', 'Sedang diproses'],
  ['menunggu_verifikasi', 'Menunggu verifikasi'], ['dikonversi', 'Berhasil dikonversi'], ['gagal', 'Gagal diproses'], ['diarsipkan', 'Diarsipkan']];
const TONE: Record<InvitationStatus, 'navy' | 'amber' | 'green' | 'red' | 'slate'> = {
  baru: 'navy', diproses: 'slate', menunggu_verifikasi: 'amber', dikonversi: 'green', gagal: 'red', ditolak: 'slate', diarsipkan: 'slate'
};

/** Status Gateway WhatsApp di VPS. Admin PPK mengatur alamat dan kunci API; pesan ditarik otomatis tiap 60 detik. */
function GatewayPanel({ admin, onSynced }: { admin: boolean; onSynced: () => void }) {
  const st = useAsync(() => api.ppk.gateway.status(), []);
  const { toast } = useFeedback();
  const [edit, setEdit] = useState(false);
  const [url, setUrl] = useState(''); const [key, setKey] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { toast(await fn(), 'success'); st.reload(); onSynced(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const save = () => run(async () => { const r = await api.ppk.gateway.configure(url, key); setEdit(false); setKey('');
    return `Gateway tersambung. ${r.messages} pesan tersimpan di Gateway${r.last_webhook ? '' : '; belum pernah menerima webhook dari Meta'}.`; });
  const sync = () => run(async () => { const r = await api.ppk.gateway.sync(); if (!r.ok) throw new Error(r.error); return r.added ? `${r.added} undangan baru dari WhatsApp.` : 'Tidak ada pesan baru.'; });
  const g = st.data; const ready = !!g?.url && g.has_key;
  return (
    <div className={cn('mb-3 rounded-md border p-3 text-sm', ready && g?.last?.ok !== false ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50 text-amber-900')} role="status">
      {!edit && <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          {!ready ? 'Gateway WhatsApp belum diatur, jadi belum ada pesan yang masuk otomatis. Setelah Gateway terpasang di VPS dan nomor WhatsApp Business dihubungkan, isi alamat dan kunci API-nya di sini.'
            : <>Gateway: <b>{g.url}</b> · ditarik otomatis tiap 60 detik{g.last && <> · terakhir {formatDateTime(g.last.at)}{g.last.ok ? '' : <span className="text-red-700"> · gagal: {g.last.error}</span>}</>}</>}
        </div>
        {ready && <Button size="sm" variant="outline" disabled={busy} onClick={sync}><RefreshCw size={14} /> Tarik sekarang</Button>}
        {admin && <Button size="sm" variant="ghost" onClick={() => { setUrl(g?.url ?? ''); setEdit(true); }}><Settings2 size={14} /> {ready ? 'Ubah' : 'Atur Gateway'}</Button>}
      </div>}
      {edit && <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <Input aria-label="Alamat Gateway" placeholder="https://gateway.kantor.go.id" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Input aria-label="Kunci API" type="password" autoComplete="off" placeholder={g?.has_key ? 'Kunci tersimpan (kosongkan bila tetap)' : 'Kunci API (GATEWAY_API_KEY)'} value={key} onChange={(e) => setKey(e.target.value)} />
        <Button disabled={busy || !url} onClick={save}>Uji dan simpan</Button>
        <Button variant="ghost" onClick={() => setEdit(false)}>Batal</Button>
      </div>}
    </div>
  );
}

/** Kotak masuk undangan (WhatsApp dan unggah manual). Verifikasi dan penerimaan webhook dibangun di fase berikutnya. */
export default function InboxPage() {
  const [q, setQ] = useSearchParams();
  const status = (q.get('status') ?? '') as InvitationStatus | '';
  const list = useAsync(() => api.ppk.invitations.list(status || undefined), [status]);
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const { can } = usePpkAccess();
  const [form, setForm] = useState<AgendaInput | null>(null);
  const [parsed, setParsed] = useState<AgendaMessage | null>(null);
  /** Format AGENDA PPK mengisi formulir; selain itu teks asli masuk ke kolom agenda rapat dan staf mengisi sendiri. */
  const fromMessage = (id: string, text: string) => {
    const m = parseAgendaMessage(text); setParsed(m);
    setForm(m ? { ...EMPTY_AGENDA, invitation_id: id, title: m.title, agenda_date: m.agenda_date, start_time: m.start_time, end_time: m.end_time,
      location: m.location, organizer: m.organizer, meeting_url: m.meeting_url, agenda_text: text } : { ...EMPTY_AGENDA, invitation_id: id, agenda_text: text });
  };
  const upload = async () => {
    try {
      const r = await api.ppk.invitations.upload();
      if (!r) return;
      if (r.duplicate_of) toast('File yang sama persis pernah diunggah. Periksa agar agenda tidak ganda.', 'error');
      list.reload(); setParsed(null); setForm({ ...EMPTY_AGENDA, invitation_id: r.id });
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  const openFirst = async (id: string) => {
    try { const [f] = await api.ppk.invitations.files(id); if (f) await api.ppk.invitations.openFile(f.id); else toast('Undangan ini tanpa lampiran.', 'error'); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <Page>
      <PpkGate>
        <PageHeader title="Kotak Masuk WhatsApp" subtitle="Undangan yang diteruskan staf ke nomor WhatsApp Business kantor, dan undangan yang diunggah manual."
          actions={can('write') && <Button variant="outline" onClick={upload}><FileUp size={16} /> Unggah surat undangan</Button>} />
        <GatewayPanel admin={can('roles')} onSynced={list.reload} />
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Saring status">
          {FILTERS.map(([v, l]) => <button key={v || 'semua'} role="tab" aria-selected={status === v} onClick={() => setQ(v ? { status: v } : {})}
            className={cn('rounded-full border px-3 py-1 text-sm', status === v ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-100')}>{l}</button>)}
        </div>
        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !list.data.length && <Empty>Tidak ada pesan{status ? ` berstatus "${INVITATION_STATUS_LABEL[status]}"` : ''}.</Empty>}
        <div className="space-y-2">{list.data?.map((i) => (
          <Card key={i.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-100 text-navy-800">{i.source === 'whatsapp' ? <MessageCircle size={16} /> : <Upload size={16} />}</div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-navy-900">{i.sender_name || i.sender_phone || 'Unggah manual'}</div>
              <div className="text-xs text-slate-500">Diterima {formatDateTime(i.received_at)}{i.file_count > 0 && <> · <Paperclip size={11} className="inline" /> {i.file_count} lampiran</>}</div>
              {i.message_text && <div className="mt-1 line-clamp-2 whitespace-pre-line text-slate-700">{i.message_text}</div>}
              {parseAgendaMessage(i.message_text) && <Badge tone="green" className="mt-1">Format AGENDA PPK</Badge>}
              {i.error_message && <div className="mt-1 text-red-700">{i.error_message}</div>}
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge tone={TONE[i.status]}>{INVITATION_STATUS_LABEL[i.status]}</Badge>
              <div className="flex gap-1">
                {i.file_count > 0 && <Button size="sm" variant="ghost" onClick={() => openFirst(i.id)}><Paperclip size={14} /> Lihat file</Button>}
                {can('write') && ['baru', 'menunggu_verifikasi'].includes(i.status) && <Button size="sm" onClick={() => fromMessage(i.id, i.message_text)}><CalendarPlus size={14} /> Buat agenda</Button>}
              </div>
            </div>
          </Card>))}
        </div>
        <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
          {form && <AgendaForm initial={form} parsed={parsed} onSaved={(a) => { setForm(null); navigate(`/ppk/agenda/${a.id}`); }} />}
        </Dialog>
      </PpkGate>
    </Page>
  );
}
