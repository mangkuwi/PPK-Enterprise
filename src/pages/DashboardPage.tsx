import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, FileClock, FilePlus2, FileText, Files, Hash, ListTodo, Mail, MessageCircle, Pencil, Plus, Send, Star, Video } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaForm, EMPTY_AGENDA } from '@/features/ppk/AgendaForm';
import { AgendaCalendar, TimeGrid, WeekColumns, shortDate, timeText } from '@/features/ppk/AgendaViews';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import { REGISTER_PATH } from '@shared/numbering';
import { calendarDays, dayName, focusAgenda, joinLabel, liveState, shiftCursor, startsInText, type Agenda, type AgendaInput, type CalendarView } from '@shared/ppk/agenda';
import { cn } from '@/lib/utils';
import { addDays, formatDateID, jakartaToday } from '@shared/date';

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

const VIEW_TABS: Array<[CalendarView, string]> = [['hari', 'Harian'], ['minggu', 'Mingguan'], ['bulan', 'Bulanan']];
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
const dateBlock = (d: string) => <div className="w-12 shrink-0 rounded-lg bg-navy-50 py-1 text-center"><b className="block text-lg leading-tight text-navy-900">{Number(d.slice(8))}</b><span className="text-[10px] uppercase text-slate-500">{dayName(d).slice(0, 3)}</span></div>;

