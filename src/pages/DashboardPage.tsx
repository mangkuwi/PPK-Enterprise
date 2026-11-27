import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CalendarCheck, CalendarDays, CalendarRange, ClipboardCheck, FileClock, FilePlus2, FileText, Files, Hash, ListTodo, Mail, MessageCircle, Pencil, Plus, Send, Star, UserX } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, agendaToInput } from '@/features/ppk/AgendaForm';
import { AgendaCalendar, AgendaDetail, AgendaRow } from '@/features/ppk/AgendaViews';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import { REGISTER_PATH } from '@shared/numbering';
import { calendarDays, dayName, type Agenda, type AgendaInput, type CalendarView } from '@shared/ppk/agenda';
import { formatDateID, jakartaToday } from '@shared/date';

function Stat({ icon: Icon, label, value, hint, to }: { icon: typeof Files; label: string; value: string | number; hint?: string; to?: string }) {
  const body = (
    <Card className="flex items-center gap-4 p-4 transition-shadow hover:shadow-md">
      <div className="grid h-11 w-11 place-items-center rounded-lg bg-navy-100 text-navy-800"><Icon size={22} /></div>
      <div className="min-w-0"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
        <div className="truncate text-2xl font-bold text-navy-900">{value}</div>{hint && <div className="truncate text-xs text-slate-500">{hint}</div>}</div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

const EMPTY_AGENDA: AgendaInput = { title: '', letter_number: '', source_document_id: null, agenda_date: '', start_time: '', end_time: '', location: '',
  meeting_url: '', organizer: '', agenda_text: '', notes: '', pic_user_id: null, support_user_ids: [] };

function Count({ icon: Icon, label, value, to, tone = 'navy' }: { icon: typeof Files; label: string; value: number | undefined; to: string; tone?: 'navy' | 'amber' }) {
  return (
    <Link to={to} className="block min-w-0">
      <Card className="flex h-full items-center gap-3 p-3 transition-shadow hover:shadow-md">
        <div className={tone === 'amber' ? 'grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-800' : 'grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-navy-100 text-navy-800'}><Icon size={20} /></div>
        <div className="min-w-0"><div className="text-2xl font-bold leading-tight text-navy-900">{value ?? '–'}</div><div className="text-xs leading-tight text-slate-600">{label}</div></div>
      </Card>
    </Link>
  );
}

/** Jam WIB 'HH:MM', diperbarui tiap 30 detik (untuk tanda "Sedang berlangsung"). */
function useJakartaClock() {
  const read = () => new Date().toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const [t, setT] = useState(read);
  useEffect(() => { const id = setInterval(() => setT(read()), 30000); return () => clearInterval(id); }, []);
  return t;
}

const Box = ({ title, link, children, id }: { title: React.ReactNode; link?: React.ReactNode; children: React.ReactNode; id?: string }) => (
  <Card className="min-w-0 p-4" id={id}>
    <div className="mb-2 flex items-center justify-between gap-2 font-semibold text-navy-900"><span className="flex items-center gap-2">{title}</span>{link}</div>
    {children}
  </Card>
);

/** Beranda: Agenda PPK sebagai isi utama. Semua angka dari query database (ppk:agendas:home). */
function AgendaHomeSection() {
  const navigate = useNavigate();
  const { can } = usePpkAccess();
  const home = useAsync(() => api.ppk.agendas.home(), []);
  const today = home.data?.today ?? jakartaToday();
  const [view, setView] = useState<CalendarView>('bulan');
  const now = useJakartaClock();
  const [cursor, setCursor] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Agenda | null>(null);
  const [form, setForm] = useState<{ initial: AgendaInput; existing?: Agenda } | null>(null);
  const days = calendarDays(view, cursor);
  const cal = useAsync(() => api.ppk.agendas.list({ from: days[0], to: days[days.length - 1] }), [days[0], days[days.length - 1]]);
  const h = home.data;
  const listed = (cal.data ?? []).filter((a) => (selected ? a.agenda_date === selected : true));
  const reload = () => { home.reload(); cal.reload(); };
  const pendingTotal = h ? h.counts.pending_verification + h.counts.pending_assignment + h.needs_report.length : undefined;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-navy-600">PPK Management</div>
          <h1 className="text-2xl font-bold text-navy-900">Agenda PPK</h1>
          <div className="text-sm text-slate-600">{dayName(today)}, {formatDateID(today)} · WIB</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('write') && <Button onClick={() => setForm({ initial: { ...EMPTY_AGENDA, agenda_date: selected ?? today } })}><Plus size={16} /> Tambah Agenda</Button>}
          <Button variant="outline" onClick={() => navigate('/ppk/kotak-masuk')}><MessageCircle size={16} /> Kotak Masuk WhatsApp{h && h.counts.wa_incoming > 0 && <Badge tone="amber">{h.counts.wa_incoming}</Badge>}</Button>
          <Button variant="outline" onClick={() => document.getElementById('kalender')?.scrollIntoView({ behavior: 'smooth' })}><CalendarDays size={16} /> Kalender</Button>
        </div>
      </div>
      {home.error && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800" role="alert">{home.error}</div>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Count icon={CalendarRange} label="Agenda bulan ini" value={h?.counts.month_total} to="/ppk/agenda" />
        <Count icon={CalendarCheck} label="Agenda hari ini" value={h?.counts.today_total} to="/ppk/agenda" />
        <Count icon={MessageCircle} label="Undangan WhatsApp masuk" value={h?.counts.wa_incoming} to="/ppk/kotak-masuk?status=baru" />
        <Count icon={ClipboardCheck} label="Menunggu verifikasi" value={h?.counts.pending_verification} to="/ppk/kotak-masuk?status=menunggu_verifikasi" tone="amber" />
        <Count icon={UserX} label="Belum ditugaskan" value={h?.counts.pending_assignment} to="/ppk/agenda" tone="amber" />
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Box title={<><CalendarDays size={18} /> {selected ? `Agenda ${dayName(selected)}, ${formatDateID(selected)}` : 'Agenda kegiatan'}</>}
          link={selected ? <button className="text-sm font-normal text-navy-600 hover:underline" onClick={() => setSelected(null)}>Kembali ke hari ini</button>
            : <Link to="/ppk/agenda" className="text-sm font-normal text-navy-600 hover:underline">Semua agenda</Link>}>
          {selected ? (cal.data && (listed.length ? <ul className="divide-y divide-slate-100">{listed.map((a) => <AgendaRow key={a.id} a={a} onOpen={setOpen} today={today} now={now} />)}</ul>
            : <Empty>Tidak ada agenda pada tanggal ini.</Empty>)) : <>
            <h3 className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Hari ini</h3>
            {h?.today_agendas.length ? <ul className="divide-y divide-slate-100">{h.today_agendas.map((a) => <AgendaRow key={a.id} a={a} onOpen={setOpen} today={today} now={now} />)}</ul>
              : <p className="py-3 text-sm text-slate-500">Tidak ada agenda hari ini.</p>}
            <h3 className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">7 hari ke depan</h3>
            {h?.upcoming.length ? <ul className="divide-y divide-slate-100">{h.upcoming.map((a) => <AgendaRow key={a.id} a={a} onOpen={setOpen} showDate />)}</ul>
              : <p className="py-3 text-sm text-slate-500">Tidak ada agenda 7 hari ke depan.</p>}
          </>}
        </Box>

        <div className="min-w-0 space-y-4">
          <Box id="kalender" title={<><CalendarRange size={16} /> Kalender</>}>
            <AgendaCalendar compact view={view} setView={setView} cursor={cursor} setCursor={setCursor} today={today} agendas={cal.data ?? []}
              selected={selected} onSelect={(d) => { setSelected(d); if (d && view === 'hari') setCursor(d); }} onOpen={setOpen} />
            {cal.error && <p className="mt-2 text-sm text-red-700">{cal.error}</p>}
          </Box>
          <Box title={<><MessageCircle size={16} /> Kotak Masuk WhatsApp</>} link={<Link to="/ppk/kotak-masuk" className="text-sm font-normal text-navy-600 hover:underline">Buka</Link>}>
            <div className="grid grid-cols-2 gap-2 text-center">
              {([['Undangan baru', h?.inbox.baru, 'baru'], ['Menunggu verifikasi', h?.inbox.menunggu_verifikasi, 'menunggu_verifikasi'],
                ['Gagal diproses', h?.inbox.gagal, 'gagal'], ['Dikonversi bulan ini', h?.inbox.dikonversi_bulan_ini, 'dikonversi']] as const).map(([l, v, st]) => (
                <Link key={st} to={`/ppk/kotak-masuk?status=${st}`} className="rounded-lg border border-slate-200 p-2 hover:border-navy-300 hover:bg-slate-50">
                  <div className="text-xl font-bold text-navy-900">{v ?? '–'}</div><div className="text-xs text-slate-600">{l}</div>
                </Link>))}
            </div>
          </Box>
          <Box title={<><ListTodo size={16} /> Tindakan tertunda{pendingTotal ? <Badge tone="amber">{pendingTotal}</Badge> : null}</>}>
            {h && !pendingTotal ? <Empty>Tidak ada tindakan tertunda.</Empty> : (
              <ul className="space-y-3 text-sm">
                {!!h?.awaiting_verification.length && <li><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Undangan menunggu verifikasi</div>
                  {h.awaiting_verification.map((i) => <Link key={i.id} to="/ppk/kotak-masuk?status=menunggu_verifikasi" className="block truncate text-navy-800 hover:underline">{i.sender_name || i.sender_phone || 'Unggah manual'} · {formatDateTime(i.received_at)}</Link>)}</li>}
                {!!h?.unassigned.length && <li><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Agenda tanpa penanggung jawab</div>
                  {h.unassigned.map((a) => <button key={a.id} onClick={() => setOpen(a)} className="block w-full truncate text-left text-navy-800 hover:underline">{formatDateID(a.agenda_date)} · {a.title}</button>)}</li>}
                {!!h?.needs_report.length && <li><div className="mb-1 text-xs font-semibold uppercase text-slate-500">Kegiatan lewat, belum ditutup / dilaporkan</div>
                  {h.needs_report.map((a) => <button key={a.id} onClick={() => setOpen(a)} className="block w-full truncate text-left text-navy-800 hover:underline">{formatDateID(a.agenda_date)} · {a.title}</button>)}</li>}
              </ul>)}
          </Box>
        </div>
      </div>
      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {open && <AgendaDetail a={open} canEdit={can('write')} onEdit={() => { setForm({ initial: agendaToInput(open), existing: open }); setOpen(null); }} />}
      </Dialog>
      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        {form && <AgendaForm initial={form.initial} existing={form.existing} onSaved={() => { setForm(null); reload(); }} />}
      </Dialog>
    </>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const stats = useAsync(() => api.stats(), []);
  const reg = useAsync(() => api.numbering.summary(new Date().getFullYear()), []);
  const s = stats.data;
  const totals = (reg.data ?? []).reduce((a, x) => ({ available: a.available + x.available - x.review, assigned: a.assigned + x.assigned, issued: a.issued + x.issued }), { available: 0, assigned: 0, issued: 0 });
  return (
    <Page>
      <PpkGate><AgendaHomeSection /></PpkGate>

      <h2 className="mb-3 mt-8 border-t border-slate-200 pt-6 text-lg font-semibold text-navy-900">Naskah Dinas</h2>
      {(stats.error || reg.error) && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{stats.error ?? reg.error}</div>}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Files} label="Total dokumen" value={s?.totalDocuments ?? '–'} hint={s ? `${s.documentsThisMonth} dibuat bulan ini` : undefined} to="/archive" />
        <Stat icon={FileClock} label="Draft aktif" value={s?.activeDrafts ?? '–'} to="/archive?status=draft" />
        <Stat icon={FileText} label="Template tersimpan" value={s?.totalTemplates ?? '–'} to="/templates" />
        <Stat icon={Hash} label="Nomor tersedia" value={reg.data ? totals.available : '–'} hint="Siap dipilih saat membuat dokumen" to="/bank-nomor" />
      </div>

      <h2 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">Aksi cepat</h2>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigate('/generator?cat=ND')}><FileText size={16} /> Buat Nota Dinas</Button>
        <Button variant="outline" onClick={() => navigate('/generator?cat=UND')}><Mail size={16} /> Buat Surat Undangan</Button>
        <Button variant="outline" onClick={() => navigate('/generator?register=SURAT_KELUAR')}><Send size={16} /> Buat Surat Keluar</Button>
        <Button variant="outline" onClick={() => navigate('/generator')}><FilePlus2 size={16} /> Buat Dokumen Baru</Button>
      </div>


      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between font-semibold text-navy-900">Dokumen terbaru<Link to="/archive" className="text-sm font-normal text-navy-600 hover:underline">Lihat semua</Link></div>
          {s?.recentDocuments.length ? (
            <ul className="divide-y divide-slate-100">
              {s.recentDocuments.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <Link to={`/documents/${d.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium hover:underline">{d.title}</div>
                    <div className="text-xs text-slate-500">{d.category_name} · {formatDateTime(d.created_at)}</div>
                  </Link>
                  <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                  <Button size="icon" variant="ghost" title="Edit" aria-label={`Edit ${d.title}`} onClick={() => navigate(`/documents/${d.id}`)}><Pencil size={14} /></Button>
                </li>
              ))}
            </ul>
          ) : <Empty>Belum ada dokumen. Mulai dengan “Buat Nota Dinas”.</Empty>}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2 font-semibold text-navy-900"><Star size={16} className="text-amber-500" /> Template favorit</div>
          {s?.favoriteTemplates.length ? (
            <ul className="divide-y divide-slate-100">
              {s.favoriteTemplates.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2">
                  <div><div className="text-sm font-medium">{t.name}</div><div className="text-xs text-slate-500">{t.category_name}</div></div>
                  <Button size="sm" onClick={() => navigate(`/generator?template=${t.id}`)}>Gunakan</Button>
                </li>
              ))}
            </ul>
          ) : <Empty>Tandai template dengan bintang di menu Template Dokumen untuk akses cepat di sini.</Empty>}
        </Card>
      </div>

      <Card className="mt-6 p-4">
        <div className="mb-3 flex items-center justify-between font-semibold text-navy-900"><span className="flex items-center gap-2"><Hash size={16} /> Ringkasan Bank Nomor Dokumen</span><Link to="/bank-nomor" className="text-sm font-normal text-navy-600 hover:underline">Kelola nomor</Link></div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {(reg.data ?? []).map((x) => (
            <Link key={x.register.id} to={`/register/${REGISTER_PATH[x.register.code]}`} className="rounded-lg border border-slate-200 p-3 hover:border-navy-300 hover:bg-slate-50">
              <div className="mb-2 text-sm font-semibold text-navy-900">{x.register.name}</div>
              <div className="grid grid-cols-3 gap-1 text-center text-xs">
                <div><div className="text-lg font-bold text-navy-900">{x.available - x.review}</div><div className="text-slate-500">Tersedia</div></div>
                <div><div className="text-lg font-bold text-amber-700">{x.assigned}</div><div className="text-slate-500">Dipakai draf</div></div>
                <div><div className="text-lg font-bold text-green-700">{x.issued}</div><div className="text-slate-500">Terbit</div></div>
              </div>
            </Link>
          ))}
        </div>
        {!reg.loading && !reg.data?.length && <Empty>Belum ada data register.</Empty>}
      </Card>
    </Page>
  );
}
