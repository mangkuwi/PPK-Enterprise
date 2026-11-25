import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
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
import { BUDGET_KIND_LABEL, type BudgetKind } from '@shared/ppk/budget';
import { MONTH_LABEL, type PpkReport, type ReportLine, type ReportTotal } from '@shared/ppk/forecast';

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
  const [unit, setUnit] = useState<number>(1e9);
  const rep = useAsync(() => (fyId && cutoff ? api.ppk.reports.get(fyId, cutoff, extend) : Promise.resolve(null)), [fyId, cutoff, extend]);
  const r = rep.data;
  const exportXlsx = async () => {
    try { const x = await api.ppk.reports.exportXlsx(fyId, cutoff, extend); if (!x.canceled) toast(`Tersimpan: ${x.path}`, 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const totalRow = (t: ReportTotal, label: string, strong = false) => (
    <tr key={label} className={cn('border-t border-slate-100', strong && 'border-t-2 border-slate-200 bg-slate-50 font-semibold')}>
      <td className="px-3 py-2">{label}</td>
      {[t.pagu, t.billed, t.paid, t.estimate, t.prognosis].map((v, i) => <td key={i} className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><Num n={v} unit={unit} /></td>)}
      <td className="px-3 py-2 text-right tabular-nums">{pct(t.billed, t.pagu)}</td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><Num n={t.kebutuhan} unit={unit} signed /></td>
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
          <Select className="w-36" value={unit} onChange={(e) => setUnit(Number(e.target.value))} aria-label="Satuan angka">
            {UNITS.map(([u, label]) => <option key={u} value={u}>{label}</option>)}
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

          <h2 className="mb-2 text-sm font-semibold text-slate-700">Konsolidasi per sumber dana <span className="font-normal text-slate-400">({UNITS.find(([u]) => u === unit)![1]}; kebutuhan + kurang, − sisa)</span></h2>
          <Card className="mb-6 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                <th className="px-3 py-2 text-left">Sumber dana</th><th className="px-3 py-2 text-right">Pagu</th><th className="px-3 py-2 text-right">Realisasi</th>
                <th className="px-3 py-2 text-right">Dibayar</th><th className="px-3 py-2 text-right">Estimasi</th><th className="px-3 py-2 text-right">Prognosis</th>
                <th className="px-3 py-2 text-right">Serapan</th><th className="px-3 py-2 text-right">Kebutuhan</th>
              </tr></thead>
              <tbody>{r.sources.map((t) => totalRow(t, t.source_code || 'Belum terbebankan'))}{totalRow(r.total, 'Total', true)}</tbody>
            </table>
          </Card>

          <PrognosisTable r={r} unit={unit} />

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

const UNITS = [[1e9, 'Miliar Rp'], [1e6, 'Juta Rp'], [1, 'Rupiah']] as const;
const SOURCE_ORDER = ['RM', 'PNBP', 'BLU'];
/** Angka ringkas sesuai satuan; nilai persis tampil saat kursor diarahkan. */
function Num({ n, unit, signed = false, className }: { n: number; unit: number; signed?: boolean; className?: string }) {
  if (!n) return <span className="text-slate-300">–</span>;
  const v = Math.abs(n) / unit;
  const t = v.toLocaleString('id-ID', { minimumFractionDigits: unit === 1e9 ? 2 : 0, maximumFractionDigits: unit === 1e9 ? 2 : unit === 1e6 ? 1 : 0 });
  const tiny = /^0(,0*)?$/.test(t); // nilai kecil jangan tampil 0
  return <span title={rp(n)} className={cn(signed && (n > 0 ? 'text-red-700' : 'text-emerald-700'), className)}>{signed ? (n > 0 ? '+' : '−') : n < 0 ? '−' : ''}{tiny ? `<${unit === 1e9 ? '0,01' : '0,1'}` : t}</span>;
}

/** Jumlah beberapa baris: pagu, tiap bulan (aktual + estimasi), realisasi, estimasi, prognosis, kebutuhan. */
const sumLines = (ls: ReportLine[]) => ({
  pagu: ls.reduce((a, l) => a + l.pagu, 0), billed: ls.reduce((a, l) => a + l.billed, 0), estimate: ls.reduce((a, l) => a + l.estimate, 0),
  prognosis: ls.reduce((a, l) => a + l.prognosis, 0), kebutuhan: ls.reduce((a, l) => a + l.kebutuhan, 0),
  months: (ls[0]?.months ?? []).map((_, i) => ls.reduce((a, l) => a + l.months[i].actual + l.months[i].estimate, 0))
});

function PrognosisTable({ r, unit }: { r: PpkReport; unit: number }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const months = r.lines[0].months.map((m) => m.month);
  const nActual = months.filter((m) => m <= r.cutoff).length;
  const est = (m: string) => m > r.cutoff;
  const groups = [...new Set(r.lines.map((l) => l.source_code))]
    .sort((a, b) => (SOURCE_ORDER.indexOf(a) + 1 || 9) - (SOURCE_ORDER.indexOf(b) + 1 || 9) || a.localeCompare(b))
    .map((code) => ({ code, lines: r.lines.filter((l) => l.source_code === code) }));
  const toggle = (c: string) => setClosed((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const cell = 'whitespace-nowrap px-2 py-1.5 text-right tabular-nums';
  const first = 'sticky left-0 z-10 w-72 min-w-72 max-w-72 border-r border-slate-200 px-3 py-1.5 text-left';
  const tail = (t: ReturnType<typeof sumLines>, strong = false) => <>
    <td className={cn(cell, 'border-l border-slate-200', strong && 'font-semibold')}><Num n={t.billed} unit={unit} /></td>
    <td className={cn(cell, 'bg-amber-50/60', strong && 'font-semibold')}><Num n={t.estimate} unit={unit} /></td>
    <td className={cn(cell, 'font-semibold')}><Num n={t.prognosis} unit={unit} /></td>
    <td className={cn(cell, strong && 'font-semibold')}><Num n={t.kebutuhan} unit={unit} signed /></td>
  </>;
  const total = sumLines(r.lines);

  return <>
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Prognosis per baris anggaran</h2>
        <p className="text-xs text-slate-500">
          Kolom putih = realisasi aktual s.d. {MONTH_LABEL[nActual - 1] ?? '—'}; kolom <span className="rounded bg-amber-100 px-1">kuning</span> = estimasi.
          Kebutuhan: <span className="text-red-700">+ kurang pagu</span>, <span className="text-emerald-700">− sisa pagu</span>. Arahkan kursor ke angka untuk nilai rupiah lengkap.
        </p>
      </div>
    </div>
    <Card className="mb-6 max-h-[70vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-20 bg-slate-50 text-slate-600">
          <tr>
            <th rowSpan={2} className={cn(first, 'z-30 bg-slate-50 align-bottom')}>Baris anggaran <span className="font-normal text-slate-400">({UNITS.find(([u]) => u === unit)![1]})</span></th>
            <th rowSpan={2} className="border-b border-slate-200 px-2 py-1.5 text-right align-bottom">Pagu</th>
            {nActual > 0 && <th colSpan={nActual} className="border-l border-slate-200 px-2 pt-1.5 text-center font-semibold text-slate-700">Realisasi aktual</th>}
            {nActual < 12 && <th colSpan={12 - nActual} className="border-l border-amber-200 bg-amber-100 px-2 pt-1.5 text-center font-semibold text-amber-900">Estimasi</th>}
            <th colSpan={4} className="border-l border-slate-200 px-2 pt-1.5 text-center font-semibold text-slate-700">Setahun</th>
          </tr>
          <tr>
            {months.map((m, i) => <th key={m} className={cn('border-b border-slate-200 px-2 py-1.5 text-right', i === nActual && 'border-l border-amber-200', i === 0 && 'border-l border-slate-200', est(m) && 'bg-amber-100 text-amber-900')}>{MONTH_LABEL[i]}</th>)}
            <th className="border-b border-l border-slate-200 px-2 py-1.5 text-right">Realisasi</th><th className="border-b border-slate-200 bg-amber-100 px-2 py-1.5 text-right text-amber-900">Estimasi</th>
            <th className="border-b border-slate-200 px-2 py-1.5 text-right">Prognosis</th><th className="border-b border-slate-200 px-2 py-1.5 text-right">Kebutuhan</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const t = sumLines(g.lines); const open = !closed.has(g.code);
            return <Fragment key={g.code}>
              <tr className="cursor-pointer bg-slate-100 font-semibold text-slate-800 hover:bg-slate-200" onClick={() => toggle(g.code)}>
                <td className={cn(first, 'bg-inherit')}>
                  <button className="flex items-center gap-1" aria-expanded={open}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {g.code || 'Belum terbebankan'} <span className="font-normal text-slate-500">· {g.lines.length} baris</span></button>
                </td>
                <td className={cell}><Num n={t.pagu} unit={unit} /></td>
                {t.months.map((v, i) => <td key={i} className={cn(cell, est(months[i]) && 'bg-amber-100/60', i === 0 && 'border-l border-slate-200')}><Num n={v} unit={unit} /></td>)}
                {tail(t, true)}
              </tr>
              {open && g.lines.map((l) => (
                <tr key={l.id ?? 'none'} className="group">
                  <td className={cn(first, 'border-b border-slate-100 bg-white group-hover:bg-slate-50')} title={l.label}>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">{l.mak || '—'}
                      {l.kind === 'saldo_kas' && <span className="rounded bg-sky-100 px-1 font-sans text-[10px] text-sky-800">{BUDGET_KIND_LABEL[l.kind as BudgetKind]}</span>}</div>
                    <div className="truncate text-slate-800">{l.detail || '—'}</div>
                  </td>
                  <td className={cn(cell, 'border-b border-slate-100')}><Num n={l.pagu} unit={unit} /></td>
                  {l.months.map((m, i) => <td key={m.month} className={cn(cell, 'border-b border-slate-100', est(m.month) && 'bg-amber-50 text-amber-900', i === 0 && 'border-l border-slate-200')}><Num n={m.actual + m.estimate} unit={unit} /></td>)}
                  {tail(sumLines([l]))}
                </tr>))}
            </Fragment>;
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-slate-50 font-semibold">
          <tr>
            <td className={cn(first, 'border-t-2 bg-slate-50')}>Total</td>
            <td className={cn(cell, 'border-t-2 border-slate-200')}><Num n={total.pagu} unit={unit} /></td>
            {total.months.map((v, i) => <td key={i} className={cn(cell, 'border-t-2 border-slate-200', est(months[i]) && 'bg-amber-100', i === 0 && 'border-l')}><Num n={v} unit={unit} /></td>)}
            {tail(total, true)}
          </tr>
        </tfoot>
      </table>
    </Card>
  </>;
}
