import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ListChecks, Settings } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { useActor } from '@/features/numbering/NumberingContext';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { REGISTER_PATH } from '@shared/numbering';

export default function NumberingDashboardPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const s = useAsync(() => api.numbering.summary(year), [year]);
  const audit = useAsync(() => api.numbering.audit({}), []);
  const { isAdmin } = useActor();
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i);
  return (
    <Page>
      <PageHeader title="Ringkasan Register" subtitle="Empat register mandiri; nomor DDSS ditambahkan lebih dulu di Bank Nomor. Nomor resmi hanya dibuat oleh sistem."
        actions={<>
          <Select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Tahun">{years.map((y) => <option key={y} value={y}>Tahun {y}</option>)}</Select>
          <Link to="/bank-nomor"><Button size="sm">Tambahkan Nomor</Button></Link>
          <Link to="/penomoran/pengaturan"><Button variant="outline" size="sm"><Settings size={14} /> Pengaturan</Button></Link>
        </>} />
      {s.error && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{s.error}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        {(s.data ?? []).map((x) => (
          <Card key={x.register.id} className="p-4">
            <div className="flex items-center justify-between">
              <Link to={`/register/${REGISTER_PATH[x.register.code]}`} className="text-lg font-semibold text-navy-900 hover:underline">{x.register.name}</Link>
              {!x.register.is_active && <Badge tone="red">Nonaktif</Badge>}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              {([['Tersedia', x.available, 'navy'], ['Dipakai draf', x.assigned, 'amber'], ['Terbit', x.issued, 'green'], ['Void', x.void, 'red']] as const).map(([l, n, t]) => (
                <div key={l} className="rounded bg-slate-50 p-2"><div className="text-xl font-bold text-navy-900">{n}</div><Badge tone={t}>{l}</Badge></div>
              ))}
            </div>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Nomor tahun {year}</dt><dd className="font-medium">{x.year_total}</dd></div>
              <div className="flex justify-between gap-3"><dt className="shrink-0 text-slate-500">Terakhir</dt><dd className="truncate font-mono text-xs" title={x.year_last_number ?? ''}>{x.year_last_number ?? '—'}</dd></div>
              <div className="flex justify-between gap-3"><dt className="shrink-0 text-slate-500">Dapat dibuat berikutnya ({x.next_date})</dt><dd className="truncate font-mono text-xs" title={x.next_number ?? ''}>{x.next_full ? 'PENUH (01–99)' : x.next_number ?? '—'}</dd></div>
            </dl>
            {x.review > 0 && <div className="mt-2 flex items-center gap-1 text-xs text-amber-800"><AlertTriangle size={14} /> {x.review} nomor hasil migrasi menunggu tinjauan{isAdmin ? ' (Bank Nomor → Tinjauan migrasi)' : ' administrator'}.</div>}
            {x.needs_confirmation && <div className="mt-2 flex items-center gap-1 text-xs text-amber-800"><AlertTriangle size={14} /> Ada celah/konflik nomor hasil impor; periksa di Pengaturan Penomoran.</div>}
          </Card>
        ))}
      </div>
      <h2 className="mb-2 mt-6 flex items-center gap-2 text-sm font-semibold text-navy-900"><ListChecks size={16} /> Aktivitas terakhir</h2>
      <Card className="overflow-auto">
        <table className="w-full text-sm"><tbody>
          {(audit.data ?? []).slice(0, 12).map((a) => (
            <tr key={a.id} className="border-t border-slate-100 first:border-0"><td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">{a.at.slice(0, 16).replace('T', ' ')}</td><td className="px-3 py-1.5">{a.actor_name}</td><td className="px-3 py-1.5 font-mono text-xs">{a.action}</td></tr>
          ))}
        </tbody></table>
        {!audit.data?.length && <div className="p-4"><Empty>Belum ada aktivitas.</Empty></div>}
      </Card>
    </Page>
  );
}
