import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarPlus, Eye, FileUp, MessageCircle, Paperclip, RefreshCw, Settings2, Upload } from 'lucide-react';
import { Input } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, agendaFromMessage, EMPTY_AGENDA } from '@/features/ppk/AgendaForm';
import { parseAgendaMessage } from '@shared/ppk/agendaMessage';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { PpkGate } from '@/features/ppk/PpkGate';
import { api } from '@/services/api';
import { cn, formatDateTime } from '@/lib/utils';
import { INBOX_CATEGORY, INVITATION_STATUS_LABEL, type InboxCategory, type InvitationStatus } from '@shared/ppk/agenda';

const CATEGORIES = Object.entries(INBOX_CATEGORY) as Array<[InboxCategory, (typeof INBOX_CATEGORY)[InboxCategory]]>;
export const INVITATION_TONE: Record<InvitationStatus, 'navy' | 'amber' | 'green' | 'red' | 'slate'> = {
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
  const cat = (q.get('kategori') ?? '') as InboxCategory | '';
  const list = useAsync(() => api.ppk.invitations.byCategory(cat || undefined), [cat]);
  const counts = useAsync(() => api.ppk.invitations.counts(), [list.data]);
  const total = (st?: InvitationStatus[]) => Object.entries(counts.data ?? {}).reduce((n, [k, v]) => n + (!st || st.includes(k as InvitationStatus) ? v ?? 0 : 0), 0);
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const { can } = usePpkAccess();
  const [form, setForm] = useState<ReturnType<typeof agendaFromMessage> | null>(null);
  const upload = async () => {
    try {
      const r = await api.ppk.invitations.upload();
      if (!r) return;
      if (r.duplicate_of) toast('File yang sama persis pernah diunggah. Periksa agar agenda tidak ganda.', 'error');
      list.reload(); setForm({ input: { ...EMPTY_AGENDA, invitation_id: r.id }, parsed: null });
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <Page>
      <PpkGate>
        <PageHeader title="Kotak Masuk WhatsApp" subtitle="Undangan yang diteruskan staf ke nomor WhatsApp Business kantor, dan undangan yang diunggah manual."
          actions={can('write') && <Button variant="outline" onClick={upload}><FileUp size={16} /> Unggah surat undangan</Button>} />
        <GatewayPanel admin={can('roles')} onSynced={list.reload} />
        <div className="mb-4 flex flex-wrap gap-1" role="tablist" aria-label="Kategori pesan">
          {([['', 'Semua', undefined], ...CATEGORIES.map(([k, c]) => [k, c.label, c.statuses])] as Array<[InboxCategory | '', string, InvitationStatus[] | undefined]>).map(([v, l, st]) => (
            <button key={v || 'semua'} role="tab" aria-selected={cat === v} onClick={() => setQ(v ? { kategori: v } : {})}
              className={cn('rounded-full border px-3 py-1 text-sm', cat === v ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-100')}>
              {l}{counts.data && <span className={cn('ml-1.5 tabular-nums', cat === v ? 'text-navy-100' : 'text-slate-400')}>{total(st)}</span>}</button>))}
        </div>
        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !list.data.length && <Empty>Tidak ada pesan{cat ? ` di "${INBOX_CATEGORY[cat].label}"` : ''}.</Empty>}
        <div className="space-y-2">{list.data?.map((i) => (
          <Card key={i.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy-100 text-navy-800">{i.source === 'whatsapp' ? <MessageCircle size={16} /> : <Upload size={16} />}</div>
            <div className="min-w-0 flex-1">
              <Link to={`/ppk/kotak-masuk/${i.id}`} className="font-medium text-navy-900 hover:underline">{i.sender_name || i.sender_phone || 'Unggah manual'}</Link>
              <div className="text-xs text-slate-500">Diterima {formatDateTime(i.received_at)}{i.file_count > 0 && <> · <Paperclip size={11} className="inline" /> {i.file_count} lampiran</>}</div>
              {i.message_text && <div className="mt-1 line-clamp-2 whitespace-pre-line text-slate-700">{i.message_text}</div>}
              {parseAgendaMessage(i.message_text) && <Badge tone="green" className="mt-1">Format AGENDA PPK</Badge>}
              {i.error_message && <div className="mt-1 text-red-700">{i.error_message}</div>}
            </div>
            <div className="flex flex-col items-end gap-2">
              <Badge tone={INVITATION_TONE[i.status]}>{INVITATION_STATUS_LABEL[i.status]}</Badge>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => navigate(`/ppk/kotak-masuk/${i.id}`)}><Eye size={14} /> Buka</Button>
                {can('write') && ['baru', 'menunggu_verifikasi'].includes(i.status) && <Button size="sm" onClick={() => setForm(agendaFromMessage(i.id, i.message_text))}><CalendarPlus size={14} /> Buat agenda</Button>}
              </div>
            </div>
          </Card>))}
        </div>
        <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
          {form && <AgendaForm initial={form.input} parsed={form.parsed} onSaved={(a) => { setForm(null); navigate(`/ppk/agenda/${a.id}`); }} />}
        </Dialog>
      </PpkGate>
    </Page>
  );
}
