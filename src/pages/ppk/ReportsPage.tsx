import { useState } from 'react';
import { Download } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, Switch } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { cn } from '@/lib/utils';
import { PpkGate } from '@/features/ppk/PpkGate';
import { rp, useFiscalYears } from '@/features/ppk/inputs';
import { api } from '@/services/api';
import { MONTH_LABEL, type ReportTotal } from '@shared/ppk/forecast';

/** Bulan laporan awal: bulan lalu bila masih di tahun anggaran, selain itu Desember. */
const defaultCutoff = (year: number) => {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return d.getFullYear() === year ? `${year}-${String(d.getMonth() + 1).padStart(2, '0')}` : `${year}-12`;
};
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '—');
const need = (n: number) => <span className={n > 0 ? 'text-red-700' : 'text-emerald-700'}>{n > 0 ? `Kurang ${rp(n)}` : `Sisa ${rp(-n)}`}</span>;

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return <Card className="p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold tabular-nums text-navy-900">{value}</div>{hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}</Card>;
}

export default function ReportsPage() {
  const { toast } = useFeedback();
  const { years, id: fyId, setId: setFy } = useFiscalYears();
  const year = Number(years.find((y) => String(y.id) === fyId)?.year ?? 0);
  const [picked, setCutoff] = useState('');
  const cutoff = picked.startsWith(String(year)) ? picked : year ? defaultCutoff(year) : '';
  const [extend, setExtend] = useState(false);
  const rep = useAsync(() => (fyId && cutoff ? api.ppk.reports.get(fyId, cutoff, extend) : Promise.resolve(null)), [fyId, cutoff, extend]);
  const r = rep.data;
  const exportXlsx = async () => {
    try { const x = await api.ppk.reports.exportXlsx(fyId, cutoff, extend); if (!x.canceled) toast(`Tersimpan: ${x.path}`, 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const totalRow = (t: ReportTotal, label: string, strong = false) => (
    <tr key={label} className={cn('border-t border-slate-100', strong && 'border-t-2 border-slate-200 bg-slate-50 font-semibold')}>
      <td className="px-3 py-2">{label}</td>
      {[t.pagu, t.billed, t.paid, t.estimate, t.prognosis].map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{rp(v)}</td>)}
      <td className="px-3 py-2 text-right tabular-nums">{pct(t.billed, t.pagu)}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{need(t.kebutuhan)}</td>
    </tr>
  );

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Laporan & Prognosis" subtitle="Realisasi s.d. bulan laporan ditambah estimasi dari kontrak aktif. Realisasi adalah catatan internal dari tagihan; angka resmi tetap SAKTI/SP2D."
          actions={<Button variant="outline" onClick={exportXlsx} disabled={!r}><Download size={16} />Ekspor Excel</Button>} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Select className="w-40" value={fyId} onChange={(e) => setFy(e.target.value)} aria-label="Tahun anggaran">
            {years.map((y) => <option key={y.id} value={y.id}>TA {y.year}</option>)}
          </Select>
          <Select className="w-52" value={cutoff} onChange={(e) => setCutoff(e.target.value)} aria-label="Bulan laporan">
            {MONTH_LABEL.map((m, i) => { const v = `${year}-${String(i + 1).padStart(2, '0')}`; return <option key={v} value={v}>Aktual s.d. {m} {year}</option>; })}
          </Select>
          <Switch checked={extend} onChange={setExtend} label="Anggap kontrak yang selesai sebelum Desember diperpanjang" />
        </div>
        {rep.error && <Empty>{rep.error}</Empty>}
        {r && !r.lines.length && <Empty>Belum ada baris anggaran untuk tahun ini.</Empty>}
        {r && !!r.lines.length && <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Tile label="Pagu terakhir" value={rp(r.total.pagu)} />
            <Tile label="Realisasi (tagihan)" value={rp(r.total.billed)} hint={`Serapan ${pct(r.total.billed, r.total.pagu)}`} />
            <Tile label="Dibayar (SP2D/FO)" value={rp(r.total.paid)} hint={`${pct(r.total.paid, r.total.billed)} dari realisasi`} />
            <Tile label="Prognosis setahun" value={rp(r.total.prognosis)} hint={`Estimasi ${rp(r.total.estimate)}`} />
            <Tile label="Kebutuhan / sisa pagu" value={need(r.total.kebutuhan)} />
            <Tile label="Tagihan belum dibayar" value={rp(r.bills.unpaid_amount)} hint={`${r.bills.unpaid} terverifikasi · ${r.bills.draft} draf (${rp(r.bills.draft_amount)})`} />
          </div>

          <h2 className="mb-2 text-sm font-semibold text-slate-700">Konsolidasi per sumber dana</h2>
          <Card className="mb-6 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                <th className="px-3 py-2 text-left">Sumber dana</th><th className="px-3 py-2 text-right">Pagu</th><th className="px-3 py-2 text-right">Realisasi</th>
                <th className="px-3 py-2 text-right">Dibayar</th><th className="px-3 py-2 text-right">Estimasi</th><th className="px-3 py-2 text-right">Prognosis</th>
                <th className="px-3 py-2 text-right">Serapan</th><th className="px-3 py-2 text-right">Kebutuhan / sisa</th>
              </tr></thead>
              <tbody>{r.sources.map((t) => totalRow(t, t.source_code || 'Belum terbebankan'))}{totalRow(r.total, 'Total', true)}</tbody>
            </table>
          </Card>

          <h2 className="mb-2 text-sm font-semibold text-slate-700">Prognosis per baris anggaran <span className="font-normal text-slate-500">· angka miring = estimasi</span></h2>
          <Card className="mb-6 overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600"><tr>
                <th className="sticky left-0 bg-slate-50 px-3 py-2 text-left">Baris anggaran</th><th className="px-2 py-2 text-right">Pagu</th>
                {r.lines[0].months.map((m) => <th key={m.month} className={cn('px-2 py-2 text-right', m.month > r.cutoff && 'italic text-slate-400')}>{MONTH_LABEL[Number(m.month.slice(5)) - 1]}</th>)}
                <th className="px-2 py-2 text-right">Prognosis</th><th className="px-2 py-2 text-right">Kebutuhan / sisa</th>
              </tr></thead>
              <tbody>{r.lines.map((l) => (
                <tr key={l.id ?? 'none'} className="border-t border-slate-100">
                  <td className="sticky left-0 min-w-64 max-w-80 bg-white px-3 py-2">{l.label}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{rp(l.pagu)}</td>
                  {l.months.map((m) => <td key={m.month} className={cn('whitespace-nowrap px-2 py-2 text-right tabular-nums', m.month > r.cutoff && 'italic text-slate-500')}>{m.actual + m.estimate ? rp(m.actual + m.estimate) : ''}</td>)}
                  <td className="whitespace-nowrap px-2 py-2 text-right font-medium tabular-nums">{rp(l.prognosis)}</td>
                  <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{need(l.kebutuhan)}</td>
                </tr>))}
              </tbody>
            </table>
          </Card>

          {!!r.ending.length && <>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Kontrak aktif yang selesai s.d. 2 bulan ke depan</h2>
            <Card className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                  <th className="px-3 py-2 text-left">Nomor kontrak</th><th className="px-3 py-2 text-left">Penyedia</th><th className="px-3 py-2 text-left">Selesai</th><th className="px-3 py-2 text-right">Sisa kontrak</th>
                </tr></thead>
                <tbody>{r.ending.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{c.contract_number}</td><td className="px-3 py-2">{c.vendor_name}</td>
                    <td className="whitespace-nowrap px-3 py-2">{c.effective_end}</td><td className="px-3 py-2 text-right tabular-nums">{rp(c.sisa_kontrak)}</td>
                  </tr>))}
                </tbody>
              </table>
            </Card>
          </>}
        </>}
      </PpkGate>
    </Page>
  );
}
