import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, BarChart3, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, CloudUpload, FilePlus2, FileSignature, FileText, Gauge, Globe, Hash, Layers, ListTodo, Mail, MapPin, MessageCircle, Network, Plus, Receipt, RefreshCw, Satellite, Star, TrendingUp, Video, Wallet, Wifi, Zap } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaCalendar, shortDate, timeText } from '@/features/ppk/AgendaViews';
import { TodoList } from '@/features/ppk/TodoList';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { cn, formatDateTime } from '@/lib/utils';
import { addDays, formatDateID, jakartaToday } from '@shared/date';
import { dashboardYear, monitoredPrograms, programProgress } from '@shared/dashboard';
import { calendarDays, dayName, focusAgenda, joinButton, liveState, meetingMode, shiftCursor, startsInText, type Agenda } from '@shared/ppk/agenda';
import { taskStats } from '@shared/ppk/tasks';
import { timeAgo, type ActivityKind } from '@shared/ppk/activity';
import { formatRupiah } from '@shared/ppk/money';
import { MONTH_LABEL } from '@shared/ppk/forecast';
import networkAccent from '@/assets/branding/aksen-jaringan-indonesia.svg';

/** Jam WIB 'HH:MM', diperbarui tiap 30 detik. */
function useJakartaClock() {
  const read = () => new Date().toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const [t, setT] = useState(read);
  useEffect(() => { const id = setInterval(() => setT(read()), 30000); return () => clearInterval(id); }, []);
  return t;
}

