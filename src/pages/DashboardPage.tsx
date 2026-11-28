import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, ArrowRight, BarChart3, CalendarDays, CheckCircle2, ChevronRight, Clock, CloudUpload, FilePlus2, FileSignature, FileText, Gauge, Globe, Hash, Layers, ListTodo, Mail, MapPin, MessageCircle, Network, Receipt, RefreshCw, Satellite, Star, TrendingUp, Video, Wallet, Wifi, Zap } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { PpkGate } from '@/features/ppk/PpkGate';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { AgendaCalendar, shortDate, timeText } from '@/features/ppk/AgendaViews';
import { useActor } from '@/features/numbering/NumberingContext';
import { TodoList } from '@/features/ppk/TodoList';
import { PPK_ROLE_LABEL } from '@shared/ppk/access';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { cn, formatDateTime } from '@/lib/utils';
import { addDays, formatDateID, isoWeek, jakartaToday } from '@shared/date';
import { dashboardYear, monitoredPrograms, programProgress } from '@shared/dashboard';
import { calendarDays, dayName, focusAgenda, joinButton, liveState, meetingMode, startsInText, type Agenda, type AgendaHome } from '@shared/ppk/agenda';
import { taskStats } from '@shared/ppk/tasks';
import { timeAgo, type ActivityKind } from '@shared/ppk/activity';
import { formatRupiah } from '@shared/ppk/money';
import banner from '@/assets/branding/banner-satelit-indonesia.svg';
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
    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-white/20 ring-4 ring-white/10"><Icon size={26} /></div>
    <div className="min-w-0"><div className="truncate text-sm font-medium opacity-95">{label}</div><div className="text-3xl font-bold leading-tight">{value}</div><div className="truncate text-xs opacity-90">{hint}</div></div>
  </>;
  const cls = cn('flex items-center gap-4 rounded-2xl p-4 text-white shadow-md shadow-slate-300/50 transition', color, to && 'hover:-translate-y-0.5 hover:brightness-110');
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

/** Kalender bulan: titik pada tanggal yang punya agenda; klik tanggal = daftar agenda hari itu di bawahnya. */
function AgendaCalendarPanel({ today, upcoming }: { today: string; upcoming: Agenda[] }) {
  const [cursor, setCursor] = useState(today);
  const [sel, setSel] = useState<string | null>(null);
  const days = calendarDays('bulan', cursor);
  const cal = useAsync(() => api.ppk.agendas.list({ from: days[0], to: days.at(-1)!, status: 'aktif' }), [days[0], days.at(-1)]);
  const list = (cal.data ?? []).filter((a) => !a.archived_at);
  const shown = sel ? list.filter((a) => a.agenda_date === sel) : upcoming.filter((a) => a.status === 'terjadwal' && a.agenda_date > today).slice(0, 4);
  return (
    <Panel icon={CalendarDays} title="Kalender Agenda" to="/ppk/agenda">
      <AgendaCalendar view="bulan" setView={() => undefined} cursor={cursor} setCursor={setCursor} today={today} agendas={list} selected={sel} onSelect={setSel} onOpen={() => undefined} compact />
      {cal.error && <p className="mt-2 text-sm text-red-700">{cal.error}</p>}
      <div className="mt-3 border-t border-slate-100 pt-2">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{sel ? `${dayName(sel)}, ${formatDateID(sel)}` : 'Agenda mendatang'}</div>
        {!shown.length && <p className="text-sm text-slate-500">{sel ? 'Tidak ada agenda pada tanggal ini.' : 'Tidak ada agenda dalam 7 hari ke depan.'}</p>}
        <ul className="divide-y divide-slate-100">{shown.map((a) => (
          <li key={a.id}><Link to={`/ppk/agenda/${a.id}`} className="flex gap-3 py-1.5 text-sm hover:bg-slate-50">
            <span className="w-24 shrink-0 font-medium text-navy-900">{sel ? timeText(a) : shortDate(a.agenda_date)}</span><span className="min-w-0 flex-1 truncate">{!sel && a.start_time && `${a.start_time} · `}{a.title}</span></Link></li>))}</ul>
      </div>
    </Panel>
  );
}

