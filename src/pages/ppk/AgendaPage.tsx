import { useRef, useState } from 'react';
import { CheckCircle2, Pencil, XCircle } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, agendaToInput } from '@/features/ppk/AgendaForm';
import { api } from '@/services/api';
import { AGENDA_STATUS_LABEL, dayName, type Agenda } from '@shared/ppk/agenda';
import { formatDateID } from '@shared/date';

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD waktu lokal

/** Agenda kegiatan PPK dari surat undangan, dengan penanggung jawab dan staf pendukung. */
export default function AgendaPage() {
  const { toast, confirm } = useFeedback();
  const { can } = usePpkAccess();
  const [past, setPast] = useState(false);
  const [edit, setEdit] = useState<Agenda | null>(null);
  const reason = useRef(''); // diisi dari input di dialog konfirmasi
  const list = useAsync(() => api.ppk.agendas.list(past ? { include_cancelled: true } : { from: today() }), [past]);
  const status = async (a: Agenda, s: 'selesai' | 'dibatalkan') => {
    if (s === 'dibatalkan') {
      reason.current = '';
      const ok = await confirm({ title: `Batalkan "${a.title}"?`, destructive: true, confirmLabel: 'Batalkan agenda',
        message: <div><p className="mb-2">Agenda tetap tersimpan dengan status Dibatalkan.</p><Input autoFocus placeholder="Alasan pembatalan" onChange={(e) => { reason.current = e.target.value; }} /></div> });
      if (!ok) return;
    }
    try { await api.ppk.agendas.setStatus(a.id, s, s === 'dibatalkan' ? reason.current : ''); list.reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Agenda PPK" subtitle="Kegiatan dari surat undangan. Buat agenda lewat tombol Buat Agenda di editor surat."
          actions={<Button variant="outline" onClick={() => setPast(!past)}>{past ? 'Tampilkan yang akan datang' : 'Tampilkan semua (termasuk lampau)'}</Button>} />
        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !list.data.length && <Empty>Belum ada agenda{past ? '' : ' yang akan datang'}.</Empty>}
        <div className="space-y-3">{list.data?.map((a) => (
          <Card key={a.id} className="p-4 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-navy-900">{a.title}</div>
                <div className="text-slate-600">{dayName(a.agenda_date)}, {formatDateID(a.agenda_date)}{a.start_time && ` · ${a.start_time}${a.end_time ? `–${a.end_time}` : ''}`}{a.letter_number && ` · ${a.letter_number}`}</div>
                <div className="text-slate-600">{[a.location, a.organizer].filter(Boolean).join(' · ')}</div>
                {a.meeting_url && <div className="truncate text-navy-700">{a.meeting_url}</div>}
                {a.agenda_text && <div className="mt-1 whitespace-pre-line text-slate-700">{a.agenda_text}</div>}
                <div className="mt-1">Penanggung jawab: <b>{a.pic?.name ?? '—'}</b>{a.support.length > 0 && <> · Pendukung: {a.support.map((s) => s.name).join(', ')}</>}</div>
                {a.cancel_reason && <div className="text-red-700">Alasan batal: {a.cancel_reason}</div>}
              </div>
              <div className="flex items-center gap-1">
                <Badge tone={a.status === 'terjadwal' ? 'navy' : a.status === 'selesai' ? 'green' : 'red'}>{AGENDA_STATUS_LABEL[a.status]}</Badge>
                {can('write') && a.status === 'terjadwal' && <>
                  <Button size="icon" variant="ghost" aria-label={`Ubah ${a.title}`} onClick={() => setEdit(a)}><Pencil size={14} /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Selesai ${a.title}`} onClick={() => status(a, 'selesai')}><CheckCircle2 size={14} /></Button>
                  <Button size="icon" variant="ghost" aria-label={`Batalkan ${a.title}`} onClick={() => status(a, 'dibatalkan')}><XCircle size={14} /></Button>
                </>}
              </div>
            </div>
          </Card>))}
        </div>
        <Dialog open={!!edit} onOpenChange={(o) => { if (!o) setEdit(null); }}>
          {edit && <AgendaForm initial={agendaToInput(edit)} existing={edit} onSaved={() => { setEdit(null); list.reload(); }} />}
        </Dialog>
      </PpkGate>
    </Page>
  );
}