/** Kartu ringkasan berwarna (komponen bersama untuk empat angka utama). */
function StatCard({ to, icon: Icon, label, value, hint, color }: { to?: string; icon: typeof Hash; label: string; value: ReactNode; hint: ReactNode; color: string }) {
  const body = <>
    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/20 ring-4 ring-white/10"><Icon size={21} /></div>
    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium opacity-95" title={label}>{label}</div><div className="text-2xl font-bold leading-tight">{value}</div>
      <div className="truncate text-xs opacity-90" title={typeof hint === 'string' ? hint : undefined}>{hint}</div></div>
  </>;
  const cls = cn('flex h-full min-w-0 items-center gap-3 rounded-2xl px-3.5 py-3 text-white shadow-md shadow-slate-300/50 transition', color, to && 'hover:-translate-y-0.5 hover:brightness-110');
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Panel kartu putih dengan judul, ikon, tautan "Lihat semua", dan tombol tambahan di kanan. */
function Panel({ icon: Icon, title, to, action, children, className }: { icon: typeof Hash; title: ReactNode; to?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('rounded-2xl border-slate-200/80 p-4 shadow-sm shadow-slate-200/60', className)}>
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><Icon size={20} className="text-blue-600" /> {title}</h2>
        <div className="flex items-center gap-3">{action}{to && <Link to={to} className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-blue-700 hover:underline">Lihat Semua <ArrowRight size={14} /></Link>}</div></div>
      {children}
    </Card>
  );
}

const MODE_TONE = { Online: 'text-blue-700', Offline: 'text-slate-600', Hybrid: 'text-violet-700' } as const;

/** Baris agenda: jam | garis | judul, jenis rapat, aplikasi, PIC | tombol Join (hanya bila tautan valid).
 *  Judul memakai sisa lebar dan baris terbungkus bila kolom sempit, agar judul tidak pecah per kata. */
function AgendaItems({ list, today, now, me }: { list: Agenda[]; today: string; now: string; me?: string }) {
  return (
    <ul className="space-y-2">{list.map((a) => {
      const live = liveState(a, today, now); const past = a.agenda_date < today || (a.agenda_date === today && !!a.end_time && a.end_time <= now); // HH:MM sebanding sebagai teks
      const mode = meetingMode(a); const join = a.meeting_url ? joinButton(a.meeting_url) : null;
      const mine = a.pic?.id === me ? 'Anda PIC' : a.support.some((p) => p.id === me) ? 'Anda ikut' : null;
      return (
        <li key={a.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-slate-50 p-3', live === 'berlangsung' ? 'bg-green-50 ring-1 ring-green-300' : past && 'opacity-60')}>
          <div className="w-[6.5rem] shrink-0 text-[15px] font-bold leading-tight text-navy-900">{a.agenda_date !== today && <div className="text-[11px] font-semibold text-blue-700">{shortDate(a.agenda_date)}</div>}{timeText(a)}
            {live === 'berlangsung' ? <div className="text-[11px] font-semibold text-green-700">● Berlangsung</div> : <div className="text-[11px] font-normal text-slate-500">{startsInText(a, today, now) ?? ''}</div>}</div>
          <span className={cn('w-1 self-stretch rounded-full', live === 'berlangsung' ? 'bg-green-500' : mode === 'Hybrid' ? 'bg-violet-600' : 'bg-blue-600')} aria-hidden />
          <Link to={`/ppk/agenda/${a.id}`} className="min-w-[11rem] flex-1">
            <div className="text-[15px] font-semibold leading-snug text-navy-900 hover:underline">{a.title}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
              <span className={cn('inline-flex items-center gap-1 font-medium', MODE_TONE[mode])}>{mode === 'Offline' ? <MapPin size={12} /> : <Video size={12} />}{mode}</span>
              {join && <><span className="text-slate-300">|</span><span className="font-medium text-blue-700">{join.startsWith('Join ') ? join.slice(5) : 'Tautan rapat'}</span></>}
              {a.location && <><span className="text-slate-300">|</span><span className="truncate">{a.location}</span></>}
              {a.pic && <><span className="text-slate-300">|</span><span>PIC: {a.pic.name}</span></>}
              {mine && <Badge tone="navy">{mine}</Badge>}
            </div>
            {a.support.length > 0 && <div className="line-clamp-1 text-xs text-slate-500">Ikut: {a.support.map((x) => x.name).join(', ')}</div>}</Link>
          {join && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 max-md:w-full max-md:py-3 max-md:text-base"><Video size={15} /> {join}</a>}
        </li>);
    })}</ul>
  );
}

/** Agenda Hari Ini: panel tersendiri di kolom kanan (dan paling atas di HP). */
function TodayAgendaPanel({ list, focus, today, now, me }: { list: Agenda[]; focus: Agenda | null; today: string; now: string; me?: string }) {
  return (
    <Panel icon={CalendarDays} title="Agenda Hari Ini" action={<span className="hidden text-sm font-medium text-navy-900 sm:inline">{dayName(today)}, {formatDateID(today)}</span>}>
      {!list.length && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Tidak ada agenda hari ini.
        {focus && <> Berikutnya: <Link className="font-semibold text-blue-700 hover:underline" to={`/ppk/agenda/${focus.id}`}>{focus.title}</Link> · {shortDate(focus.agenda_date)} {timeText(focus)}.</>}</div>}
      <AgendaItems list={list} today={today} now={now} me={me} />
    </Panel>
  );
}

/** Kalender & Agenda Mendatang: kalender bulan ringkas di kiri, daftar mendatang (atau agenda tanggal yang diklik) di kanan. */
function KalenderMendatangPanel({ upcoming, today, canAdd }: { upcoming: Agenda[]; today: string; canAdd: boolean }) {
  const [sel, setSel] = useState<string | null>(null);
  const [cursor, setCursor] = useState(today);
  const days = calendarDays('bulan', cursor);
  const cal = useAsync(() => api.ppk.agendas.list({ from: days[0], to: days.at(-1)!, status: 'aktif' }), [days[0], days.at(-1)]);
  const month = (cal.data ?? []).filter((a) => !a.archived_at);
  const list = sel ? month.filter((a) => a.agenda_date === sel) : upcoming.filter((a) => a.status === 'terjadwal').slice(0, 4);
  return (
    <Panel icon={CalendarDays} title="Kalender & Agenda Mendatang" action={canAdd && <Link to="/ppk/agenda?baru=1" aria-label="Tambah Agenda" title="Tambah Agenda" className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"><Plus size={15} /><span className="max-sm:hidden">Tambah</span></Link>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-1">
            <button className="rounded p-1 text-slate-600 hover:bg-slate-100" aria-label="Bulan sebelumnya" onClick={() => setCursor(shiftCursor('bulan', cursor, -1))}><ChevronLeft size={18} /></button>
            <button className="rounded p-1 text-slate-600 hover:bg-slate-100" aria-label="Bulan berikutnya" onClick={() => setCursor(shiftCursor('bulan', cursor, 1))}><ChevronRight size={18} /></button>
            <span className="ml-1 text-sm font-bold text-navy-900">{formatDateID(`${cursor.slice(0, 8)}01`).replace(/^\d+\s/, '')}</span>
            {cursor.slice(0, 7) !== today.slice(0, 7) && <button className="ml-auto text-xs font-semibold text-blue-700 hover:underline" onClick={() => { setCursor(today); setSel(null); }}>Hari ini</button>}
          </div>
          <AgendaCalendar view="bulan" setView={() => undefined} cursor={cursor} setCursor={setCursor} today={today} agendas={month} selected={sel} onSelect={setSel} onOpen={() => undefined} compact hideHeader />
          {cal.error && <p className="mt-2 text-sm text-red-700">{cal.error}</p>}
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2"><b className="text-sm text-navy-900">{sel ? `${dayName(sel)}, ${formatDateID(sel)}` : 'Agenda Mendatang'}</b>
            {sel ? <button className="text-xs font-semibold text-blue-700 hover:underline" onClick={() => setSel(null)}>Tutup</button>
              : <Link to="/ppk/agenda" className="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-blue-700 hover:underline">Lihat Semua <ArrowRight size={13} /></Link>}</div>
          {!list.length && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{sel ? 'Tidak ada agenda pada tanggal ini.' : 'Tidak ada agenda dalam 7 hari ke depan.'}</p>}
          <ul className="divide-y divide-slate-100">{list.map((a) => {
            const mode = meetingMode(a);
            return (
              <li key={a.id}><Link to={`/ppk/agenda/${a.id}`} className="flex items-center gap-3 py-2 hover:bg-slate-50">
                <div className="w-12 shrink-0 rounded-lg bg-slate-100 py-1 text-center leading-tight text-navy-900"><div className="text-xs">{dayName(a.agenda_date).slice(0, 3)}</div><b className="text-sm">{Number(a.agenda_date.slice(8))}</b><div className="text-[10px]">{MONTH_LABEL[Number(a.agenda_date.slice(5, 7)) - 1]}</div></div>
                <div className="min-w-0 flex-1"><div className="line-clamp-2 text-sm font-semibold leading-snug text-navy-900">{a.title}</div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-slate-600"><span className="inline-flex items-center gap-1"><Clock size={12} />{timeText(a)}</span><span className={cn('inline-flex items-center gap-1 font-medium', MODE_TONE[mode])}>{mode === 'Offline' ? <MapPin size={12} /> : <Video size={12} />}{mode}</span></div></div>
                <ChevronRight size={16} className="shrink-0 text-blue-600" />
              </Link></li>);
          })}</ul>
        </div>
      </div>
    </Panel>
  );
}

const ACT_ICON: Record<ActivityKind, [typeof Hash, string]> = {
  dokumen: [FileText, 'bg-green-100 text-green-700'], unggah: [CloudUpload, 'bg-blue-100 text-blue-700'], tugas: [CheckCircle2, 'bg-violet-100 text-violet-700'],
  agenda: [CalendarDays, 'bg-indigo-100 text-indigo-700'], status: [RefreshCw, 'bg-amber-100 text-amber-700']
};

/** Aktivitas Terbaru: log audit PPK + naskah dinas terbaru, digabung dan diurutkan waktu. */
function ActivityPanel({ ppk, docs }: { ppk: boolean; docs: Array<{ id: string; title: string; category_name: string; created_at: string }> }) {
  const act = useAsync(() => (ppk ? api.ppk.activity() : Promise.resolve([])), [ppk]);
  const items = [...(act.data ?? []), ...docs.map((d) => ({ at: d.created_at, actor: '', kind: 'dokumen' as const, text: `${d.category_name || 'Naskah'} dibuat: ${d.title}` }))]
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  return (
    <Panel icon={Activity} title="Aktivitas Terbaru" to={ppk ? undefined : '/archive'}>
      {act.error && <p className="text-sm text-red-700">{act.error}</p>}
      {!items.length && !act.loading && <Empty>Belum ada aktivitas.</Empty>}
      <ul className="space-y-2">{items.map((x, i) => {
        const [Icon, tone] = ACT_ICON[x.kind];
        return (
          <li key={`${x.at}${i}`} className="flex gap-3">
            <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', tone)}><Icon size={16} /></span>
            <div className="min-w-0"><div className="truncate text-sm font-medium text-navy-900" title={x.text}>{x.text}</div>
              <div className="text-xs text-slate-500">{timeAgo(x.at)}{x.actor && ` · ${x.actor}`}</div></div>
          </li>);
      })}</ul>
    </Panel>
  );
}

const PROGRAM_ICON: Record<string, [typeof Hash, string]> = {
  satria: [Satellite, 'bg-green-600'], iphub: [Network, 'bg-blue-600'], iptransit: [Globe, 'bg-violet-600'], akses: [Wifi, 'bg-amber-500']
};

/** Monitoring Program: realisasi anggaran nyata per program dipantau (+ program lain), dan ringkasan kontrak/tagihan. */
function MonitoringPanel({ o, today }: { o: ReturnType<typeof usePpkOverview>; today: string }) {
  const lines = o.budget.data ?? [];
  const years = [...new Set(lines.map((l) => l.year))].sort((a, b) => b - a);
  const [chosen, setYear] = useState<number | null>(null);
  const year = chosen ?? dashboardYear(lines, Number(today.slice(0, 4)));
  const prog = programProgress(lines, year);
  const { rows, others } = monitoredPrograms(prog.programs);
  const unpaid = (o.bills.data ?? []).filter((b) => b.paid < b.total);
  const active = o.contracts.data ?? [];
  const ending = active.filter((c) => c.effective_end >= today && c.effective_end <= addDays(today, 30)).length;
  const bar = (p: { name: string; pct: number; pagu: number; billed: number }, color: string, icon?: [typeof Hash, string], sub?: string) => (
    <li key={p.name} className="flex items-center gap-3 py-2.5">
      {icon && <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white', icon[1])}>{(() => { const I = icon[0]; return <I size={18} />; })()}</span>}
      <div className="w-32 shrink-0 font-bold text-navy-900" title={sub}>{p.name}</div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-slate-600">Realisasi Anggaran: {p.pagu ? `${p.pct.toLocaleString('id-ID')}%` : 'belum ada pagu'}</div>
        <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200"><div className={cn('h-full rounded-full', color)} style={{ width: `${Math.min(100, p.pct)}%` }} /></div>
        <div className="mt-0.5 truncate text-[11px] text-slate-500" title={sub}>{p.pagu ? `${formatRupiah(p.billed)} dari pagu ${formatRupiah(p.pagu)}` : 'Belum ada baris anggaran yang cocok'}{sub && ` · ${sub}`}</div>
      </div>
      <b className="w-16 shrink-0 text-right text-navy-900">{p.pagu ? `${p.pct.toLocaleString('id-ID')}%` : '–'}</b>
      <Link to="/ppk/laporan" aria-label={`Rincian ${p.name}`} className="shrink-0 text-slate-400 hover:text-navy-900"><ChevronRight size={18} /></Link>
    </li>);
  const COLORS = ['bg-green-600', 'bg-blue-600', 'bg-violet-600', 'bg-amber-500'];
  return (
    <Panel icon={BarChart3} title="Monitoring Program" className="relative overflow-hidden"
      action={years.length > 1 ? <select aria-label="Tahun anggaran" value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-medium">
        {years.map((y) => <option key={y} value={y}>Tahun Anggaran {y}</option>)}</select> : <span className="rounded-lg border border-slate-200 px-2 py-1 text-sm font-medium text-slate-700">Tahun Anggaran {year}</span>}>
      <img src={networkAccent} alt="" aria-hidden loading="lazy" className="pointer-events-none absolute -right-6 top-2 w-64 select-none opacity-40" />
      <div className="relative mb-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {([['/ppk/laporan', Wallet, 'Total realisasi', o.budget.data ? `${prog.total.pct.toLocaleString('id-ID')}%` : '–', prog.total.pagu ? `${formatRupiah(prog.total.billed)} dari ${formatRupiah(prog.total.pagu)}` : `Belum ada pagu TA ${year}`],
          ['/ppk/kontrak', FileSignature, 'Kontrak aktif', o.contracts.data ? active.length : '–', ending ? `${ending} berakhir ≤ 30 hari` : 'Tidak ada yang segera berakhir'],
          ['/ppk/tagihan', Receipt, 'Tagihan belum dibayar', o.bills.data ? unpaid.length : '–', unpaid.length ? formatRupiah(unpaid.reduce((a, b) => a + (b.total - b.paid), 0)) : 'Semua sudah dibayar']] as const).map(([to, Icon, l, v, h]) => (
          <Link key={to} to={to} className="rounded-xl border border-slate-200 bg-white/90 p-2.5 hover:border-blue-300">
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Icon size={13} />{l}</div><div className="text-lg font-bold text-navy-900">{v}</div><div className="truncate text-[11px] text-slate-500" title={String(h)}>{h}</div></Link>))}
      </div>
      <ul className="relative divide-y divide-slate-100">
        {rows.map((r, i) => bar(r, COLORS[i], PROGRAM_ICON[r.key], r.sources.length > 1 || (r.sources[0] && r.sources[0] !== r.name) ? `dari ${r.sources.join(', ')}` : undefined))}
        {others.map((p) => bar(p, 'bg-cyan-600', [Layers, 'bg-slate-500']))}
      </ul>
      <p className="relative mt-1 text-xs text-slate-400">Capaian KPI dan SLA belum tersedia karena aplikasi belum menyimpan data KPI/SLA. Realisasi = tagihan tercatat terhadap pagu terakhir (catatan internal; resmi di SAKTI/SP2D).</p>
    </Panel>
  );
}

/** Data PPK untuk Dashboard: semua dari query yang sudah ada (agenda, kontrak, tagihan, anggaran, tugas). */
function usePpkOverview(enabled: boolean) {
  const home = useAsync(() => (enabled ? api.ppk.agendas.home() : Promise.resolve(null)), [enabled]);
  const contracts = useAsync(() => (enabled ? api.ppk.contracts.list({ status: 'aktif' }) : Promise.resolve(null)), [enabled]);
  const bills = useAsync(() => (enabled ? api.ppk.bills.list({ status: 'diverifikasi' }) : Promise.resolve(null)), [enabled]);
  const budget = useAsync(() => (enabled ? api.ppk.budget.list() : Promise.resolve(null)), [enabled]);
  const tasks = useAsync(() => (enabled ? api.ppk.tasks.list() : Promise.resolve(undefined)), [enabled]);
  return { home, contracts, bills, budget, tasks, error: home.error ?? contracts.error ?? bills.error ?? budget.error };
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { access } = usePpkAccess();
  const ppk = !!access?.perms.includes('read');
  const o = usePpkOverview(ppk);
  const stats = useAsync(() => api.stats(), []);
  const today = o.home.data?.today ?? jakartaToday();
  const now = useJakartaClock();

  const h = o.home.data;
  const { focus } = focusAgenda(h?.today_agendas ?? [], h?.upcoming ?? [], today, now);
  const todayList = (h?.today_agendas ?? []).filter((a) => a.status !== 'dibatalkan');
  const t = o.tasks.data ? taskStats(o.tasks.data, today) : null;
  const mine = o.tasks.data?.filter((x) => x.status === 'berjalan' && x.assignee_user_id === access?.user_id);
  const s = stats.data;

  return (
    <Page>
      {/* HP: agenda hari ini langsung di bawah sapaan, tombol Join besar selebar layar. */}
      {ppk && <div className="mb-5 md:hidden"><TodayAgendaPanel list={todayList} focus={focus} today={today} now={now} me={access?.user_id} /></div>}

      <PpkGate>
        {o.error && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800" role="alert">{o.error}</div>}
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={CheckCircle2} color="bg-gradient-to-br from-blue-600 to-blue-800" label="Tugas Saya" value={mine ? mine.length : '–'}
            hint={t ? (t.near ? `${t.near} mendekati deadline${t.late ? ` · ${t.late} terlambat` : ''}` : 'Perlu ditindaklanjuti') : 'Memuat…'} />
          {/* Semua angka dari agendaHome (query ppk_invitations); belum_pdf dan belum_teks tidak beririsan. */}
          <StatCard to="/ppk/kotak-masuk" icon={MessageCircle} color="bg-gradient-to-br from-violet-600 to-purple-800" label="Pesan WhatsApp" value={h ? h.inbox.belum_pdf + h.inbox.belum_teks + h.inbox.gagal : '–'}
            hint={h ? `${h.inbox.baru} baru · ${h.inbox.belum_pdf} PDF · ${h.inbox.belum_teks} teks${h.inbox.gagal ? ` · ${h.inbox.gagal} gagal` : ''}` : 'Memuat…'} />
          <StatCard to="/archive?status=draft" icon={FileText} color="bg-gradient-to-br from-orange-500 to-orange-700" label="Dokumen Proses" value={s ? s.activeDrafts + s.inReview : '–'}
            hint={s ? `${s.inReview} verifikasi · ${s.activeDrafts} draf` : 'Memuat…'} />
          <StatCard to="/ppk/kontrak" icon={Layers} color="bg-gradient-to-br from-teal-600 to-cyan-800" label="Kontrak Aktif" value={o.contracts.data ? o.contracts.data.length : '–'}
            hint={o.contracts.data?.length ? [...new Set(o.contracts.data.map((c) => c.program_code))].join(', ') : 'Belum ada kontrak aktif'} />
        </div>
      </PpkGate>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="min-w-0 space-y-5">
          {ppk && <Card className="rounded-2xl border-slate-200/80 p-4 shadow-sm shadow-slate-200/60"><TodoList today={today} tasks={o.tasks} title={<h2 className="flex items-center gap-2 text-lg font-bold text-navy-900"><ListTodo size={20} className="text-blue-600" /> To Do List</h2>} /></Card>}
          {ppk && <MonitoringPanel o={o} today={today} />}
          <Panel icon={FilePlus2} title="Dokumen Terbaru" to="/archive">
            {s?.recentDocuments.length ? <ul className="divide-y divide-slate-100">{s.recentDocuments.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <Link to={`/documents/${d.id}`} className="min-w-0 flex-1"><div className="truncate text-sm font-medium hover:underline">{d.title}</div><div className="text-xs text-slate-500">{d.category_name} · {formatDateTime(d.created_at)}</div></Link>
                <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
              </li>))}</ul> : <Empty>Belum ada dokumen. Mulai dari “Buat Surat”.</Empty>}
            {!!s?.favoriteTemplates.length && <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"><Star size={13} className="text-amber-500" /> Template favorit</div>
              <div className="flex flex-wrap gap-2">{s.favoriteTemplates.map((f) => <Button key={f.id} size="sm" variant="outline" onClick={() => navigate(`/generator?template=${f.id}`)}>{f.name}</Button>)}</div>
            </div>}
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          {ppk && <div className="max-md:hidden"><TodayAgendaPanel list={todayList} focus={focus} today={today} now={now} me={access?.user_id} /></div>}
          {ppk && h && <KalenderMendatangPanel upcoming={h.upcoming} today={today} canAdd={!!access?.perms.includes('write')} />}
          <Panel icon={Zap} title="Quick Access">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              {([['/generator?cat=ND', FileText, 'Buat Nota Dinas', 'bg-blue-50 text-blue-700'], ['/generator', Mail, 'Buat Surat', 'bg-violet-50 text-violet-700'],
                ['/ppk/rekonsiliasi', TrendingUp, 'Input SAKTI', 'bg-emerald-50 text-emerald-700'], ['/ppk/laporan', Gauge, 'Monitoring SLA', 'bg-orange-50 text-orange-700']] as const).map(([to, Icon, label, c]) => (
                <Link key={label} to={to} className={cn('flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm', c)}><Icon size={24} />{label}</Link>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {([['/bank-nomor', Hash, 'Tambahkan Nomor'], ['/ppk/tagihan', Receipt, 'Catat Tagihan'], ['/ppk/laporan', TrendingUp, 'Prognosis']] as const).map(([to, Icon, label]) => (
                <Link key={label} to={to} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 hover:bg-slate-200"><Icon size={14} />{label}</Link>))}
            </div>
          </Panel>
          <ActivityPanel ppk={ppk} docs={s?.recentDocuments ?? []} />
        </div>
      </div>
    </Page>
  );
}
