import { useMemo, useState, type ReactNode } from 'react';
import { Ban, CheckCircle2, Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { cn } from '@/lib/utils';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PpkGate } from '@/features/ppk/PpkGate';
import { ReasonDialog, RupiahInput, rp, useFiscalYears, useWarnings } from '@/features/ppk/inputs';
import { api } from '@/services/api';
import { RelatedDocs } from '@/features/ppk/RelatedDocs';
import { Num, UNITS } from '@/features/ppk/Num';
import { ExportButton, SlashWrap, TBL } from '@/features/ppk/table';
import { billMatrix } from '@shared/ppk/matrix';
import { MONTH_LABEL } from '@shared/ppk/forecast';
import { budgetLabel } from '@shared/ppk/budget';
import { proposeTax, type FakturCode } from '@shared/ppk/tax';
import {
  BILL_STATUS_LABEL, PAYMENT_CHANNELS, billStage, fundingOrder, splitByRemaining,
  type Bill, type BillFundingRow, type BillFundingView, type BillInput, type BillStatus, type PaymentChannel, type PaymentInput
} from '@shared/ppk/bills';

const today = () => new Date().toISOString().slice(0, 10);
const STAGE_TONE: Record<string, 'slate' | 'green' | 'amber' | 'red' | 'navy'> = { Draf: 'slate', Dibatalkan: 'red', Lunas: 'green', 'Dibayar sebagian': 'amber', 'Menunggu bayar': 'navy' };
const ok = (n: number) => Number.isSafeInteger(n);
const VIEW_LABEL = { daftar: 'Tagihan', pembayaran: 'Pembayaran', matriks: 'Matriks bulanan' } as const;
const unpaid = (b: Bill) => (b.status === 'dibatalkan' ? 0 : b.total - b.paid);

/** Semua pembayaran untuk tagihan yang sedang tampil (ikut filter status & pencarian tagihan). */
function PaymentList({ fiscalYearId, bills, onOpen }: { fiscalYearId: string; bills: Bill[]; onOpen: (id: string) => void }) {
  const list = useAsync(() => api.ppk.bills.payments(fiscalYearId), [fiscalYearId]);
  const ids = new Set(bills.map((b) => b.id));
  const rows = (list.data ?? []).filter((p) => ids.has(p.bill_id));
  const total = rows.filter((p) => !p.voided_at).reduce((a, p) => a + p.amount, 0);
  if (list.error) return <Empty>{list.error}</Empty>;
  if (list.data && !rows.length) return <Empty>Belum ada pembayaran tercatat untuk tagihan yang tampil.</Empty>;
  if (!list.data) return null;
  return <>
    <p className="mb-2 text-xs text-slate-500">{rows.length} pembayaran · angka dalam Rupiah penuh · klik baris untuk membuka tagihannya.</p>
    <Card className={TBL.card}>
      <table className={TBL.table}>
        <thead className={TBL.head}><tr>
          <th className={cn(TBL.th, TBL.first, 'z-30 bg-slate-50')}>Nomor SP2D / referensi</th><th className={TBL.th}>Tanggal</th><th className={TBL.th}>Saluran</th>
          <th className={cn(TBL.thNum, 'bg-sky-100 text-navy-900')}>Jumlah</th><th className={TBL.th}>Tagihan</th><th className={TBL.th}>Kontrak / penyedia</th>
          <th className={TBL.th}>Dibebankan ke</th><th className={TBL.th}>Status</th>
        </tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className={cn(TBL.row, 'cursor-pointer', p.voided_at && 'text-slate-400 line-through decoration-slate-300')} onClick={() => onOpen(p.bill_id)}>
            <td className={cn(TBL.td, TBL.first, 'font-medium text-navy-900')}>{p.reference_number || '—'}</td>
            <td className={cn(TBL.td, 'whitespace-nowrap')}>{p.payment_date}</td>
            <td className={TBL.td}>{p.channel}</td>
            <td className={cn(TBL.num, 'bg-sky-50/60 font-medium')}><Num n={p.amount} unit={1} /></td>
            <td className={cn(TBL.td, 'whitespace-nowrap')}>{p.bill_number}<div className="text-xs text-slate-500">bulan {p.service_month}</div></td>
            <td className={cn(TBL.td, 'min-w-48')}>{p.contract_number}<div className="text-xs text-slate-500">{p.vendor_name}</div></td>
            <td className={cn(TBL.td, 'whitespace-nowrap')}><span className="font-mono text-xs">{p.mak}</span> · {p.source_code}<div className="max-w-56 truncate text-xs text-slate-500" title={p.output_detail}>{p.output_detail}</div></td>
            <td className={TBL.td}>{p.voided_at ? <Badge tone="red" className="no-underline">Dibatalkan</Badge> : <Badge tone="green">Sah</Badge>}</td>
          </tr>))}
        </tbody>
        <tfoot><tr>
          <td className={cn(TBL.foot, TBL.first, 'z-30 bg-slate-100')}>Total pembayaran sah</td><td className={TBL.foot} colSpan={2} />
          <td className={cn(TBL.foot, 'whitespace-nowrap text-right tabular-nums')}><Num n={total} unit={1} /></td>
          <td className={TBL.foot} colSpan={4} />
        </tr></tfoot>
      </table>
    </Card>
  </>;
}

