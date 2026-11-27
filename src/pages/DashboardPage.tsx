import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, BarChart3, CalendarDays, FilePlus2, FileSignature, Hash, ListTodo, MapPin, MessageCircle, Receipt, Star, TrendingUp, Video, Zap } from 'lucide-react';
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
import { addDays, formatDateID, jakartaToday } from '@shared/date';
import { dashboardYear, programProgress } from '@shared/dashboard';
import { calendarDays, dayName, focusAgenda, joinLabel, liveState, startsInText, type Agenda, type AgendaHome } from '@shared/ppk/agenda';
import { formatRupiah } from '@shared/ppk/money';

/** Jam WIB 'HH:MM', diperbarui tiap 30 detik. */
function useJakartaClock() {
  const read = () => new Date().toLocaleTimeString('sv-SE', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const [t, setT] = useState(read);
  useEffect(() => { const id = setInterval(() => setT(read()), 30000); return () => clearInterval(id); }, []);
  return t;
}


function Kpi({ to, icon: Icon, label, value, hint, color }: { to: string; icon: typeof Hash; label: string; value: ReactNode; hint: ReactNode; color: string }) {
  return (
    <Link to={to} className={cn('flex items-center gap-4 rounded-xl p-4 text-white shadow-sm transition hover:brightness-110', color)}>
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/20"><Icon size={24} /></div>
      <div className="min-w-0"><div className="text-sm opacity-90">{label}</div><div className="text-3xl font-bold leading-tight">{value}</div><div className="text-xs leading-snug opacity-90">{hint}</div></div>
    </Link>
  );
}

function Panel({ icon: Icon, title, to, children, className }: { icon: typeof Hash; title: string; to?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold text-navy-900"><Icon size={18} className="text-blue-600" /> {title}</h2>
        {to && <Link to={to} className="flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">Lihat semua <ArrowRight size={14} /></Link>}</div>
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

const BAR = ['bg-green-600', 'bg-blue-600', 'bg-violet-600', 'bg-amber-500', 'bg-cyan-600', 'bg-rose-600'];

/** Data PPK untuk Dashboard: semua dari query yang sudah ada (agenda, kontrak, tagihan, anggaran). */
function usePpkOverview(enabled: boolean) {
  const home = useAsync(() => (enabled ? api.ppk.agendas.home() : Promise.resolve(null)), [enabled]);
  const contracts = useAsync(() => (enabled ? api.ppk.contracts.list({ status: 'aktif' }) : Promise.resolve(null)), [enabled]);
  const bills = useAsync(() => (enabled ? api.ppk.bills.list({ status: 'diverifikasi' }) : Promise.resolve(null)), [enabled]);
  const budget = useAsync(() => (enabled ? api.ppk.budget.list() : Promise.resolve(null)), [enabled]);
  return { home, contracts, bills, budget, error: home.error ?? contracts.error ?? bills.error ?? budget.error };
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
  const unpaid = (o.bills.data ?? []).filter((b) => b.paid < b.total);
  const unpaidSum = unpaid.reduce((a, b) => a + (b.total - b.paid), 0);
  const active = o.contracts.data ?? [];
  const ending = active.filter((c) => c.effective_end >= today && c.effective_end <= addDays(today, 30)).length;
  const lines = o.budget.data ?? [];
  const year = dashboardYear(lines, Number(today.slice(0, 4)));
  const prog = programProgress(lines, year);
  const todayList = (h?.today_agendas ?? []).filter((a) => a.status !== 'dibatalkan');
  const s = stats.data;

  return (
    <Page>
      <div className="mb-5">
        <h1 className="text-2xl text-navy-900">Selamat datang{userName ? <>, <b>{userName}</b></> : ''}
          {access?.role && <span className="ml-2 align-middle text-sm font-medium text-slate-500">· {PPK_ROLE_LABEL[access.role]}</span>}</h1>
        <p className="text-sm text-slate-600">Ringkasan agenda, kontrak, tagihan, anggaran, dan naskah dinas.</p>
      </div>

      <PpkGate>
        {o.error && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800" role="alert">{o.error}</div>}
        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Kpi to="/ppk/agenda" icon={CalendarDays} color="bg-gradient-to-br from-violet-600 to-violet-700" label="Agenda 7 Hari ke Depan" value={h ? week : '–'}
            hint={focus ? `Berikutnya: ${focus.title}${startsInText(focus, today, now) ? `, ${startsInText(focus, today, now)}` : ''}` : 'Tidak ada agenda berikutnya'} />
          <Kpi to="/ppk/tagihan" icon={Receipt} color="bg-gradient-to-br from-rose-600 to-rose-700" label="Tagihan Belum Dibayar" value={o.bills.data ? unpaid.length : '–'}
            hint={unpaid.length ? `${formatRupiah(unpaidSum)} menunggu pembayaran` : 'Semua tagihan terverifikasi sudah dibayar'} />
          <Kpi to="/ppk/kontrak" icon={FileSignature} color="bg-gradient-to-br from-blue-600 to-blue-700" label="Kontrak Aktif" value={o.contracts.data ? active.length : '–'}
            hint={ending ? `${ending} berakhir dalam 30 hari` : 'Tidak ada yang berakhir dalam 30 hari'} />
          <Kpi to="/ppk/laporan" icon={TrendingUp} color="bg-gradient-to-br from-emerald-600 to-emerald-700" label="Realisasi Anggaran"
            value={o.budget.data ? `${prog.total.pct.toLocaleString('id-ID')}%` : '–'} hint={prog.total.pagu ? `${formatRupiah(prog.total.billed)} dari pagu ${formatRupiah(prog.total.pagu)} · TA ${year}` : `Belum ada pagu TA ${year}`} />
        </div>
      </PpkGate>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {ppk && <Panel icon={CalendarDays} title={`Agenda Hari Ini · ${dayName(today)}, ${formatDateID(today)}`} to="/ppk/agenda">
            {!todayList.length && <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Tidak ada agenda hari ini.
              {focus && <> Agenda berikutnya: <Link className="font-semibold text-blue-700 hover:underline" to={`/ppk/agenda/${focus.id}`}>{focus.title}</Link> · {shortDate(focus.agenda_date)} {timeText(focus)}.</>}</div>}
            <ul className="space-y-2">{todayList.map((a) => {
              const live = liveState(a, today, now); const past = !!a.end_time && a.end_time <= now; // HH:MM sebanding sebagai teks
              const mine = a.pic?.id === access?.user_id ? 'Anda PJ' : a.support.some((p) => p.id === access?.user_id) ? 'Anda pendukung' : null;
              return (
                <li key={a.id} className={cn('flex items-center gap-4 rounded-xl border p-3', live === 'berlangsung' ? 'border-green-300 bg-green-50' : past ? 'border-slate-200 opacity-70' : mine ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200')}>
                  <div className="w-28 shrink-0"><div className="text-base font-bold text-navy-900">{timeText(a)}</div>
                    {live === 'berlangsung' ? <span className="text-xs font-semibold text-green-700">● Sedang berlangsung</span> : <span className="text-xs text-slate-500">{startsInText(a, today, now) ?? ''}</span>}</div>
                  <Link to={`/ppk/agenda/${a.id}`} className="min-w-0 flex-1"><div className="font-semibold text-navy-900 hover:underline">{a.title}{mine && <Badge tone="navy" className="ml-2 align-middle">{mine}</Badge>}</div>
                    <div className="text-sm">{a.meeting_url ? <span className="text-blue-700"><Video size={13} className="mr-1 inline" />Online ({joinLabel(a.meeting_url).replace(/^Gabung /, '')})</span> : <span className="text-slate-600">{a.location && <MapPin size={13} className="mr-1 inline" />}{a.location || 'Lokasi belum diisi'}</span>}
                      <span className="text-slate-500"> · {a.pic ? `PJ: ${a.pic.name}` : 'Belum ada penanggung jawab'}</span></div></Link>
                  {a.meeting_url && <a href={a.meeting_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Video size={16} /> {joinLabel(a.meeting_url).replace(/^Gabung /, 'Join ')}</a>}
                </li>);
            })}</ul>
          </Panel>}

          {ppk && <Panel icon={BarChart3} title={`Monitoring Program · TA ${year}`} to="/ppk/laporan">
            {!prog.programs.length && <Empty>Belum ada baris anggaran TA {year}. Isi di Database → Anggaran atau Impor Excel.</Empty>}
            <ul className="divide-y divide-slate-100">{prog.programs.map((p, i) => (
              <li key={p.name} className="py-2.5">
                <div className="flex items-baseline justify-between gap-4"><b className="truncate text-sm text-navy-900" title={p.name}>{p.name}</b><b className="shrink-0 text-navy-900">{p.pct.toLocaleString('id-ID')}%</b></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200"><div className={cn('h-full rounded-full', BAR[i % BAR.length])} style={{ width: `${Math.min(100, p.pct)}%` }} /></div>
                <div className="mt-0.5 text-xs text-slate-500">Realisasi {formatRupiah(p.billed)} dari pagu {formatRupiah(p.pagu)}</div>
              </li>))}</ul>
            <p className="mt-2 text-xs text-slate-400">Realisasi = tagihan tercatat di aplikasi terhadap pagu terakhir (catatan internal; resmi di SAKTI/SP2D).</p>
          </Panel>}

          <Panel icon={FilePlus2} title="Dokumen Terbaru" to="/archive">
            {s?.recentDocuments.length ? <ul className="divide-y divide-slate-100">{s.recentDocuments.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-2">
                <Link to={`/documents/${d.id}`} className="min-w-0 flex-1"><div className="truncate text-sm font-medium hover:underline">{d.title}</div><div className="text-xs text-slate-500">{d.category_name} · {formatDateTime(d.created_at)}</div></Link>
                <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
              </li>))}</ul> : <Empty>Belum ada dokumen. Mulai dari “Buat Surat”.</Empty>}
            {!!s?.favoriteTemplates.length && <div className="mt-3 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500"><Star size={13} className="text-amber-500" /> Template favorit</div>
              <div className="flex flex-wrap gap-2">{s.favoriteTemplates.map((t) => <Button key={t.id} size="sm" variant="outline" onClick={() => navigate(`/generator?template=${t.id}`)}>{t.name}</Button>)}</div>
            </div>}
          </Panel>
        </div>

        <div className="space-y-5">
          {ppk && <AgendaCalendarPanel today={today} upcoming={h?.upcoming ?? []} />}

          {ppk && h && <InboxActionsPanel h={h} />}

          {ppk && <Panel icon={ListTodo} title="To Do List"><TodoList today={today} /></Panel>}

          <Panel icon={Zap} title="Akses Cepat">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
              {([['/generator', FilePlus2, 'Buat Surat', 'bg-blue-50 text-blue-800'], ['/bank-nomor', Hash, 'Tambahkan Nomor', 'bg-violet-50 text-violet-800'],
                ['/ppk/tagihan', Receipt, 'Catat Tagihan', 'bg-emerald-50 text-emerald-800'], ['/ppk/laporan', TrendingUp, 'Prognosis', 'bg-orange-50 text-orange-800']] as const).map(([to, Icon, label, c]) => (
                <Link key={to} to={to} className={cn('flex flex-col items-center gap-2 rounded-xl p-4 text-center text-sm font-semibold transition hover:brightness-95', c)}><Icon size={22} />{label}</Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </Page>
  );
}