/** Kotak Masuk WhatsApp dan tindakan tertunda. Semua angka dari agendaHome (query), tidak ada yang disimpan. */
function InboxActionsPanel({ h }: { h: AgendaHome }) {
  const tiles: Array<[string, number, string, string]> = [
    ['Pesan baru', h.inbox.baru, '/ppk/kotak-masuk?kategori=baru', 'bg-blue-50 text-blue-800'],
    ['PDF belum diproses', h.inbox.belum_pdf, '/ppk/kotak-masuk?kategori=belum', 'bg-amber-50 text-amber-800'],
    ['Teks belum diproses', h.inbox.belum_teks, '/ppk/kotak-masuk?kategori=belum', 'bg-amber-50 text-amber-800'],
    ['Diproses bulan ini', h.inbox.diproses_bulan_ini, '/ppk/kotak-masuk?kategori=sudah', 'bg-emerald-50 text-emerald-800']
  ];
  const todo: Array<[string, string, string]> = [
    ...h.awaiting_verification.map((i): [string, string, string] => [`/ppk/kotak-masuk/${i.id}`, 'Verifikasi undangan', i.sender_name || i.sender_phone || 'Unggah manual']),
    ...h.unassigned.map((a): [string, string, string] => [`/ppk/agenda/${a.id}`, 'Belum ada penanggung jawab', `${shortDate(a.agenda_date)} · ${a.title}`]),
    ...h.needs_report.map((a): [string, string, string] => [`/ppk/agenda/${a.id}`, 'Laporan rapat belum ada', `${shortDate(a.agenda_date)} · ${a.title}`])
  ];
  return (
    <Panel icon={MessageCircle} title="Kotak Masuk WhatsApp" to="/ppk/kotak-masuk">
      <div className="grid grid-cols-2 gap-2">{tiles.map(([l, n, to, c]) => (
        <Link key={l} to={to} className={cn('rounded-lg p-3 transition hover:brightness-95', c)}><div className="text-2xl font-bold leading-tight">{n}</div><div className="text-xs font-medium">{l}</div></Link>))}</div>
      {h.inbox.gagal > 0 && <Link to="/ppk/kotak-masuk?kategori=gagal" className="mt-2 block text-sm text-red-700 hover:underline">{h.inbox.gagal} pesan gagal diproses, minta pengirim mengirim ulang.</Link>}
      <div className="mt-3 border-t border-slate-100 pt-2">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Tindakan tertunda</div>
        {!todo.length && <p className="text-sm text-slate-500">Tidak ada tindakan tertunda.</p>}
        <ul className="divide-y divide-slate-100">{todo.map(([to, kind, what]) => (
          <li key={`${kind}${to}`}><Link to={to} className="flex gap-2 py-1.5 text-sm hover:bg-slate-50"><span className="w-44 shrink-0 font-medium text-amber-800">{kind}</span><span className="min-w-0 flex-1 truncate">{what}</span></Link></li>))}</ul>
      </div>
    </Panel>
  );
}

const MODE_TONE = { Online: 'text-blue-700', Offline: 'text-slate-600', Hybrid: 'text-violet-700' } as const;