export default function BillsPage() {
  const { can } = usePpkAccess();
  const { years, id: fyId, setId: setFy } = useFiscalYears();
  const [status, setStatus] = useState<BillStatus | 'semua'>('semua');
  const [search, setSearch] = useState(''); const q = useDebounced(search);
  const list = useAsync(() => (fyId ? api.ppk.bills.list({ fiscal_year_id: fyId, status, search: q }) : Promise.resolve([])), [fyId, status, q]);
  const [form, setForm] = useState<Bill | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<'daftar' | 'pembayaran' | 'matriks'>('daftar');
  const rows = list.data ?? [];
  const live = rows.filter((b) => b.status !== 'dibatalkan');
  const sum = (k: 'total' | 'net' | 'paid') => live.reduce((a, b) => a + b[k], 0);

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Tagihan & Pembayaran" subtitle="Tagihan per bulan layanan, pajak sesuai faktur, pembagian sumber dana, dan SP2D/FO."
          actions={<>
            <ExportButton run={() => api.ppk.bills.exportXlsx({ fiscal_year_id: fyId, status, search: q })} disabled={!rows.length} />
            {can('write') && <Button onClick={() => setForm('new')} disabled={!fyId}><Plus size={16} />Tambah Tagihan</Button>}
          </>} />
        <div className="mb-4 flex flex-wrap gap-3">
          <Select className="w-40" value={fyId} onChange={(e) => setFy(e.target.value)} aria-label="Tahun anggaran">
            {years.map((y) => <option key={y.id} value={y.id}>TA {y.year}</option>)}
          </Select>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as BillStatus | 'semua')} aria-label="Filter status">
            <option value="semua">Semua status</option>
            {Object.entries(BILL_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input className="max-w-sm" placeholder="Cari nomor tagihan, kontrak, atau penyedia" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari tagihan" />
          <div className="ml-auto flex rounded-md border border-slate-300 bg-white p-0.5 text-sm" role="tablist" aria-label="Tampilan">
            {(['daftar', 'pembayaran', 'matriks'] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
              className={cn('rounded px-3 py-1', view === v ? 'bg-navy-800 text-white' : 'text-slate-600 hover:bg-slate-100')}>{VIEW_LABEL[v]}</button>)}
          </div>
        </div>
        {view === 'matriks' && fyId && <BillMatrix fiscalYearId={fyId} year={Number(years.find((y) => String(y.id) === fyId)?.year)} bills={rows} onOpen={setOpen} />}
        {list.error && <Empty>{list.error}</Empty>}
        {view === 'daftar' && list.data && !rows.length && <Empty>Belum ada tagihan{search ? ' yang cocok' : ''} untuk tahun ini.</Empty>}
        {view === 'daftar' && !!rows.length && (<>
          <p className="mb-2 text-xs text-slate-500">{rows.length} tagihan · angka dalam Rupiah penuh · klik baris untuk detail dan pembayaran.</p>
          <Card className={TBL.card}>
            <table className={TBL.table}>
              <thead className={TBL.head}><tr>
                <th className={cn(TBL.th, TBL.first, 'z-30 bg-slate-50')}>Nomor tagihan</th><th className={TBL.th}>Bulan</th><th className={TBL.th}>Kontrak / penyedia</th>
                <th className={TBL.thNum}>Nilai tagihan</th><th className={TBL.thNum}>PPN + PPh 23</th><th className={TBL.thNum}>Bersih</th>
                <th className={TBL.thNum}>Terbayar</th><th className={cn(TBL.thNum, 'bg-sky-100 text-navy-900')}>Belum dibayar</th><th className={TBL.th}>Status</th>
              </tr></thead>
              <tbody>{rows.map((b) => (
                <tr key={b.id} className={cn(TBL.row, 'cursor-pointer', b.status === 'dibatalkan' && 'text-slate-400')} onClick={() => setOpen(b.id)}>
                  <td className={cn(TBL.td, TBL.first, 'font-medium text-navy-900')}><button className="text-left hover:underline" onClick={() => setOpen(b.id)}><SlashWrap text={b.bill_number} /></button></td>
                  <td className={cn(TBL.td, 'whitespace-nowrap')}>{b.service_month}</td>
                  <td className={cn(TBL.td, 'min-w-48')}><div>{b.contract_number}</div><div className="text-xs text-slate-500">{b.vendor_name}</div></td>
                  <td className={TBL.num}><Num n={b.total} unit={1} /></td>
                  <td className={TBL.num}><Num n={b.ppn + b.pph23} unit={1} />{b.faktur_code && <div className="text-xs text-slate-500">FP {b.faktur_code}</div>}</td>
                  <td className={TBL.num}><Num n={b.net} unit={1} /></td>
                  <td className={TBL.num}><Num n={b.paid} unit={1} /></td>
                  <td className={cn(TBL.num, 'bg-sky-50/60 font-medium')}><Num n={unpaid(b)} unit={1} /></td>
                  <td className={TBL.td}><Badge tone={STAGE_TONE[billStage(b)]}>{billStage(b)}</Badge></td>
                </tr>))}
              </tbody>
              <tfoot><tr>
                <td className={cn(TBL.foot, TBL.first, 'z-30 bg-slate-100')}>Total {live.length} tagihan tidak dibatalkan</td><td className={TBL.foot} colSpan={2} />
                <td className={cn(TBL.foot, 'whitespace-nowrap text-right tabular-nums')}><Num n={sum('total')} unit={1} /></td>
                <td className={cn(TBL.foot, 'whitespace-nowrap text-right tabular-nums')}><Num n={live.reduce((a, b) => a + b.ppn + b.pph23, 0)} unit={1} /></td>
                <td className={cn(TBL.foot, 'whitespace-nowrap text-right tabular-nums')}><Num n={sum('net')} unit={1} /></td>
                <td className={cn(TBL.foot, 'whitespace-nowrap text-right tabular-nums')}><Num n={sum('paid')} unit={1} /></td>
                <td className={cn(TBL.foot, 'whitespace-nowrap text-right tabular-nums')}><Num n={live.reduce((a, b) => a + unpaid(b), 0)} unit={1} /></td>
                <td className={TBL.foot} />
              </tr></tfoot>
            </table>
          </Card>
        </>)}
        {view === 'pembayaran' && fyId && <PaymentList fiscalYearId={fyId} bills={rows} onOpen={setOpen} />}
        <p className="mt-3 text-xs text-slate-500">Realisasi di sini adalah catatan internal PPK. Angka resmi tetap mengikuti SAKTI/SP2D dan aplikasi FO.</p>
        {form && <BillForm fiscalYearId={fyId} bill={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={(b) => { setForm(null); list.reload(); setOpen(b.id); }} />}
        {open && !form && <BillDetailDialog id={open} canWrite={can('write')} onClose={() => setOpen(null)} onEdit={setForm} onChanged={list.reload} />}
      </PpkGate>
    </Page>
  );
}

function BillForm({ fiscalYearId, bill, onClose, onSaved }: { fiscalYearId: string; bill: Bill | null; onClose: () => void; onSaved: (b: Bill) => void }) {
  const { toast } = useFeedback(); const warn = useWarnings();
  const contracts = useAsync(() => api.ppk.contracts.list({ fiscal_year_id: fiscalYearId }), [fiscalYearId]);
  const lines = useAsync(() => api.ppk.budget.list({ fiscal_year_id: fiscalYearId }), [fiscalYearId]);
  const rates = useAsync(() => api.ppk.taxRates(), []);
  const officials = useAsync(() => api.ppk.masterList('officials'), []);
  const own = useAsync(() => (bill ? api.ppk.bills.get(bill.id) : Promise.resolve(null)), [bill?.id]);
  const [v, setV] = useState<BillInput>(() => bill ? {
    contract_id: bill.contract_id, bill_number: bill.bill_number, bill_date: bill.bill_date, received_date: bill.received_date, service_month: bill.service_month,
    period_start: bill.period_start, period_end: bill.period_end, amount: bill.amount, pass_through: bill.pass_through, faktur_code: bill.faktur_code, faktur_number: bill.faktur_number,
    ppn: bill.ppn, pph23: bill.pph23, deduction: bill.deduction, deduction_reason: bill.deduction_reason, fx_rate: bill.fx_rate, fx_amount: bill.fx_amount,
    ba_number: bill.ba_number, ba_date: bill.ba_date, official_id: bill.official_id, notes: bill.notes, funding: []
  } : {
    contract_id: '', bill_number: '', bill_date: today(), received_date: null, service_month: today().slice(0, 7), period_start: null, period_end: null,
    amount: NaN, pass_through: 0, faktur_code: '02', faktur_number: '', ppn: null, pph23: null, deduction: 0, deduction_reason: '',
    fx_rate: '', fx_amount: '', ba_number: '', ba_date: null, official_id: null, notes: '', funding: []
  });
  const [funding, setFunding] = useState<BillFundingRow[] | null>(null);
  const rows = funding ?? own.data?.funding.map(({ budget_line_id, amount }) => ({ budget_line_id, amount })) ?? [];
  const [manualTax, setManualTax] = useState(!!bill);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof BillInput>(k: K, val: BillInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const d = (k: 'bill_date' | 'received_date' | 'period_start' | 'period_end' | 'ba_date') => ({ value: v[k] ?? '', onChange: (e: { target: { value: string } }) => set(k, (e.target.value || null) as never) });

  const contract = contracts.data?.find((c) => c.id === v.contract_id);
  const total = (ok(v.amount) ? v.amount : 0) + (ok(v.pass_through) ? v.pass_through : 0);
  const rate = rates.data?.find((r) => r.valid_from <= v.bill_date) ?? null;
  const proposal = ok(v.amount) && rate ? proposeTax({ gross: v.amount, faktur: v.faktur_code }, rate) : null;
  const ppn = manualTax ? v.ppn : proposal?.ppn ?? null; const pph23 = manualTax ? v.pph23 : proposal?.pph23 ?? null;
  const net = total - (ppn ?? 0) - (pph23 ?? 0) - (ok(v.deduction) ? v.deduction : 0);
  const sumFunding = rows.reduce((a, r) => a + (ok(r.amount) ? r.amount : 0), 0);
  const ownAmount = useMemo(() => new Map(own.data?.funding.map((f) => [f.budget_line_id, f.amount]) ?? []), [own.data]);
  /** Sisa pagu realisasi tiap baris, tidak menghitung tagihan ini sendiri. */
  const remaining = (id: string) => { const l = lines.data?.find((x) => x.id === id); return l ? l.sisa_realisasi + (ownAmount.get(id) ?? 0) : 0; };
  const autoSplit = async () => {
    if (!contract) return;
    const alloc = (await api.ppk.contracts.get(contract.id)).allocations;
    const pool = (alloc.length ? alloc.map((a) => lines.data?.find((l) => l.id === a.budget_line_id)).filter((l) => !!l) : lines.data ?? []);
    setFunding(splitByRemaining(total, [...pool].sort(fundingOrder).map((l) => ({ id: l.id, remaining: remaining(l.id) }))));
  };
  const ready = v.contract_id && v.bill_number.trim() && v.bill_date && /^\d{4}-\d{2}$/.test(v.service_month) && ok(v.amount) && ok(v.pass_through) && total > 0
    && ok(v.deduction) && (!v.deduction || v.deduction_reason.trim()) && rows.length && sumFunding === total && rows.every((r) => r.budget_line_id && ok(r.amount) && r.amount > 0)
    && (!manualTax || (v.ppn != null && v.pph23 != null));
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.ppk.bills.save(bill?.id ?? null, bill?.version ?? null, { ...v, ppn: manualTax ? v.ppn : null, pph23: manualTax ? v.pph23 : null, funding: rows });
      warn(bill ? 'Tagihan diperbarui.' : 'Tagihan disimpan sebagai draf.', r.warnings); onSaved(r.data);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const used = new Set(rows.map((r) => r.budget_line_id));

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title={bill ? `Ubah Tagihan — ${bill.bill_number}` : 'Tambah Tagihan'} description="Tagihan tersimpan sebagai draf. Setelah diverifikasi, isinya terkunci."
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={busy || !ready} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></>}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Kontrak" required className="md:col-span-2">
            <Select value={v.contract_id} onChange={(e) => { set('contract_id', e.target.value); setFunding([]); }} disabled={!!bill}>
              <option value="">— Pilih kontrak aktif —</option>
              {contracts.data?.filter((c) => c.status === 'aktif' || c.status === 'selesai' || c.id === v.contract_id).map((c) =>
                <option key={c.id} value={c.id}>{c.contract_number} · {c.vendor_name}</option>)}
            </Select>
          </Field>
          <Field label="Sisa kontrak">{contract ? <div className="py-2 text-right tabular-nums">{rp(contract.sisa_kontrak + (bill ? bill.total : 0))}</div> : <div className="py-2 text-slate-400">—</div>}</Field>
          <Field label="Nomor tagihan" required><Input value={v.bill_number} onChange={(e) => set('bill_number', e.target.value)} /></Field>
          <Field label="Tanggal tagihan" required><Input type="date" {...d('bill_date')} /></Field>
          <Field label="Tanggal diterima"><Input type="date" {...d('received_date')} /></Field>
          <Field label="Bulan layanan" required><Input type="month" value={v.service_month} onChange={(e) => set('service_month', e.target.value)} /></Field>
          <Field label="Awal periode layanan"><Input type="date" {...d('period_start')} /></Field>
          <Field label="Akhir periode layanan"><Input type="date" {...d('period_end')} /></Field>
          <Field label="Nilai kena pajak (termasuk PPN)" required><RupiahInput value={ok(v.amount) ? v.amount : null} onChange={(n) => set('amount', n ?? NaN)} /></Field>
          <Field label="Pass-through (tanpa pajak)"><RupiahInput value={v.pass_through} onChange={(n) => set('pass_through', n ?? NaN)} /></Field>
          <Field label="Nilai tagihan"><div className="py-2 text-right font-semibold tabular-nums">{rp(total)}</div></Field>
          <Field label="Kode faktur">
            <Select value={v.faktur_code ?? ''} onChange={(e) => set('faktur_code', (e.target.value || null) as FakturCode | null)}>
              <option value="02">02 — PPN + PPh 23 dipungut</option><option value="04">04 — hanya PPh 23</option><option value="">Tanpa faktur (tanpa pajak)</option>
            </Select>
          </Field>
          <Field label="Nomor faktur"><Input value={v.faktur_number} onChange={(e) => set('faktur_number', e.target.value)} /></Field>
          <div className="flex items-end pb-2"><Switch checked={manualTax} onChange={(b) => { setManualTax(b); if (b) setV((x) => ({ ...x, ppn: proposal?.ppn ?? 0, pph23: proposal?.pph23 ?? 0 })); }} label="Angka pajak faktur berbeda" /></div>
          <Field label="PPN" hint={proposal ? `Usulan ${rp(proposal.ppn)} · DPP ${rp(proposal.dpp)}` : undefined}>
            {manualTax ? <RupiahInput value={v.ppn} onChange={(n) => set('ppn', n)} /> : <div className="py-2 text-right tabular-nums">{rp(ppn)}</div>}
          </Field>
          <Field label="PPh 23" hint={proposal ? `Usulan ${rp(proposal.pph23)}` : undefined}>
            {manualTax ? <RupiahInput value={v.pph23} onChange={(n) => set('pph23', n)} /> : <div className="py-2 text-right tabular-nums">{rp(pph23)}</div>}
          </Field>
          <Field label="Diterima penyedia (bersih)"><div className="py-2 text-right font-semibold tabular-nums">{rp(net)}</div></Field>
          <Field label="Potongan (denda/SLA)"><RupiahInput value={v.deduction} onChange={(n) => set('deduction', n ?? NaN)} /></Field>
          <Field label="Alasan potongan" required={!!v.deduction} className="md:col-span-2"><Input value={v.deduction_reason} onChange={(e) => set('deduction_reason', e.target.value)} /></Field>
          <Field label="Nomor BA pembayaran"><Input value={v.ba_number} onChange={(e) => set('ba_number', e.target.value)} /></Field>
          <Field label="Tanggal BA"><Input type="date" {...d('ba_date')} /></Field>
          <Field label="Pejabat PPK penandatangan">
            <Select value={v.official_id ?? ''} onChange={(e) => set('official_id', e.target.value || null)}>
              <option value="">— Tidak diisi —</option>{officials.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field label="Kurs (valas)" hint="Desimal dengan titik, mis. 15850.25"><Input value={v.fx_rate} onChange={(e) => set('fx_rate', e.target.value)} inputMode="decimal" /></Field>
          <Field label="Nilai valas"><Input value={v.fx_amount} onChange={(e) => set('fx_amount', e.target.value)} inputMode="decimal" /></Field>
          <Field label="Catatan"><Input value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-navy-900">Sumber dana</h3>
            <Button size="sm" variant="outline" disabled={!contract || total <= 0} onClick={autoSplit}><Wand2 size={14} />Bagi otomatis sesuai sisa pagu</Button>
          </div>
          {!rows.length && <p className="text-sm text-slate-500">Belum dibagi. Gunakan pembagian otomatis (DIPA dulu, RM → PNBP → BLU) atau tambah baris.</p>}
          {!!rows.length && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Baris anggaran</th><th className="px-3 py-2 text-right">Sisa pagu realisasi</th><th className="px-3 py-2 text-right">Nilai</th><th /></tr></thead>
              <tbody>{rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">
                    <Select aria-label="Baris anggaran" value={r.budget_line_id} onChange={(e) => setFunding(rows.map((x, j) => (j === i ? { ...x, budget_line_id: e.target.value } : x)))}>
                      <option value="">— Pilih —</option>
                      {lines.data?.filter((l) => l.id === r.budget_line_id || !used.has(l.id)).map((l) => <option key={l.id} value={l.id}>{budgetLabel(l)}</option>)}
                    </Select>
                  </td>
                  <td className={cn('px-3 py-1.5 text-right tabular-nums', r.budget_line_id && ok(r.amount) && r.amount > remaining(r.budget_line_id) && 'text-red-700')}>{r.budget_line_id ? rp(remaining(r.budget_line_id)) : '—'}</td>
                  <td className="px-3 py-1.5"><RupiahInput aria-label="Nilai sumber dana" value={ok(r.amount) ? r.amount : null} onChange={(n) => setFunding(rows.map((x, j) => (j === i ? { ...x, amount: n ?? NaN } : x)))} /></td>
                  <td className="px-1 text-right"><Button size="icon" variant="ghost" aria-label="Hapus baris" title="Hapus baris" onClick={() => setFunding(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></Button></td>
                </tr>))}</tbody>
              <tfoot className="border-t-2 border-slate-200 font-semibold"><tr>
                <td className="px-3 py-2" colSpan={2}>Total {sumFunding !== total && <span className="font-normal text-red-700">(harus {rp(total)})</span>}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', sumFunding !== total && 'text-red-700')}>{rp(sumFunding)}</td><td />
              </tr></tfoot>
            </table>
          )}
          <Button className="mt-2" size="sm" variant="outline" onClick={() => setFunding([...rows, { budget_line_id: '', amount: Math.max(0, total - sumFunding) }])}><Plus size={14} />Tambah baris</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BillDetailDialog({ id, canWrite, onClose, onEdit, onChanged }: { id: string; canWrite: boolean; onClose: () => void; onEdit: (b: Bill) => void; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const d = useAsync(() => api.ppk.bills.get(id), [id]);
  const [cancel, setCancel] = useState(false);
  const refresh = () => { d.reload(); onChanged(); };
  const b = d.data?.bill;
  const verify = async () => {
    if (!b || !(await confirm({ title: 'Verifikasi tagihan?', message: 'Setelah diverifikasi, nilai, pajak, dan sumber dana terkunci. Koreksi dilakukan dengan membatalkan lalu membuat tagihan baru.', confirmLabel: 'Verifikasi' }))) return;
    try { await api.ppk.bills.setStatus(b.id, 'diverifikasi'); toast('Tagihan diverifikasi.', 'success'); refresh(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const row = (label: ReactNode, value: ReactNode) => <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5"><dt className="text-slate-500">{label}</dt><dd className="text-right">{value}</dd></div>;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title={b ? `Tagihan ${b.bill_number}` : 'Tagihan'} description={b ? `${b.contract_number} · ${b.vendor_name} · bulan layanan ${b.service_month}` : undefined}
        footer={b && canWrite && b.status !== 'dibatalkan' && <>
          {b.status === 'draft' && <Button variant="outline" onClick={() => onEdit(b)}><Pencil size={15} />Ubah</Button>}
          <Button variant="outline" onClick={() => setCancel(true)}><Ban size={15} />Batalkan Tagihan</Button>
          {b.status === 'draft' && <Button onClick={verify}><CheckCircle2 size={15} />Verifikasi</Button>}
        </>}>
        {d.error && <Empty>{d.error}</Empty>}
        {b && d.data && <>
          <dl className="grid gap-x-8 text-sm md:grid-cols-2">
            <div>
              {row('Status', <Badge tone={STAGE_TONE[billStage(b)]}>{billStage(b)}</Badge>)}
              {row('Tanggal tagihan', `${b.bill_date}${b.received_date ? ` (diterima ${b.received_date})` : ''}`)}
              {(b.period_start || b.period_end) && row('Periode layanan', `${b.period_start ?? '…'} s.d. ${b.period_end ?? '…'}`)}
              {row('Faktur', b.faktur_code ? `FP ${b.faktur_code}${b.faktur_number ? ` · ${b.faktur_number}` : ''}` : 'Tanpa faktur')}
              {b.ba_number && row('BA pembayaran', `${b.ba_number}${b.ba_date ? `, ${b.ba_date}` : ''}${b.official_name ? ` · ${b.official_name}` : ''}`)}
              {b.fx_rate && row('Kurs / valas', `${b.fx_rate} · ${b.fx_amount || '—'}`)}
              {b.status === 'dibatalkan' && row('Alasan batal', b.cancel_reason)}
            </div>
            <div>
              {row('Nilai kena pajak', rp(b.amount))}
              {!!b.pass_through && row('Pass-through', rp(b.pass_through))}
              {row(<strong>Nilai tagihan</strong>, <strong>{rp(b.total)}</strong>)}
              {row(`DPP`, rp(b.dpp))}
              {row('PPN dipungut', rp(b.ppn))}
              {row('PPh 23', rp(b.pph23))}
              {!!b.deduction && row(`Potongan (${b.deduction_reason})`, rp(b.deduction))}
              {row(<strong>Diterima penyedia</strong>, <strong>{rp(b.net)}</strong>)}
            </div>
          </dl>
          <RelatedDocs numbers={[b.ba_number, b.bill_number]} />
          <h3 className="mb-2 mt-5 text-sm font-semibold text-navy-900">Sumber dana dan pembayaran</h3>
          <div className="space-y-3">{d.data.funding.map((f) => <FundingPayments key={f.id} f={f} canPay={canWrite && b.status === 'diverifikasi'} onChanged={refresh} />)}</div>
          {b.status === 'draft' && <p className="mt-3 text-xs text-slate-500">Pembayaran dapat dicatat setelah tagihan diverifikasi.</p>}
          {b.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600">{b.notes}</p>}
          <p className="mt-3 text-xs text-slate-400">Dibuat {b.created_by}, {b.created_at.slice(0, 10)} · diubah {b.updated_by}, {b.updated_at.slice(0, 10)}</p>
        </>}
        {cancel && b && <ReasonDialog title="Batalkan tagihan?" message="Tagihan tetap tercatat dengan tanda dibatalkan dan tidak dihitung sebagai realisasi."
          confirmLabel="Batalkan Tagihan" onClose={() => setCancel(false)}
          onSubmit={async (r) => { try { await api.ppk.bills.setStatus(b.id, 'dibatalkan', r); toast('Tagihan dibatalkan.', 'success'); setCancel(false); refresh(); } catch (e) { toast(errMsg(e), 'error'); } }} />}
      </DialogContent>
    </Dialog>
  );
}

function FundingPayments({ f, canPay, onChanged }: { f: BillFundingView; canPay: boolean; onChanged: () => void }) {
  const { toast } = useFeedback(); const warn = useWarnings();
  const [p, setP] = useState<PaymentInput | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = f.payments.some((x) => !x.voided_at);
  const save = async () => {
    setBusy(true);
    try { const r = await api.ppk.bills.addPayment(f.id, p!); warn('Pembayaran dicatat.', r.warnings); setP(null); onChanged(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div><span className="font-medium">{budgetLabel(f)}</span> <span className="text-xs text-slate-500">· kanal {f.payment_channel}</span></div>
        <div className="tabular-nums">{rp(f.amount)} · terbayar <span className={cn(f.paid >= f.amount ? 'text-green-700' : 'text-amber-700')}>{rp(f.paid)}</span></div>
      </div>
      {!!f.payments.length && (
        <table className="mt-2 w-full text-xs">
          <tbody>{f.payments.map((x) => (
            <tr key={x.id} className={cn('border-t border-slate-100', x.voided_at && 'text-slate-400 line-through')}>
              <td className="py-1">{x.channel === 'SAKTI' ? 'SP2D' : x.channel} {x.reference_number}</td><td className="py-1">{x.payment_date}</td>
              <td className="py-1 text-right tabular-nums">{rp(x.amount)}</td>
              <td className="py-1 pl-2">{x.voided_at ? `Dibatalkan ${x.voided_by}: ${x.void_reason}` : x.notes}</td>
              <td className="py-1 text-right">{canPay && !x.voided_at && <Button size="sm" variant="ghost" onClick={() => setVoiding(x.id)}>Batalkan</Button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {canPay && !active && !p && <Button className="mt-2" size="sm" variant="outline"
        onClick={() => setP({ channel: f.payment_channel, reference_number: '', payment_date: today(), amount: f.amount, notes: '' })}><Plus size={14} />Catat {f.payment_channel === 'SAKTI' ? 'SP2D' : 'pembayaran'}</Button>}
      {p && (
        <div className="mt-3 grid gap-2 md:grid-cols-5">
          <Field label="Kanal"><Select value={p.channel} onChange={(e) => setP({ ...p, channel: e.target.value as PaymentChannel })}>{PAYMENT_CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label={p.channel === 'SAKTI' ? 'Nomor SP2D' : 'Nomor referensi'} required><Input value={p.reference_number} onChange={(e) => setP({ ...p, reference_number: e.target.value })} autoFocus /></Field>
          <Field label="Tanggal" required><Input type="date" value={p.payment_date} onChange={(e) => setP({ ...p, payment_date: e.target.value })} /></Field>
          <Field label="Nilai (bruto)" required><RupiahInput value={ok(p.amount) ? p.amount : null} onChange={(n) => setP({ ...p, amount: n ?? NaN })} /></Field>
          <Field label="Catatan"><Input value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 md:col-span-5">
            <Button size="sm" variant="outline" onClick={() => setP(null)}>Batal</Button>
            <Button size="sm" disabled={busy || !p.reference_number.trim() || !p.payment_date || !ok(p.amount) || p.amount <= 0} onClick={save}>Simpan Pembayaran</Button>
          </div>
        </div>
      )}
      {voiding && <ReasonDialog title="Batalkan pembayaran?" message="Pembayaran tetap tercatat dengan tanda dibatalkan." confirmLabel="Batalkan Pembayaran" onClose={() => setVoiding(null)}
        onSubmit={async (r) => { try { await api.ppk.bills.voidPayment(voiding, r); toast('Pembayaran dibatalkan.', 'success'); setVoiding(null); onChanged(); } catch (e) { toast(errMsg(e), 'error'); } }} />}
    </Card>
  );
}

const CELL_TONE: Record<string, string> = {
  Lunas: 'bg-emerald-50 text-emerald-900', 'Dibayar sebagian': 'bg-amber-50 text-amber-900', 'Menunggu bayar': 'bg-sky-50 text-sky-900', Draf: 'bg-slate-100 text-slate-600'
};

/** Kontrak × bulan layanan: nilai tagihan per bulan dengan warna tahap pembayaran; klik sel untuk membuka tagihan. */
function BillMatrix({ fiscalYearId, year, bills, onOpen }: { fiscalYearId: string; year: number; bills: Bill[]; onOpen: (id: string) => void }) {
  const contracts = useAsync(() => api.ppk.contracts.list({ fiscal_year_id: fiscalYearId }), [fiscalYearId]);
  const [unit, setUnit] = useState<number>(1e6);
  const rows = useMemo(() => billMatrix(contracts.data ?? [], bills, year), [contracts.data, bills, year]);
  if (contracts.error) return <Empty>{contracts.error}</Empty>;
  if (!contracts.data) return null;
  if (!rows.length) return <Empty>Belum ada kontrak untuk tahun ini.</Empty>;
  const totals = MONTH_LABEL.map((_, i) => rows.reduce((a, r) => a + (r.months[i]?.total ?? 0), 0));
  const first = 'sticky left-0 z-10 w-72 min-w-72 max-w-72 border-r border-slate-200 bg-white px-3 py-1.5 text-left';
  return <>
    <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
      {Object.entries(CELL_TONE).map(([k, cls]) => <span key={k} className={cn('rounded px-2 py-0.5', cls)}>{k}</span>)}
      <span>Filter status dan pencarian di atas ikut berlaku.</span>
      <Select className="ml-auto w-32" value={unit} onChange={(e) => setUnit(Number(e.target.value))} aria-label="Satuan angka">
        {UNITS.map(([u, label]) => <option key={u} value={u}>{label}</option>)}
      </Select>
    </div>
    <Card className="max-h-[70vh] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-20 bg-slate-50 text-slate-600"><tr>
          <th className={cn(first, 'z-30 bg-slate-50')}>Kontrak / penyedia</th>
          {MONTH_LABEL.map((m) => <th key={m} className="border-b border-slate-200 px-2 py-2 text-right">{m}</th>)}
          <th className="border-b border-l border-slate-200 px-2 py-2 text-right">Nilai kontrak</th><th className="border-b border-slate-200 px-2 py-2 text-right">Tertagih</th>
          <th className="border-b border-slate-200 px-2 py-2 text-right">Sisa</th>
        </tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.contract_id}>
            <td className={cn(first, 'border-b border-slate-100')} title={`${r.contract_number} · ${r.vendor_name}`}>
              <div className="truncate font-medium text-slate-800">{r.vendor_name}</div><div className="truncate text-[11px] text-slate-500">{r.contract_number}</div>
            </td>
            {r.months.map((m, i) => <td key={i} className="border-b border-slate-100 p-0.5">
              {m ? <button className={cn('w-full rounded px-1.5 py-1 text-right tabular-nums hover:ring-1 hover:ring-navy-700', CELL_TONE[m.stage])}
                onClick={() => onOpen(m.bill_ids[0])} title={`${m.stage}${m.count > 1 ? ` · ${m.count} tagihan` : ''}`}>
                <Num n={m.total} unit={unit} />{m.count > 1 && <sup className="ml-0.5">{m.count}</sup>}</button>
                : <span className="block px-1.5 text-right text-slate-300">–</span>}
            </td>)}
            <td className="whitespace-nowrap border-b border-l border-slate-100 border-l-slate-200 px-2 text-right tabular-nums"><Num n={r.latest_value} unit={unit} /></td>
            <td className="whitespace-nowrap border-b border-slate-100 px-2 text-right tabular-nums"><Num n={r.billed} unit={unit} /></td>
            <td className={cn('whitespace-nowrap border-b border-slate-100 px-2 text-right tabular-nums', r.sisa_kontrak < 0 && 'text-red-700')}><Num n={r.sisa_kontrak} unit={unit} /></td>
          </tr>))}
        </tbody>
        <tfoot className="sticky bottom-0 z-20 bg-slate-50 font-semibold"><tr>
          <td className={cn(first, 'border-t-2 bg-slate-50')}>Total</td>
          {totals.map((v, i) => <td key={i} className="whitespace-nowrap border-t-2 border-slate-200 px-2 py-1.5 text-right tabular-nums"><Num n={v} unit={unit} /></td>)}
          {(['latest_value', 'billed', 'sisa_kontrak'] as const).map((k) => <td key={k} className="whitespace-nowrap border-t-2 border-slate-200 px-2 text-right tabular-nums"><Num n={rows.reduce((a, r) => a + r[k], 0)} unit={unit} /></td>)}
        </tr></tfoot>
      </table>
    </Card>
  </>;
}
