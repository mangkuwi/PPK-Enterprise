import { Link, useNavigate } from 'react-router-dom';
import { CalendarDays, FileClock, FilePlus2, FileText, Files, Hash, Mail, Pencil, Send, Star } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import { REGISTER_PATH } from '@shared/numbering';
import { dayName } from '@shared/ppk/agenda';
import { formatDateID } from '@shared/date';

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

export default function DashboardPage() {
  const navigate = useNavigate();
  const stats = useAsync(() => api.stats(), []);
  const reg = useAsync(() => api.numbering.summary(new Date().getFullYear()), []);
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD waktu lokal
  // Agenda PPK selalu di atas; tanpa akses PPK kartu menampilkan alasannya.
  const agendas = useAsync(() => api.ppk.agendas.list({ from: today }), []);
  const s = stats.data;
  const totals = (reg.data ?? []).reduce((a, x) => ({ available: a.available + x.available - x.review, assigned: a.assigned + x.assigned, issued: a.issued + x.issued }), { available: 0, assigned: 0, issued: 0 });
  return (
    <Page>
      <PageHeader title="Dashboard" subtitle="Ringkasan aktivitas pembuatan naskah dinas. Semua angka dibaca dari data lokal aplikasi." />
      {(stats.error || reg.error) && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{stats.error ?? reg.error}</div>}

      <Card className="mb-6 border-navy-200 p-4">
        <div className="mb-3 flex items-center justify-between font-semibold text-navy-900">
          <span className="flex items-center gap-2"><CalendarDays size={18} /> Agenda mendatang</span>
          <Link to="/ppk/agenda" className="text-sm font-normal text-navy-600 hover:underline">Lihat semua agenda</Link>
        </div>
        {agendas.error ? <p className="text-sm text-slate-600">{agendas.error} Buka <Link to="/ppk/agenda" className="text-navy-600 hover:underline">Agenda PPK</Link>.</p>
          : agendas.data && !agendas.data.length ? <Empty>Belum ada agenda. Buka surat undangan lalu klik <b>Buat Agenda</b> di editor.</Empty>
          : <ul className="divide-y divide-slate-100 text-sm">{agendas.data?.slice(0, 5).map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="font-medium text-navy-900">{a.agenda_date === today && <Badge tone="amber">Hari ini</Badge>} {a.title}</div>
                <div className="text-slate-600">{[a.location, a.pic && `PJ: ${a.pic.name}`, a.support.length > 0 && `Pendukung: ${a.support.map((x) => x.name).join(', ')}`].filter(Boolean).join(' · ')}</div>
              </div>
              <span className="whitespace-nowrap text-slate-700">{dayName(a.agenda_date)}, {formatDateID(a.agenda_date)}{a.start_time && ` · ${a.start_time}${a.end_time ? `–${a.end_time}` : ''}`}</span>
            </li>))}</ul>}
      </Card>

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
