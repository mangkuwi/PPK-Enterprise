import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, FileClock, FilePlus2, FileText, Files, Hash, ListTodo, Mail, MessageCircle, Pencil, Plus, Send, Star } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, EMPTY_AGENDA } from '@/features/ppk/AgendaForm';
import { AgendaCalendar, MiniMonth, TimeGrid, timeText } from '@/features/ppk/AgendaViews';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import { REGISTER_PATH } from '@shared/numbering';
import { calendarDays, dayName, shiftCursor, type Agenda, type AgendaInput, type CalendarView } from '@shared/ppk/agenda';
import { cn } from '@/lib/utils';
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

/** Jam WIB 'HH:MM', diperbarui tiap 30 detik (untuk tanda "Sedang berlangsung"). */
function useJakartaClock() {
  const read = () => new Date().toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const [t, setT] = useState(read);
  useEffect(() => { const id = setInterval(() => setT(read()), 30000); return () => clearInterval(id); }, []);
  return t;
}

type Kind = 'daring' | 'tatap_muka' | 'belum_ditugaskan' | 'ditugaskan' | 'selesai';
const KINDS: Array<[Kind, string, (a: Agenda) => boolean]> = [
  ['daring', 'Rapat daring', (a) => !!a.meeting_url], ['tatap_muka', 'Tatap muka', (a) => !a.meeting_url],
  ['belum_ditugaskan', 'Belum ditugaskan', (a) => a.status === 'terjadwal' && !a.pic], ['ditugaskan', 'Ditugaskan', (a) => a.status === 'terjadwal' && !!a.pic],
  ['selesai', 'Selesai', (a) => a.status === 'selesai']
];
const VIEW_TABS: Array<[CalendarView, string]> = [['hari', 'Harian'], ['minggu', 'Mingguan'], ['bulan', 'Bulanan']];