/** Kartu sorotan: rapat yang sedang berlangsung atau berikutnya, dengan tombol gabung dan undangan asli. */
function FocusCard({ a, next, today, now, onOpen }: { a: Agenda | null; next: Agenda | undefined; today: string; now: string; onOpen: (a: Agenda) => void }) {
  const { toast } = useFeedback();
  const box = 'flex min-h-60 flex-col justify-center gap-2 rounded-2xl bg-gradient-to-br from-navy-800 to-violet-900 p-6 text-white';
  if (!a) return <div className={box}><div className="text-xl font-bold">Tidak ada agenda dalam 7 hari ke depan</div><div className="text-sm text-navy-100">Agenda baru dari undangan WhatsApp atau isian manual akan tampil di sini.</div></div>;
  const live = liveState(a, today, now) === 'berlangsung';
  const when = live ? `selesai ${a.end_time || 'dalam 1 jam'}` : startsInText(a, today, now) ?? `${dayName(a.agenda_date)}, ${formatDateID(a.agenda_date)}`;
  const people = [...(a.pic ? [a.pic] : []), ...a.support];
  const openInvitation = async () => {
    try { const [f] = await api.ppk.invitations.files(a.invitation_id!); if (f) await api.ppk.invitations.openFile(f.id); else toast('Undangan ini tanpa lampiran.', 'error'); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  const ghost = 'inline-flex items-center gap-1.5 rounded-md border border-white/40 px-3 py-2 text-sm font-semibold hover:bg-white/10';
  return (
    <div className={box}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-navy-100">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', live ? 'bg-green-500 text-white' : 'bg-white/15 text-white')}>{live ? '● Sedang berlangsung' : a.agenda_date === today ? 'Berikutnya hari ini' : 'Agenda berikutnya'}</span>{when}
      </div>
      <button onClick={() => onOpen(a)} className="text-left text-2xl font-bold leading-tight hover:underline">{a.title}</button>
      <div className="text-sm text-navy-100">{a.agenda_date === today ? 'Hari ini' : shortDate(a.agenda_date)} · {timeText(a)} WIB{a.meeting_url ? ` · ${joinLabel(a.meeting_url).replace(/^Gabung /, '')}` : a.location && ` · ${a.location}`}{a.organizer && ` · ${a.organizer}`}</div>
      <div className="flex items-center gap-2 text-sm text-navy-100">
        {people.length ? <><span className="flex">{people.slice(0, 4).map((p, i) => <span key={p.id} className={cn('-mr-1.5 grid h-7 w-7 place-items-center rounded-full border-2 border-navy-800 text-[10px] font-bold', i === 0 && a.pic ? 'bg-white text-navy-900' : 'bg-navy-200 text-navy-900')}>{initials(p.name)}</span>)}</span>
          <span className="ml-2">{people.map((p, i) => (i === 0 && a.pic ? `${p.name} (PJ)` : p.name)).join(', ')}</span></>
          : <span className="rounded bg-amber-400/20 px-2 py-0.5 text-amber-100">Belum ada penanggung jawab</span>}
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {a.meeting_url && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-5 py-2.5 font-semibold hover:bg-green-700"><Video size={18} /> {joinLabel(a.meeting_url)} <ArrowRight size={16} /></a>}
        <button onClick={() => onOpen(a)} className={ghost}>Lihat detail</button>
        {a.invitation_id && <button onClick={openInvitation} className={ghost}><FileText size={14} /> Undangan asli</button>}
      </div>
      {next && <div className="mt-1 border-t border-white/20 pt-2 text-sm text-navy-100">Berikutnya{next.agenda_date === today ? ' hari ini' : `, ${shortDate(next.agenda_date)}`}: <button onClick={() => onOpen(next)} className="font-semibold text-white hover:underline">{next.start_time && `${next.start_time} `}{next.title}</button>{next.location && ` · ${next.location}`}</div>}
    </div>
  );
}

/** Beranda: agenda PPK sebagai isi utama. Semua angka dari query database (ppk:agendas:home). */
function AgendaHomeSection() {
  const navigate = useNavigate();
  const { can } = usePpkAccess();
  const home = useAsync(() => api.ppk.agendas.home(), []);
  const today = home.data?.today ?? jakartaToday();
  const [view, setView] = useState<CalendarView>('minggu');
  const now = useJakartaClock();
  const [cursor, setCursor] = useState(today);
  const [form, setForm] = useState<{ initial: AgendaInput } | null>(null);
  const days = calendarDays(view, cursor);
  const cal = useAsync(() => api.ppk.agendas.list({ from: days[0], to: days.at(-1)!, status: 'semua' }), [days[0], days.at(-1)]);
  const h = home.data;
  const shown = (cal.data ?? []).filter((a) => a.status !== 'dibatalkan' && !a.archived_at);
  const setOpen = (a: Agenda) => navigate(`/ppk/agenda/${a.id}`);
  const { focus, rest } = focusAgenda(h?.today_agendas ?? [], h?.upcoming ?? [], today, now);
  const range = view === 'hari' ? `${dayName(cursor)}, ${formatDateID(cursor)}` : view === 'minggu' ? `${formatDateID(days[0])} – ${formatDateID(days[6])}` : formatDateID(cursor).replace(/^\d+ /, '');
  const chips: Array<[number | undefined, string, string, boolean]> = [
    [h?.counts.today_total, 'agenda hari ini', '/ppk/agenda', false], [h?.counts.month_total, 'bulan ini', '/ppk/agenda', false],
    [h?.counts.wa_incoming, 'pesan WhatsApp baru', '/ppk/kotak-masuk?status=baru', true], [h?.counts.pending_verification, 'undangan menunggu verifikasi', '/ppk/kotak-masuk?status=menunggu_verifikasi', true],
    [h?.counts.pending_assignment, 'belum ada penanggung jawab', '/ppk/agenda?status=belum_ditugaskan', true], [h?.needs_report.length, 'lewat, belum ditutup', `/ppk/agenda?status=aktif&to=${addDays(today, -1)}`, true]
  ];

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><div className="text-xs font-semibold uppercase tracking-wider text-navy-600">PPK Management</div>
          <h1 className="text-2xl font-bold text-navy-900">Jadwal Agenda PPK</h1>
          <div className="text-sm text-slate-600">{dayName(today)}, {formatDateID(today)} · {now} WIB</div></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate('/ppk/kotak-masuk')}><MessageCircle size={16} /> Kotak Masuk WhatsApp{h && h.counts.wa_incoming + h.counts.pending_verification > 0 && <Badge tone="amber">{h.counts.wa_incoming + h.counts.pending_verification}</Badge>}</Button>
          <Button variant="outline" onClick={() => navigate('/ppk/agenda')}><ListTodo size={16} /> Semua agenda</Button>
          {can('write') && <Button className="bg-violet-700 hover:bg-violet-800" onClick={() => setForm({ initial: { ...EMPTY_AGENDA, agenda_date: view === 'hari' ? cursor : today } })}><Plus size={16} /> Tambah Agenda</Button>}
        </div>
      </div>
      {home.error && <div className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800" role="alert">{home.error}</div>}

      <div className="flex flex-wrap gap-2 text-sm">{chips.filter(([v, , , warn]) => !warn || (v ?? 0) > 0).map(([v, l, to, warn]) => (
        <Link key={l} to={to} className={cn('rounded-full border px-3 py-1 hover:shadow-sm', warn ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700')}>
          <b className="mr-1 text-navy-900">{v ?? '–'}</b>{l}{warn && ' →'}</Link>))}</div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <FocusCard a={focus} next={rest[0]} today={today} now={now} onOpen={setOpen} />
        <Card className="min-w-0">
          <div className="flex items-center justify-between px-4 pb-1 pt-3"><span className="font-semibold text-navy-900">Agenda terdekat</span><span className="text-xs text-slate-500">7 hari ke depan</span></div>
          {!rest.length && <p className="px-4 py-6 text-sm text-slate-500">Tidak ada agenda lain dalam 7 hari ke depan.</p>}
          <ul className="divide-y divide-slate-100">{rest.slice(0, 5).map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              {dateBlock(a.agenda_date)}
              <button onClick={() => setOpen(a)} className="min-w-0 flex-1 text-left"><div className="truncate font-semibold text-navy-900 hover:underline">{a.title}</div>
                <div className="truncate text-xs text-slate-500">{timeText(a)}{a.meeting_url ? ` · ${joinLabel(a.meeting_url).replace(/^Gabung /, '')}` : a.location && ` · ${a.location}`}{!a.pic && <span className="text-amber-700"> · belum ada PJ</span>}</div></button>
              {a.meeting_url ? <a href={a.meeting_url} target="_blank" rel="noreferrer" aria-label={`${joinLabel(a.meeting_url)}: ${a.title}`} className="rounded-md bg-violet-700 px-3 py-1 text-xs font-semibold text-white hover:bg-violet-800">Gabung</a>
                : <Badge tone={a.pic ? 'green' : 'amber'}>{a.pic ? 'Tatap muka' : 'Tugaskan'}</Badge>}
            </li>))}</ul>
          {rest.length > 5 && <Link to="/ppk/agenda" className="block px-4 py-2 text-sm text-navy-600 hover:underline">+{rest.length - 5} agenda lain</Link>}
        </Card>
      </div>

      <Card className="p-4" id="kalender">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <span className="mr-2 font-semibold text-navy-900">{range}</span>
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
          : view === 'minggu' ? <WeekColumns days={days} agendas={shown} today={today} now={now} onOpen={setOpen} />
            : <TimeGrid days={days} agendas={shown} today={today} now={now} onOpen={setOpen} />}
      </Card>

      <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
        {form && <AgendaForm initial={form.initial} onSaved={(a) => { setForm(null); navigate(`/ppk/agenda/${a.id}`); }} />}
      </Dialog>
    </section>
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
