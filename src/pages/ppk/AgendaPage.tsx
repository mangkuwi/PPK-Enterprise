import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileUp, Plus } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, EMPTY_AGENDA, agendaToInput } from '@/features/ppk/AgendaForm';
import { AgendaRow, useDeleteAgenda } from '@/features/ppk/AgendaViews';
import { api } from '@/services/api';
import { jakartaToday } from '@shared/date';
import type { Agenda, AgendaFilter, AgendaFilterStatus, AgendaInput } from '@shared/ppk/agenda';

const STATUS: Array<[AgendaFilterStatus, string]> = [['aktif', 'Semua aktif'], ['belum_ditugaskan', 'Belum ditugaskan'], ['ditugaskan', 'Ditugaskan'],
  ['selesai', 'Selesai'], ['dibatalkan', 'Dibatalkan'], ['diarsipkan', 'Diarsipkan'], ['terhapus', 'Terhapus'], ['semua', 'Semua status (kecuali terhapus)']];
const KEYS = ['q', 'from', 'to', 'program_id', 'user_id', 'organizer', 'status'] as const;

/** Semua agenda: cari, saring, tambah manual, unggah surat undangan. Klik agenda = halaman detail. */
export default function AgendaPage() {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const { can, access } = usePpkAccess();
  const me = access?.user_id ?? '';
  const [sp, setSp] = useSearchParams();
  const f: AgendaFilter = Object.fromEntries(KEYS.map((k) => [k, sp.get(k) || undefined]).filter(([, v]) => v));
  if (!sp.get('from') && !sp.get('q') && !sp.get('status')) f.from = jakartaToday(); // bawaan: yang akan datang
  const set = (k: (typeof KEYS)[number], v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }); };
  const key = JSON.stringify(f);
  const list = useAsync(() => api.ppk.agendas.list(f), [key]);
  const people = useAsync(() => api.ppk.agendas.people(), []);
  const programs = useAsync(() => api.ppk.masterList('programs'), []);
  // ?baru=1 (dari tombol Tambah Agenda di Dashboard) langsung membuka formulir agenda baru.
  const [form, setForm] = useState<AgendaInput | null>(() => (sp.get('baru') ? { ...EMPTY_AGENDA, agenda_date: jakartaToday() } : null));
  const [editing, setEditing] = useState<Agenda | null>(null);
  const remove = useDeleteAgenda(() => list.reload());

  const upload = async () => {
    try {
      const r = await api.ppk.invitations.upload();
      if (!r) return;
      if (r.duplicate_of) toast('File yang sama persis pernah diunggah. Periksa agar agenda tidak ganda.', 'error');
      setForm({ ...EMPTY_AGENDA, invitation_id: r.id });
    } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Agenda PPK" subtitle="Semua kegiatan dari WhatsApp, unggahan, dan isian manual tersimpan di satu tempat."
          actions={can('write') && <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={upload}><FileUp size={16} /> Unggah surat undangan</Button>
            <Button onClick={() => setForm({ ...EMPTY_AGENDA, agenda_date: jakartaToday() })}><Plus size={16} /> Tambah agenda</Button>
          </div>} />

        <Card className="mb-4 grid gap-2 p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Input aria-label="Cari" placeholder="Cari judul, nomor surat, lokasi…" value={sp.get('q') ?? ''} onChange={(e) => set('q', e.target.value)} className="lg:col-span-2" />
          <Select aria-label="Status" value={sp.get('status') ?? 'aktif'} onChange={(e) => set('status', e.target.value === 'aktif' ? '' : e.target.value)}>
            {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          <Input aria-label="Penyelenggara" placeholder="Penyelenggara" value={sp.get('organizer') ?? ''} onChange={(e) => set('organizer', e.target.value)} />
          <label className="flex items-center gap-2"><span className="w-12 text-slate-500">Dari</span><Input type="date" value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} /></label>
          <label className="flex items-center gap-2"><span className="w-12 text-slate-500">Sampai</span><Input type="date" value={sp.get('to') ?? ''} onChange={(e) => set('to', e.target.value)} /></label>
          <Select aria-label="Staf" value={sp.get('user_id') ?? ''} onChange={(e) => set('user_id', e.target.value)}>
            <option value="">Semua staf</option>{people.data?.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `Agenda saya (${p.name})` : p.name}</option>)}
          </Select>
          <Select aria-label="Program" value={sp.get('program_id') ?? ''} onChange={(e) => set('program_id', e.target.value)}>
            <option value="">Semua program</option>{programs.data?.map((p) => <option key={p.id} value={p.id}>{String(p.code ?? '')} {String(p.name ?? '')}</option>)}
          </Select>
          {sp.toString() && <button className="text-left text-navy-600 hover:underline" onClick={() => setSp({}, { replace: true })}>Hapus semua filter</button>}
        </Card>

        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !list.data.length && <Empty>Tidak ada agenda yang cocok.</Empty>}
        {!!list.data?.length && <Card className="px-4"><div className="pt-3 text-xs text-slate-500">{list.data.length} agenda</div>
          <ul className="divide-y divide-slate-100">{list.data.map((a) => <AgendaRow key={a.id} a={a} showDate onOpen={() => navigate(`/ppk/agenda/${a.id}`)} onEdit={can('write') ? setEditing : undefined} onDelete={can('master') ? remove : undefined} />)}</ul></Card>}

        <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
          {editing && <AgendaForm initial={agendaToInput(editing)} existing={editing} onSaved={() => { setEditing(null); list.reload(); toast('Agenda diperbarui.', 'success'); }} />}
        </Dialog>
        <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
          {form && <AgendaForm initial={form} onSaved={(a) => { setForm(null); navigate(`/ppk/agenda/${a.id}`); }} />}
        </Dialog>
      </PpkGate>
    </Page>
  );
}
