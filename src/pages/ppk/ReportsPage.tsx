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
import { Num } from '@/features/ppk/Num';
import { api } from '@/services/api';
import { BUDGET_KIND_LABEL, type BudgetKind } from '@shared/ppk/budget';
import { daysUntil } from '@shared/ppk/contracts';
import { MONTH_LABEL, type PpkReport, type ReportLine, type ReportTotal } from '@shared/ppk/forecast';

/** Bulan laporan awal: bulan lalu bila masih di tahun anggaran, selain itu Desember. */
const defaultCutoff = (year: number) => {
  const d = new Date(); d.setMonth(d.getMonth() - 1);
  return d.getFullYear() === year ? `${year}-${String(d.getMonth() + 1).padStart(2, '0')}` : `${year}-12`;
};
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%` : '—');
const need = (n: number) => <span className={n > 0 ? 'text-red-700' : 'text-emerald-700'}>{n > 0 ? `Kurang ${rp(n)}` : `Sisa ${rp(-n)}`}</span>;

/** Warna tiap besaran, dipakai sama di kartu, judul kolom, dan tabel agar mudah dicocokkan. */
const TONE = {
  pagu: { card: 'border-l-indigo-500 bg-indigo-50/60', label: 'text-indigo-700', head: 'bg-indigo-50 text-indigo-800' },
  billed: { card: 'border-l-sky-500 bg-sky-50/60', label: 'text-sky-700', head: 'bg-sky-50 text-sky-800' },
  paid: { card: 'border-l-emerald-500 bg-emerald-50/60', label: 'text-emerald-700', head: 'bg-emerald-50 text-emerald-800' },
  estimate: { card: 'border-l-amber-500 bg-amber-50/60', label: 'text-amber-700', head: 'bg-amber-100 text-amber-900' },
  prognosis: { card: 'border-l-violet-500 bg-violet-50/60', label: 'text-violet-700', head: 'bg-violet-100 text-violet-900' },
  short: { card: 'border-l-red-500 bg-red-50/60', label: 'text-red-700', head: '' },
  spare: { card: 'border-l-emerald-500 bg-emerald-50/60', label: 'text-emerald-700', head: '' },
  unpaid: { card: 'border-l-orange-500 bg-orange-50/60', label: 'text-orange-700', head: '' }
} as const;
type Tone = keyof typeof TONE;
/** Warna sumber dana di tabel; sumber lain memakai abu-abu. */
const SOURCE_TONE: Record<string, string> = { RM: 'border-l-blue-500 bg-blue-50 text-blue-900', PNBP: 'border-l-teal-500 bg-teal-50 text-teal-900', BLU: 'border-l-fuchsia-500 bg-fuchsia-50 text-fuchsia-900' };
const sourceTone = (code: string) => SOURCE_TONE[code] ?? 'border-l-slate-400 bg-slate-100 text-slate-800';

/** Batang serapan: hijau ≤ 100%, merah bila melewati pagu. */
function Bar({ a, b }: { a: number; b: number }) {
  const p = b > 0 ? (a / b) * 100 : 0;
  return <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/80 ring-1 ring-slate-200"><div className={cn('h-full rounded-full', p > 100 ? 'bg-red-500' : 'bg-sky-500')} style={{ width: `${Math.min(p, 100)}%` }} /></div>;
}

function Tile({ label, value, hint, tone, children }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone: Tone; children?: React.ReactNode }) {
  return <Card className={cn('border-l-4 p-4', TONE[tone].card)}>
    <div className={cn('text-xs font-semibold uppercase tracking-wide', TONE[tone].label)}>{label}</div>
    <div className="mt-1 text-xl font-bold tabular-nums text-navy-900">{value}</div>
    {children}
    {hint && <div className="mt-1 text-xs text-slate-600">{hint}</div>}
  </Card>;
}

export default function ReportsPage() {
  const { toast } = useFeedback();
  const { years, id: fyId, setId: setFy } = useFiscalYears();
  const year = Number(years.find((y) => String(y.id) === fyId)?.year ?? 0);
  const [picked, setCutoff] = useState('');
  const cutoff = picked.startsWith(String(year)) ? picked : year ? defaultCutoff(year) : '';
  const [extend, setExtend] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  const rep = useAsync(() => (fyId && cutoff ? api.ppk.reports.get(fyId, cutoff, extend) : Promise.resolve(null)), [fyId, cutoff, extend]);
  const r = rep.data;
  const exportXlsx = async () => {
    try { const x = await api.ppk.reports.exportXlsx(fyId, cutoff, extend); if (!x.canceled) toast(`Tersimpan: ${x.path}`, 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const totalRow = (t: ReportTotal, label: string, strong = false) => (
    <tr key={label} className={cn('border-t border-slate-100 hover:bg-slate-50', strong && 'border-t-2 border-slate-300 bg-slate-100 font-bold hover:bg-slate-100')}>
      <td className="px-3 py-2">{strong ? label : <span className={cn('inline-block rounded border-l-4 px-2 py-0.5 text-xs font-semibold', sourceTone(t.source_code))}>{label}</span>}</td>
      {[t.pagu, t.billed, t.paid, t.estimate, t.prognosis].map((v, i) => <td key={i} className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', i === 4 && 'bg-violet-50 font-semibold text-violet-900')}><Num n={v} unit={1} /></td>)}
      <td className="w-32 px-3 py-2 text-right tabular-nums">{pct(t.billed, t.pagu)}<Bar a={t.billed} b={t.pagu} /></td><td className="whitespace-nowrap px-3 py-2 text-right tabular-nums"><Num n={t.kebutuhan} unit={1} signed /></td>
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
          <Switch checked={showPlan} onChange={setShowPlan} label="Tampilkan RPD" />
          <Switch checked={extend} onChange={setExtend} label="Anggap kontrak yang selesai sebelum Desember diperpanjang" />
        </div>
        {rep.error && <Empty>{rep.error}</Empty>}
        {r && !r.lines.length && <Empty>Belum ada baris anggaran untuk tahun ini.</Empty>}
        {r && !!r.lines.length && <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            <Tile tone="pagu" label="Pagu terakhir" value={rp(r.total.pagu)} hint={`${r.lines.length} baris anggaran · ${r.sources.length} sumber dana`} />
            <Tile tone="billed" label="Realisasi (tagihan)" value={rp(r.total.billed)} hint={`Serapan ${pct(r.total.billed, r.total.pagu)} dari pagu`}><Bar a={r.total.billed} b={r.total.pagu} /></Tile>
            <Tile tone="paid" label="Dibayar (SP2D/FO)" value={rp(r.total.paid)} hint={`${pct(r.total.paid, r.total.billed)} dari realisasi`} />
            <Tile tone="prognosis" label="Prognosis setahun" value={rp(r.total.prognosis)} hint={`Estimasi ${rp(r.total.estimate)}`} />
            <Tile tone={r.total.kebutuhan > 0 ? 'short' : 'spare'} label="Kebutuhan / sisa pagu" value={need(r.total.kebutuhan)} hint={r.total.kebutuhan > 0 ? 'Prognosis melebihi pagu' : 'Prognosis masih di bawah pagu'} />
            <Tile tone="unpaid" label="Tagihan belum dibayar" value={rp(r.bills.unpaid_amount)} hint={`${r.bills.unpaid} terverifikasi · ${r.bills.draft} draf (${rp(r.bills.draft_amount)})`} />
          </div>

          <h2 className="mb-2 text-sm font-semibold text-slate-700">Konsolidasi per sumber dana <span className="font-normal text-slate-400">(Rupiah; kebutuhan + kurang, − sisa)</span></h2>
          <Card className="mb-6 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-700"><tr>
                <th className="px-3 py-2 text-left">Sumber dana</th><th className={cn('px-3 py-2 text-right', TONE.pagu.head)}>Pagu</th><th className={cn('px-3 py-2 text-right', TONE.billed.head)}>Realisasi</th>
                <th className={cn('px-3 py-2 text-right', TONE.paid.head)}>Dibayar</th><th className={cn('px-3 py-2 text-right', TONE.estimate.head)}>Estimasi</th><th className={cn('px-3 py-2 text-right', TONE.prognosis.head)}>Prognosis</th>
                <th className="px-3 py-2 text-right">Serapan</th><th className="px-3 py-2 text-right">Kebutuhan</th>
              </tr></thead>
              <tbody>{r.sources.map((t) => totalRow(t, t.source_code || 'Belum terbebankan'))}{totalRow(r.total, 'Total', true)}</tbody>
            </table>
          </Card>

          <PrognosisTable r={r} showPlan={showPlan} />

          {!!r.ending.length && <>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Kontrak aktif yang selesai s.d. 2 bulan ke depan</h2>
            <Card className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-semibold text-slate-700"><tr>
                  <th className="px-3 py-2 text-left">Nomor kontrak</th><th className="px-3 py-2 text-left">Project</th><th className="px-3 py-2 text-left">Penyedia</th><th className="px-3 py-2 text-left">Selesai</th><th className="px-3 py-2 text-right">Sisa kontrak</th>
                </tr></thead>
                <tbody>{r.ending.map((c) => { const d = daysUntil(c.effective_end); return (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2">{c.contract_number}</td>
                    <td className="px-3 py-2">{c.project ? <span className="whitespace-nowrap rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-semibold text-indigo-800">{c.project}</span> : <span className="text-slate-400">—</span>}</td>
                    <td className="px-3 py-2">{c.vendor_name}</td>
                    <td className="whitespace-nowrap px-3 py-2">{c.effective_end}{' '}
                      <span className={cn('ml-1 rounded-full px-2 py-0.5 text-xs font-semibold', d < 0 ? 'bg-slate-200 text-slate-700' : d <= 30 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900')}>{d < 0 ? `lewat ${-d} hari` : `${d} hari lagi`}</span></td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', c.sisa_kontrak > 0 ? 'font-semibold text-navy-900' : 'text-slate-400')}>{rp(c.sisa_kontrak)}</td>
                  </tr>); })}
                </tbody>
              </table>
            </Card>
          </>}
        </>}
      </PpkGate>
    </Page>
  );
}

const SOURCE_ORDER = ['RM', 'PNBP', 'BLU'];

/** Jumlah beberapa baris: pagu, tiap bulan (aktual + estimasi), realisasi, estimasi, prognosis, kebutuhan. */
const sumLines = (ls: ReportLine[]) => ({
  pagu: ls.reduce((a, l) => a + l.pagu, 0), billed: ls.reduce((a, l) => a + l.billed, 0), estimate: ls.reduce((a, l) => a + l.estimate, 0),
  prognosis: ls.reduce((a, l) => a + l.prognosis, 0), kebutuhan: ls.reduce((a, l) => a + l.kebutuhan, 0),
  months: (ls[0]?.months ?? []).map((_, i) => ls.reduce((a, l) => a + l.months[i].actual + l.months[i].estimate, 0))
});

function PrognosisTable({ r, showPlan }: { r: PpkReport; showPlan: boolean }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const months = r.lines[0].months.map((m) => m.month);
  const nActual = months.filter((m) => m <= r.cutoff).length;
  const est = (m: string) => m > r.cutoff;
  const groups = [...new Set(r.lines.map((l) => l.source_code))]
    .sort((a, b) => (SOURCE_ORDER.indexOf(a) + 1 || 9) - (SOURCE_ORDER.indexOf(b) + 1 || 9) || a.localeCompare(b))
    .map((code) => ({ code, lines: r.lines.filter((l) => l.source_code === code) }));
  const toggle = (c: string) => setClosed((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  // Rupiah penuh: kolom selebar angka miliaran agar sejajar dan tidak berubah lebar antarbaris.
  const cell = 'min-w-[8.5rem] whitespace-nowrap px-3 py-2 text-right tabular-nums';
  const first = 'sticky left-0 z-10 w-72 min-w-72 max-w-72 border-r border-slate-200 px-3 py-1.5 text-left';
  const tail = (t: ReturnType<typeof sumLines>, strong = false) => <>
    <td className={cn(cell, 'border-l border-slate-200', strong && 'font-semibold')}><Num n={t.billed} unit={1} /></td>
    <td className={cn(cell, 'bg-amber-50/60', strong && 'font-semibold')}><Num n={t.estimate} unit={1} /></td>
    <td className={cn(cell, 'bg-violet-50 font-semibold text-violet-900')}><Num n={t.prognosis} unit={1} /></td>
    <td className={cn(cell, strong && 'font-semibold')}><Num n={t.kebutuhan} unit={1} signed /></td>
  </>;
  const total = sumLines(r.lines);

  return <>
    <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-sm font-semibold text-slate-700">Prognosis per baris anggaran</h2>
        <p className="text-xs text-slate-500">
          Kolom <span className="rounded bg-sky-100 px-1 text-sky-900">biru</span> = realisasi aktual s.d. {MONTH_LABEL[nActual - 1] ?? '—'}; kolom <span className="rounded bg-amber-100 px-1 text-amber-900">kuning</span> = estimasi; kolom <span className="rounded bg-violet-100 px-1 text-violet-900">ungu</span> = prognosis setahun.
          Kebutuhan: <span className="text-red-700">+ kurang pagu</span>, <span className="text-emerald-700">− sisa pagu</span>. Baris RPD: deviasi + = realisasi di atas rencana.
        </p>
      </div>
    </div>
    <Card className="mb-6 max-h-[70vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead className="sticky top-0 z-20 bg-slate-50 text-slate-600">
          <tr>
            <th rowSpan={2} className={cn(first, 'z-30 bg-slate-50 align-bottom')}>Baris anggaran <span className="font-normal text-slate-400">(Rupiah)</span></th>
            <th rowSpan={2} className="border-b border-slate-200 bg-indigo-50 px-2 py-1.5 text-right align-bottom text-indigo-800">Pagu</th>
            {nActual > 0 && <th colSpan={nActual} className="border-l border-sky-200 bg-sky-100 px-3 pt-1.5 text-left font-semibold text-sky-900">Realisasi aktual</th>}
            {nActual < 12 && <th colSpan={12 - nActual} className="border-l border-amber-200 bg-amber-100 px-3 pt-1.5 text-left font-semibold text-amber-900">Estimasi</th>}
            <th colSpan={4} className="border-l border-slate-200 bg-slate-100 px-3 pt-1.5 text-left font-semibold text-slate-800">Setahun</th>
          </tr>
          <tr>
            {months.map((m, i) => <th key={m} className={cn('border-b border-slate-200 px-2 py-1.5 text-right', i === nActual && 'border-l border-amber-200', i === 0 && 'border-l border-slate-200', est(m) ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900')}>{MONTH_LABEL[i]}</th>)}
            <th className="border-b border-l border-slate-200 bg-sky-50 px-2 py-1.5 text-right text-sky-900">Realisasi</th><th className="border-b border-slate-200 bg-amber-100 px-2 py-1.5 text-right text-amber-900">Estimasi</th>
            <th className="border-b border-slate-200 bg-violet-100 px-2 py-1.5 text-right text-violet-900">Prognosis</th><th className="border-b border-slate-200 px-2 py-1.5 text-right">Kebutuhan</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const t = sumLines(g.lines); const open = !closed.has(g.code);
            return <Fragment key={g.code}>
              <tr className={cn('cursor-pointer font-semibold hover:brightness-95', sourceTone(g.code))} onClick={() => toggle(g.code)}>
                <td className={cn(first, 'border-l-4 bg-inherit', sourceTone(g.code))}>
                  <button className="flex items-center gap-1" aria-expanded={open}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {g.code || 'Belum terbebankan'} <span className="font-normal opacity-70">· {g.lines.length} baris</span></button>
                </td>
                <td className={cell}><Num n={t.pagu} unit={1} /></td>
                {t.months.map((v, i) => <td key={i} className={cn(cell, est(months[i]) && 'bg-amber-100/60', i === 0 && 'border-l border-slate-200')}><Num n={v} unit={1} /></td>)}
                {tail(t, true)}
              </tr>
              {open && g.lines.map((l) => (<Fragment key={l.id ?? 'none'}>
                <tr className="group hover:bg-slate-50">
                  <td className={cn(first, 'border-b border-slate-100 bg-white group-hover:bg-slate-50')} title={l.label}>
                    <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-500">{l.mak || '—'}
                      {l.kind === 'saldo_kas' && <span className="rounded bg-sky-100 px-1 font-sans text-[10px] text-sky-800">{BUDGET_KIND_LABEL[l.kind as BudgetKind]}</span>}</div>
                    <div className="truncate text-slate-800">{l.detail || '—'}</div>
                  </td>
                  <td className={cn(cell, 'border-b border-slate-100')}><Num n={l.pagu} unit={1} /></td>
                  {l.months.map((m, i) => <td key={m.month} className={cn(cell, 'border-b border-slate-100', est(m.month) && 'bg-amber-50 text-amber-900', i === 0 && 'border-l border-slate-200')}><Num n={m.actual + m.estimate} unit={1} /></td>)}
                  {tail(sumLines([l]))}
                </tr>
                {showPlan && l.id && <tr className="text-[11px] text-slate-500">
                  <td className={cn(first, 'border-b border-slate-100 bg-slate-50 py-1 pl-6')}>{l.plan ? <>RPD · deviasi s.d. {MONTH_LABEL[nActual - 1] ?? '—'}: <Num n={l.actual_to_cutoff - l.plan_to_cutoff} unit={1} signed /></> : <span className="italic">RPD belum diisi</span>}</td>
                  <td className="border-b border-slate-100 bg-slate-50" />
                  {l.months.map((m, i) => <td key={m.month} className={cn(cell, 'border-b border-slate-100 bg-slate-50 py-1', i === 0 && 'border-l border-slate-200')}><Num n={m.plan} unit={1} /></td>)}
                  <td className={cn(cell, 'border-b border-l border-slate-100 border-l-slate-200 bg-slate-50 py-1')}><Num n={l.plan_to_cutoff} unit={1} /></td>
                  <td className="border-b border-slate-100 bg-slate-50" />
                  <td className={cn(cell, 'border-b border-slate-100 bg-slate-50 py-1')}><Num n={l.plan} unit={1} /></td>
                  <td className="border-b border-slate-100 bg-slate-50" />
                </tr>}
              </Fragment>))}
            </Fragment>;
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-slate-50 font-semibold">
          <tr>
            <td className={cn(first, 'border-t-2 bg-slate-50')}>Total</td>
            <td className={cn(cell, 'border-t-2 border-slate-200')}><Num n={total.pagu} unit={1} /></td>
            {total.months.map((v, i) => <td key={i} className={cn(cell, 'border-t-2 border-slate-200', est(months[i]) && 'bg-amber-100', i === 0 && 'border-l')}><Num n={v} unit={1} /></td>)}
            {tail(total, true)}
          </tr>
        </tfoot>
      </table>
    </Card>
  </>;
}