/** Agenda hari ini: jam, kegiatan, lokasi, jenis rapat, dan tombol Join bila tautan rapat valid. */
function TodayAgendaPanel({ list, focus, today, now, me }: { list: Agenda[]; focus: Agenda | null; today: string; now: string; me?: string }) {
  return (
    <Panel icon={CalendarDays} title="Agenda Hari Ini" to="/ppk/agenda">
      {!list.length && <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Tidak ada agenda hari ini.
        {focus && <> Berikutnya: <Link className="font-semibold text-blue-700 hover:underline" to={`/ppk/agenda/${focus.id}`}>{focus.title}</Link> · {shortDate(focus.agenda_date)} {timeText(focus)}.</>}</div>}
      <ul className="relative space-y-1">{list.map((a) => {
        const live = liveState(a, today, now); const past = !!a.end_time && a.end_time <= now; // HH:MM sebanding sebagai teks
        const mode = meetingMode(a); const join = a.meeting_url ? joinButton(a.meeting_url) : null;
        const mine = a.pic?.id === me ? 'Anda PJ' : a.support.some((p) => p.id === me) ? 'Anda pendukung' : null;
        return (
          <li key={a.id} className={cn('flex items-center gap-3 rounded-xl p-2', live === 'berlangsung' ? 'bg-green-50 ring-1 ring-green-300' : past && 'opacity-60')}>
            <div className="w-[104px] shrink-0 text-sm font-bold leading-tight text-navy-900">{timeText(a)}
              {live === 'berlangsung' ? <div className="text-[11px] font-semibold text-green-700">● Berlangsung</div> : <div className="text-[11px] font-normal leading-tight text-slate-500">{startsInText(a, today, now) ?? ''}</div>}</div>
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', live === 'berlangsung' ? 'bg-green-500' : 'bg-blue-600')} aria-hidden />
            <Link to={`/ppk/agenda/${a.id}`} className="min-w-0 flex-1">
              <div className="line-clamp-2 text-sm font-semibold leading-snug text-navy-900 hover:underline" title={a.title}>{a.title}</div>
              <div className="flex flex-wrap items-center gap-x-2 text-xs">
                <span className={cn('inline-flex items-center gap-1 font-medium', MODE_TONE[mode])}>{mode === 'Offline' ? <MapPin size={12} /> : <Video size={12} />}{mode}</span>
                {a.location && <span className="truncate text-slate-600">{a.location}</span>}
                {mine && <Badge tone="navy">{mine}</Badge>}
              </div></Link>
            {join && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"><Video size={14} /> {join}</a>}
          </li>);
      })}</ul>
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
  const { actor, serverUser } = useActor();
  const userName = serverUser ?? actor?.name;
  const { access } = usePpkAccess();
  const ppk = !!access?.perms.includes('read');
  const o = usePpkOverview(ppk);
  const stats = useAsync(() => api.stats(), []);
  const today = o.home.data?.today ?? jakartaToday();
  const now = useJakartaClock();

  const h = o.home.data;
  const week = new Set([...(h?.today_agendas ?? []), ...(h?.upcoming ?? [])].filter((a) => a.status !== 'dibatalkan' && a.agenda_date <= addDays(today, 6)).map((a) => a.id)).size;
  const { focus } = focusAgenda(h?.today_agendas ?? [], h?.upcoming ?? [], today, now);
  const todayList = (h?.today_agendas ?? []).filter((a) => a.status !== 'dibatalkan');
  const t = o.tasks.data ? taskStats(o.tasks.data, today) : null;
  const s = stats.data;

  return (
    <Page>
      <section className="relative mb-5 overflow-hidden rounded-2xl bg-[#0b1d4a] text-white shadow-md">
        <img src={banner} alt="" aria-hidden decoding="async" className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-left" />
        <div className="relative flex flex-wrap items-center gap-4 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold drop-shadow">Selamat Datang{userName ? `, ${userName}` : ''} 👋</h1>
            <p className="text-sm text-blue-100">Dashboard PPK Management{access?.role ? ` · ${PPK_ROLE_LABEL[access.role]}` : ''}</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-2.5 text-navy-900 shadow-lg">
            <CalendarDays size={26} className="text-navy-700" />
            <div className="leading-tight"><b className="block">{dayName(today)}, {formatDateID(today)}</b><span className="text-xs text-slate-600">Minggu ke-{isoWeek(today)} | Tahun Anggaran {today.slice(0, 4)}</span></div>
          </div>
        </div>
      </section>

      <PpkGate>
        {o.error && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800" role="alert">{o.error}</div>}
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Layers} color="bg-gradient-to-br from-blue-600 to-blue-800" label="Total Tugas" value={t ? t.total : '–'}
            hint={t ? `${t.open} berjalan · +${t.newThisWeek} dalam 7 hari` : 'Memuat…'} />
          <StatCard icon={Clock} color="bg-gradient-to-br from-red-500 to-red-700" label="Tugas Mendekati Deadline" value={t ? t.near : '–'}
            hint={t ? `≤ 3 hari${t.late ? ` · ${t.late} terlambat` : ''}` : 'Memuat…'} />
          <StatCard icon={CheckCircle2} color="bg-gradient-to-br from-green-600 to-green-800" label="Tugas Selesai" value={t ? t.done : '–'}
            hint={t && t.total ? `${Math.round((t.done / t.total) * 100)}% dari total · 30 hari terakhir` : '30 hari terakhir'} />
          <StatCard to="/ppk/agenda" icon={CalendarDays} color="bg-gradient-to-br from-violet-600 to-purple-800" label="Agenda Minggu Ini" value={h ? week : '–'}
            hint={focus ? `${focus.title}${startsInText(focus, today, now) ? `, ${startsInText(focus, today, now)}` : ''}` : 'Tidak ada agenda berikutnya'} />
        </div>
      </PpkGate>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-5">
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

        <div className="space-y-5">
          {ppk && <TodayAgendaPanel list={todayList} focus={focus} today={today} now={now} me={access?.user_id} />}
          <ActivityPanel ppk={ppk} docs={s?.recentDocuments ?? []} />

          <Panel icon={Zap} title="Quick Access">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              {([['/generator?cat=ND', FileText, 'Buat Nota Dinas', 'bg-blue-50 text-blue-700'], ['/generator', Mail, 'Buat Surat', 'bg-violet-50 text-violet-700'],
                ['/ppk/rekonsiliasi', TrendingUp, 'Input SAKTI', 'bg-emerald-50 text-emerald-700'], ['/ppk/laporan', Gauge, 'Monitoring SLA', 'bg-orange-50 text-orange-700']] as const).map(([to, Icon, label, c]) => (
                <Link key={label} to={to} className={cn('flex flex-col items-center gap-2 rounded-xl p-4 text-center text-sm font-semibold transition hover:-translate-y-0.5 hover:shadow-sm', c)}><Icon size={26} />{label}</Link>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {([['/bank-nomor', Hash, 'Tambahkan Nomor'], ['/ppk/tagihan', Receipt, 'Catat Tagihan'], ['/ppk/laporan', TrendingUp, 'Prognosis']] as const).map(([to, Icon, label]) => (
                <Link key={label} to={to} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700 hover:bg-slate-200"><Icon size={14} />{label}</Link>))}
            </div>
          </Panel>

          {ppk && <AgendaCalendarPanel today={today} upcoming={h?.upcoming ?? []} />}
          {ppk && h && <InboxActionsPanel h={h} />}
        </div>
      </div>
    </Page>
  );
}