/** Beranda: jadwal Agenda PPK sebagai isi utama. Semua angka dari query database (ppk:agendas:home). */
function AgendaHomeSection() {
  const navigate = useNavigate();
  const { can } = usePpkAccess();
  const home = useAsync(() => api.ppk.agendas.home(), []);
  const today = home.data?.today ?? jakartaToday();
  const [view, setView] = useState<CalendarView>('minggu');
  const now = useJakartaClock();
  const [cursor, setCursor] = useState(today);
  const [hidden, setHidden] = useState<Set<Kind>>(new Set());
  const [form, setForm] = useState<{ initial: AgendaInput } | null>(null);
  const days = calendarDays(view, cursor);
  const month = calendarDays('bulan', cursor);
  const cal = useAsync(() => api.ppk.agendas.list({ from: month[0] < days[0] ? month[0] : days[0], to: month.at(-1)! > days.at(-1)! ? month.at(-1)! : days.at(-1)!, status: 'semua' }),
    [month[0], days[0], days.at(-1)]);
  const h = home.data;
  const shown = (cal.data ?? []).filter((a) => a.status !== 'dibatalkan' && !a.archived_at && !KINDS.some(([k, , m]) => hidden.has(k) && m(a)));
  const setOpen = (a: Agenda) => navigate(`/ppk/agenda/${a.id}`);
  const toggle = (k: Kind) => setHidden((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const nextUp = (h?.today_agendas ?? []).filter((a) => a.status === 'terjadwal' && (!a.end_time || a.end_time > now));
  const range = view === 'hari' ? `${dayName(cursor)}, ${formatDateID(cursor)}` : view === 'minggu' ? `${formatDateID(days[0])} – ${formatDateID(days[6])}` : formatDateID(cursor).replace(/^\d+ /, '');

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[270px_minmax(0,1fr)]">
      <aside className="min-w-0 space-y-4">
        <Card className="p-4"><MiniMonth cursor={cursor} setCursor={setCursor} today={today} week={view === 'bulan' ? [] : days} marked={new Set((cal.data ?? []).filter((a) => a.status === 'terjadwal').map((a) => a.agenda_date))} /></Card>
        <Card className="p-4">
          <div className="mb-2 font-semibold text-navy-900">Jenis agenda</div>
          <ul className="space-y-2 text-sm">{KINDS.map(([k, l, m]) => (
            <li key={k} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" />{l} <span className="text-xs text-slate-400">{(cal.data ?? []).filter((a) => days.includes(a.agenda_date) && a.status !== 'dibatalkan' && !a.archived_at && m(a)).length}</span></span>
              <button role="switch" aria-checked={!hidden.has(k)} aria-label={`Tampilkan ${l}`} onClick={() => toggle(k)}
                className={cn('relative h-5 w-9 rounded-full transition-colors', hidden.has(k) ? 'bg-slate-300' : 'bg-emerald-500')}>
                <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', hidden.has(k) ? 'left-0.5' : 'left-[18px]')} /></button>
            </li>))}</ul>
        </Card>
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between font-semibold text-navy-900">Pengingat{h && <Badge tone="amber">{h.counts.pending_verification + h.counts.pending_assignment + h.needs_report.length}</Badge>}</div>
          <ul className="space-y-2 text-sm">
            {nextUp.map((a) => <li key={a.id}><button onClick={() => setOpen(a)} className="w-full rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50">
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{a.title}</span><Badge tone={a.meeting_url ? 'navy' : 'green'}>{a.meeting_url ? 'Daring' : 'Rapat'}</Badge></div>
              <div className="text-xs text-slate-500">Hari ini · {timeText(a)}</div></button></li>)}
            {!!h?.counts.pending_verification && <li><Link to="/ppk/kotak-masuk?status=menunggu_verifikasi" className="block rounded-md border border-amber-200 bg-amber-50 p-2 hover:bg-amber-100">
              <b>{h.counts.pending_verification}</b> undangan menunggu verifikasi</Link></li>}
            {!!h?.counts.pending_assignment && <li><Link to="/ppk/agenda?status=belum_ditugaskan" className="block rounded-md border border-amber-200 bg-amber-50 p-2 hover:bg-amber-100">
              <b>{h.counts.pending_assignment}</b> agenda belum ada penanggung jawab</Link></li>}
            {h?.needs_report.map((a) => <li key={a.id}><button onClick={() => setOpen(a)} className="w-full rounded-md border border-slate-200 p-2 text-left hover:bg-slate-50">
              <div className="truncate font-medium">{a.title}</div><div className="text-xs text-slate-500">{formatDateID(a.agenda_date)} · lewat, belum ditutup</div></button></li>)}
            {h && !nextUp.length && !h.counts.pending_verification && !h.counts.pending_assignment && !h.needs_report.length && <li className="text-slate-500">Tidak ada pengingat.</li>}
          </ul>
        </Card>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="text-xs font-semibold uppercase tracking-wider text-navy-600">PPK Management</div>
            <h1 className="text-2xl font-bold text-navy-900">Jadwal Agenda PPK</h1>
            <div className="text-sm text-slate-600">{dayName(today)}, {formatDateID(today)} · {now} WIB</div></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/ppk/kotak-masuk')}><MessageCircle size={16} /> Kotak Masuk WhatsApp{h && h.counts.wa_incoming > 0 && <Badge tone="amber">{h.counts.wa_incoming}</Badge>}</Button>
            <Button variant="outline" onClick={() => navigate('/ppk/agenda')}><ListTodo size={16} /> Semua agenda</Button>
            {can('write') && <Button className="bg-violet-700 hover:bg-violet-800" onClick={() => setForm({ initial: { ...EMPTY_AGENDA, agenda_date: view === 'hari' ? cursor : today } })}><Plus size={16} /> Tambah Agenda</Button>}
          </div>
        </div>
        {home.error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800" role="alert">{home.error}</div>}

        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-navy-50 p-4">
          <span className="grid h-11 w-11 place-items-center rounded-lg bg-violet-700 text-white"><MessageCircle size={20} /></span>
          <div className="min-w-0 flex-1"><div className="font-semibold text-navy-900">Undangan dari WhatsApp</div>
            <div className="text-sm text-slate-600">{h ? `${h.inbox.baru} baru · ${h.inbox.menunggu_verifikasi} menunggu verifikasi · ${h.inbox.gagal} gagal diproses · ${h.inbox.dikonversi_bulan_ini} jadi agenda bulan ini` : 'Memuat…'}</div></div>
          <Button variant="outline" onClick={() => navigate('/ppk/kotak-masuk?status=menunggu_verifikasi')}>Verifikasi undangan <ArrowRight size={14} /></Button>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {([['Agenda bulan ini', h?.counts.month_total, '/ppk/agenda'], ['Agenda hari ini', h?.counts.today_total, '/ppk/agenda'], ['Undangan WA masuk', h?.counts.wa_incoming, '/ppk/kotak-masuk?status=baru'],
            ['Menunggu verifikasi', h?.counts.pending_verification, '/ppk/kotak-masuk?status=menunggu_verifikasi'], ['Belum ditugaskan', h?.counts.pending_assignment, '/ppk/agenda?status=belum_ditugaskan']] as const).map(([l, v, to]) => (
            <Link key={l} to={to} className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-navy-300"><div className="text-xl font-bold text-navy-900">{v ?? '–'}</div><div className="text-xs text-slate-600">{l}</div></Link>))}
        </div>

        <Card className="p-4" id="kalender">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <span className="mr-2 text-lg font-semibold text-navy-900">{range}</span>
              <Button size="icon" variant="outline" aria-label="Sebelumnya" onClick={() => setCursor(shiftCursor(view, cursor, -1))}><ChevronLeft size={16} /></Button>
              <Button size="icon" variant="outline" aria-label="Berikutnya" onClick={() => setCursor(shiftCursor(view, cursor, 1))}><ChevronRight size={16} /></Button>
              {!days.includes(today) && <Button size="sm" variant="ghost" onClick={() => setCursor(today)}>Hari ini</Button>}
            </div>
            <div className="flex rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Tampilan jadwal">
              {VIEW_TABS.map(([v, l]) => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={cn('rounded-md px-4 py-1 text-sm', view === v ? 'bg-white font-semibold text-navy-900 shadow-sm' : 'text-slate-500 hover:text-navy-800')}>{l}</button>)}
            </div>
          </div>
          {cal.error && <p className="mb-2 text-sm text-red-700">{cal.error}</p>}
          {view === 'bulan'
            ? <AgendaCalendar view="bulan" setView={setView} cursor={cursor} setCursor={setCursor} today={today} agendas={shown} selected={null} hideHeader
              onSelect={(d) => { if (d) { setCursor(d); setView('hari'); } }} onOpen={setOpen} />
            : <TimeGrid days={days} agendas={shown.filter((a) => days.includes(a.agenda_date))} today={today} now={now} onOpen={setOpen} />}
        </Card>
      </section>

      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        {form && <AgendaForm initial={form.initial} onSaved={(a) => { setForm(null); navigate(`/ppk/agenda/${a.id}`); }} />}
      </Dialog>
    </div>
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
