import { useState, type ReactNode } from 'react';
import { Ban, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { cn } from '@/lib/utils';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PpkGate } from '@/features/ppk/PpkGate';
import { ReasonDialog, RupiahInput, rp, useFiscalYears, useWarnings } from '@/features/ppk/inputs';
import { api } from '@/services/api';
import { RelatedDocs } from '@/features/ppk/RelatedDocs';
import { Num } from '@/features/ppk/Num';
import { ExportButton, SlashWrap, TBL } from '@/features/ppk/table';
import type { MasterRow } from '@shared/ppk/master';
import { budgetLabel } from '@shared/ppk/budget';
import {
  CONTRACT_NEXT, CONTRACT_STATUS_LABEL, CONTRACT_TYPE_LABEL, contractProject, daysUntil, monthsBetween, splitEven,
  type AddendumInput, type AllocationRow, type Contract, type ContractDetail, type ContractInput, type ContractStatus, type ContractType, type ScheduleRow
} from '@shared/ppk/contracts';

const TONE: Record<ContractStatus, 'slate' | 'green' | 'navy' | 'red'> = { draft: 'slate', aktif: 'green', selesai: 'navy', dibatalkan: 'red' };
const opts = (rows: MasterRow[] | undefined, label = (r: MasterRow) => [r.code, r.name].filter(Boolean).join(' — ')) =>
  rows?.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>);

/** Badge sisa waktu untuk kontrak aktif yang berakhir ≤ 30 hari lagi atau sudah lewat. */
function EndBadge({ c }: { c: Contract }) {
  if (c.status !== 'aktif') return null;
  const d = daysUntil(c.effective_end);
  if (d > 30) return null;
  return <Badge tone={d < 0 ? 'red' : 'amber'} className="ml-2">{d < 0 ? `Lewat ${-d} hari` : d === 0 ? 'Berakhir hari ini' : `${d} hari lagi`}</Badge>;
}

export default function ContractsPage() {
  const { can } = usePpkAccess();
  const { years, id: fyId, setId: setFy } = useFiscalYears();
  const [status, setStatus] = useState<ContractStatus | 'semua'>('semua');
  const [search, setSearch] = useState(''); const q = useDebounced(search);
  const list = useAsync(() => (fyId ? api.ppk.contracts.list({ fiscal_year_id: fyId, status, search: q }) : Promise.resolve([])), [fyId, status, q]);
  const [form, setForm] = useState<Contract | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Database Kontrak" subtitle="Kontrak induk, addendum, jadwal nilai per bulan, dan pembebanan ke anggaran."
          actions={<>
            <ExportButton run={() => api.ppk.contracts.exportXlsx({ fiscal_year_id: fyId, status, search: q })} disabled={!list.data?.length} />
            {can('write') && <Button onClick={() => setForm('new')} disabled={!fyId}><Plus size={16} />Tambah Kontrak</Button>}
          </>} />
        <div className="mb-4 flex flex-wrap gap-3">
          <Select className="w-40" value={fyId} onChange={(e) => setFy(e.target.value)} aria-label="Tahun anggaran">
            {years.map((y) => <option key={y.id} value={y.id}>TA {y.year}</option>)}
          </Select>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value as ContractStatus | 'semua')} aria-label="Filter status">
            <option value="semua">Semua status</option>
            {Object.entries(CONTRACT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Input className="max-w-sm" placeholder="Cari nomor, uraian, project, atau penyedia" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari kontrak" />
        </div>
        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !list.data.length && <Empty>Belum ada kontrak{search ? ' yang cocok' : ''} untuk tahun ini.</Empty>}
        {!!list.data?.length && (() => {
          const rows = list.data; const live = rows.filter((c) => c.status !== 'dibatalkan');
          const sum = (k: 'latest_value' | 'billed' | 'paid' | 'sisa_kontrak') => live.reduce((a, c) => a + c[k], 0);
          return <>
            <p className="mb-2 text-xs text-slate-500">{rows.length} kontrak · angka dalam Rupiah penuh · klik baris untuk detail.</p>
            <Card className={TBL.card}>
              <table className={TBL.table}>
                <thead className={TBL.head}><tr>
                  <th className={cn(TBL.th, TBL.first, 'z-30 bg-slate-50')}>Project / nomor kontrak</th><th className={TBL.th}>Penyedia</th><th className={TBL.th}>Uraian</th>
                  <th className={TBL.thNum}>Nilai terakhir</th><th className={TBL.thNum}>Tertagih</th><th className={TBL.thNum}>Dibayar</th><th className={cn(TBL.thNum, 'bg-sky-100 text-navy-900')}>Sisa kontrak</th>
                  <th className={TBL.th}>Status / selesai</th>
                </tr></thead>
                <tbody>{rows.map((c) => (
                  <tr key={c.id} className={cn(TBL.row, 'cursor-pointer', c.status === 'dibatalkan' && 'text-slate-400')} onClick={() => setOpen(c.id)}>
                    <td className={cn(TBL.td, TBL.first, 'font-medium text-navy-900')}>
                      {contractProject(c) && <div className="mb-0.5 text-sm font-bold text-navy-800">{contractProject(c)}</div>}
                      <button className="text-left text-xs font-normal text-slate-700 hover:underline" onClick={() => setOpen(c.id)}><SlashWrap text={c.contract_number} /></button>
                      {c.contract_type === 'kpbu' && <Badge className="ml-2">KPBU</Badge>}</td>
                    <td className={cn(TBL.td, 'min-w-40')}>{c.vendor_name}</td>
                    <td className={cn(TBL.td, 'min-w-72 max-w-md')}>{c.description}</td>
                    <td className={TBL.num}><Num n={c.latest_value} unit={1} />{c.addendum_count > 0 && <div className="text-xs text-slate-500">{c.addendum_count} addendum</div>}</td>
                    <td className={TBL.num}><Num n={c.billed} unit={1} /></td>
                    <td className={TBL.num}><Num n={c.paid} unit={1} /></td>
                    <td className={cn(TBL.num, 'bg-sky-50/60 font-medium', c.sisa_kontrak < 0 && 'text-red-700')}><Num n={c.sisa_kontrak} unit={1} /></td>
                    <td className={cn(TBL.td, 'whitespace-nowrap')}><Badge tone={TONE[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge>
                      <div className="mt-1 text-xs text-slate-500">{c.effective_end}</div><div className="-ml-2"><EndBadge c={c} /></div></td>
                  </tr>))}
                </tbody>
                <tfoot><tr>
                  <td className={cn(TBL.foot, TBL.first, 'z-30 bg-slate-100')}>Total {live.length} kontrak tidak dibatalkan</td><td className={TBL.foot} colSpan={2} />
                  {(['latest_value', 'billed', 'paid', 'sisa_kontrak'] as const).map((k) => <td key={k} className={cn(TBL.foot, 'whitespace-nowrap text-right tabular-nums')}><Num n={sum(k)} unit={1} /></td>)}
                  <td className={TBL.foot} />
                </tr></tfoot>
              </table>
            </Card>
          </>;
        })()}
        {form && <ContractForm fiscalYearId={fyId} contract={form === 'new' ? null : form} onClose={() => setForm(null)}
          onSaved={(c) => { setForm(null); list.reload(); setOpen(c.id); }} />}
        {open && !form && <ContractDetailDialog id={open} canWrite={can('write')} onClose={() => setOpen(null)} onEdit={(c) => setForm(c)} onChanged={list.reload} />}
      </PpkGate>
    </Page>
  );
}

const toInput = (c: Contract): ContractInput => ({
  fiscal_year_id: c.fiscal_year_id, unit_id: c.unit_id, vendor_id: c.vendor_id, program_id: c.program_id, activity_id: c.activity_id, service_package_id: c.service_package_id,
  contract_type: c.contract_type, contract_number: c.contract_number, vendor_contract_number: c.vendor_contract_number, contract_date: c.contract_date, description: c.description,
  initial_value: c.initial_value, start_date: c.start_date, end_date: c.end_date, is_multi_year: !!c.is_multi_year, term_start: c.term_start, term_end: c.term_end,
  prior_year_paid: c.prior_year_paid, notes: c.notes
});

function ContractForm({ fiscalYearId, contract, onClose, onSaved }: { fiscalYearId: string; contract: Contract | null; onClose: () => void; onSaved: (c: Contract) => void }) {
  const { toast } = useFeedback();
  const m = useAsync(async () => {
    const [years, units, programs, activities, packages, vendors] = await Promise.all([
      api.ppk.masterList('fiscal_years'), api.ppk.masterList('units'), api.ppk.masterList('programs'), api.ppk.masterList('activities'),
      api.ppk.masterList('service_packages'), api.ppk.vendors.list({ status: 'aktif' })
    ]);
    return { years, units, programs, activities, packages, vendors };
  }, []);
  const [v, setV] = useState<ContractInput>(() => contract ? toInput(contract) : {
    fiscal_year_id: fiscalYearId, unit_id: '', vendor_id: '', program_id: '', activity_id: '', service_package_id: null, contract_type: 'biasa',
    contract_number: '', vendor_contract_number: '', contract_date: '', description: '', initial_value: NaN, start_date: '', end_date: '',
    is_multi_year: false, term_start: null, term_end: null, prior_year_paid: 0, notes: ''
  });
  const [busy, setBusy] = useState(false);
  const locked = !!contract && contract.status !== 'draft';
  const set = (k: keyof ContractInput) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: k === 'service_package_id' ? e.target.value || null : e.target.value, ...(k === 'program_id' ? { activity_id: '' } : {}) });
  const ready = v.unit_id && v.vendor_id && v.activity_id && v.contract_number.trim() && v.contract_date && v.description.trim()
    && Number.isSafeInteger(v.initial_value) && v.start_date && v.end_date && Number.isSafeInteger(v.prior_year_paid);
  const save = async () => {
    setBusy(true);
    try {
      const c = contract ? await api.ppk.contracts.update(contract.id, contract.version, v) : await api.ppk.contracts.create(v);
      toast(contract ? 'Kontrak diperbarui.' : 'Kontrak ditambahkan sebagai draf.', 'success'); onSaved(c);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  // Penyedia yang sudah dipakai tetap tampil walau kini tidak aktif.
  const vendors = m.data?.vendors.map((x) => ({ id: x.id, name: x.name })) ?? [];
  if (contract && !vendors.some((x) => x.id === contract.vendor_id)) vendors.unshift({ id: contract.vendor_id, name: `${contract.vendor_name} (tidak aktif)` });
  const active = (rows: MasterRow[] | undefined, keep: string | null) => rows?.filter((r) => r.is_active || r.id === keep);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title={contract ? `Ubah Kontrak — ${contract.contract_number}` : 'Tambah Kontrak'}
        description={locked ? 'Nilai awal terkunci karena kontrak sudah aktif. Perubahan nilai dicatat sebagai addendum.' : 'Kontrak baru tersimpan sebagai draf.'}
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={busy || !ready} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></>}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nomor kontrak" required><Input value={v.contract_number} onChange={set('contract_number')} autoFocus /></Field>
          <Field label="Nomor kontrak penyedia"><Input value={v.vendor_contract_number} onChange={set('vendor_contract_number')} /></Field>
          <Field label="Tanggal kontrak" required><Input type="date" value={v.contract_date} onChange={set('contract_date')} /></Field>
          <Field label="Penyedia" required className="md:col-span-2">
            <Select value={v.vendor_id} onChange={set('vendor_id')}><option value="">— Pilih —</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          </Field>
          <Field label="Jenis kontrak" required>
            <Select value={v.contract_type} onChange={(e) => setV({ ...v, contract_type: e.target.value as ContractType })}>
              {Object.entries(CONTRACT_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Tahun anggaran" required><Select value={v.fiscal_year_id} onChange={set('fiscal_year_id')}>{opts(m.data?.years, (r) => `TA ${r.year}`)}</Select></Field>
          <Field label="Unit PPK" required><Select value={v.unit_id} onChange={set('unit_id')}><option value="">— Pilih —</option>{opts(active(m.data?.units, v.unit_id))}</Select></Field>
          <Field label="Paket layanan"><Select value={v.service_package_id ?? ''} onChange={set('service_package_id')}><option value="">— Tidak ada —</option>{opts(active(m.data?.packages, v.service_package_id))}</Select></Field>
          <Field label="Program" required><Select value={v.program_id} onChange={set('program_id')}><option value="">— Pilih —</option>{opts(active(m.data?.programs, v.program_id))}</Select></Field>
          <Field label="Kegiatan" required className="md:col-span-2">
            <Select value={v.activity_id} onChange={set('activity_id')} disabled={!v.program_id}><option value="">— Pilih —</option>{opts(active(m.data?.activities, v.activity_id)?.filter((a) => a.program_id === v.program_id))}</Select>
          </Field>
          <Field label="Uraian pekerjaan" required className="md:col-span-3"><Textarea value={v.description} onChange={set('description')} /></Field>
          <Field label="Nilai kontrak awal" required hint={locked ? 'Terkunci; gunakan addendum' : undefined}>
            {locked ? <Input value={rp(v.initial_value)} disabled className="text-right" /> : <RupiahInput value={Number.isNaN(v.initial_value) ? null : v.initial_value} onChange={(n) => setV({ ...v, initial_value: n ?? NaN })} />}
          </Field>
          <Field label="Tanggal mulai" required><Input type="date" value={v.start_date} onChange={set('start_date')} /></Field>
          <Field label="Tanggal selesai" required><Input type="date" value={v.end_date} onChange={set('end_date')} /></Field>
          <div className="md:col-span-3"><Switch checked={v.is_multi_year} onChange={(b) => setV({ ...v, is_multi_year: b })} label="Kontrak tahun jamak" /></div>
          {v.is_multi_year && <>
            <Field label="Awal masa kontrak" required><Input type="date" value={v.term_start ?? ''} onChange={(e) => setV({ ...v, term_start: e.target.value || null })} /></Field>
            <Field label="Akhir masa kontrak" required><Input type="date" value={v.term_end ?? ''} onChange={(e) => setV({ ...v, term_end: e.target.value || null })} /></Field>
            <Field label="Akumulasi bayar tahun lalu"><RupiahInput value={v.prior_year_paid} onChange={(n) => setV({ ...v, prior_year_paid: n ?? NaN })} /></Field>
          </>}
          <Field label="Catatan" className="md:col-span-3"><Textarea value={v.notes} onChange={set('notes')} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Tab = 'ringkas' | 'addendum' | 'jadwal' | 'beban' | 'tahunan';

function ContractDetailDialog({ id, canWrite, onClose, onEdit, onChanged }: { id: string; canWrite: boolean; onClose: () => void; onEdit: (c: Contract) => void; onChanged: () => void }) {
  const { toast } = useFeedback();
  const d = useAsync(() => api.ppk.contracts.get(id), [id]);
  const [tab, setTab] = useState<Tab>('ringkas');
  const [cancel, setCancel] = useState(false);
  const refresh = () => { d.reload(); onChanged(); };
  const c = d.data?.contract;
  const editable = canWrite && !!c && (c.status === 'draft' || c.status === 'aktif');
  const move = async (to: ContractStatus, reason = '') => {
    try { await api.ppk.contracts.setStatus(id, to, reason); toast(`Status kontrak: ${CONTRACT_STATUS_LABEL[to]}.`, 'success'); setCancel(false); refresh(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const tabs: Array<[Tab, string]> = [['ringkas', 'Ringkasan'], ['addendum', `Addendum (${c?.addendum_count ?? 0})`], ['jadwal', 'Jadwal nilai'], ['beban', 'Pembebanan anggaran'], ...(c?.is_multi_year ? [['tahunan', 'Nilai per tahun'] as [Tab, string]] : [])];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title={c ? `Kontrak ${c.contract_number}` : 'Kontrak'} description={c ? `${c.vendor_name} · TA ${c.year}` : undefined}
        footer={c && canWrite && <>
          {editable && <Button variant="outline" onClick={() => onEdit(c)}><Pencil size={15} />Ubah</Button>}
          {CONTRACT_NEXT[c.status].includes('dibatalkan') && <Button variant="outline" onClick={() => setCancel(true)}><Ban size={15} />Batalkan Kontrak</Button>}
          {c.status === 'draft' && <Button onClick={() => move('aktif')}>Aktifkan</Button>}
          {c.status === 'aktif' && <Button onClick={() => move('selesai')}>Tandai Selesai</Button>}
        </>}>
        {d.error && <Empty>{d.error}</Empty>}
        {c && d.data && <>
          <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-navy-800 text-navy-900' : 'border-transparent text-slate-500 hover:text-slate-800')}>{label}</button>
            ))}
          </div>
          {tab === 'ringkas' && <Summary c={c} />}
          {tab === 'addendum' && <Addendums detail={d.data} canWrite={editable} onChanged={refresh} />}
          {tab === 'jadwal' && <Schedule detail={d.data} canWrite={editable} onChanged={refresh} />}
          {tab === 'beban' && <Allocations detail={d.data} canWrite={editable} onChanged={refresh} />}
          {tab === 'tahunan' && <YearValues detail={d.data} canWrite={editable} onChanged={refresh} />}
        </>}
        {cancel && <ReasonDialog title="Batalkan kontrak?" message="Kontrak yang dibatalkan tidak dihitung sebagai komitmen anggaran dan tidak dapat diaktifkan lagi."
          confirmLabel="Batalkan Kontrak" onClose={() => setCancel(false)} onSubmit={(r) => move('dibatalkan', r)} />}
      </DialogContent>
    </Dialog>
  );
}

function Summary({ c }: { c: Contract }) {
  const row = (label: ReactNode, value: ReactNode) => <div className="flex justify-between gap-4 border-b border-slate-100 py-1.5"><dt className="text-slate-500">{label}</dt><dd className="text-right">{value}</dd></div>;
  return (
    <dl className="grid gap-x-8 text-sm md:grid-cols-2">
      <div>
        {row('Status', <><Badge tone={TONE[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Badge><EndBadge c={c} /></>)}
        {row('Jenis', CONTRACT_TYPE_LABEL[c.contract_type])}
        {row('Program / kegiatan', `${c.program_code} · ${c.activity_name}`)}
        {row('Project', contractProject(c) || '—')}
        {row('Paket layanan', c.package_code ?? '—')}
        {row('Tanggal kontrak', c.contract_date)}
        {row('Masa pelaksanaan', `${c.start_date} s.d. ${c.effective_end}${c.effective_end !== c.end_date ? ` (awal ${c.end_date})` : ''}`)}
        {!!c.is_multi_year && row('Tahun jamak', `${c.term_start} s.d. ${c.term_end}`)}
      </div>
      <div>
        {row('Nilai kontrak awal', rp(c.initial_value))}
        {row('Perubahan addendum', rp(c.addendum_total))}
        {row(<strong>Nilai kontrak terakhir</strong>, <strong>{rp(c.latest_value)}</strong>)}
        {row('Dibebankan ke anggaran', rp(c.allocated))}
        {row('Total jadwal', rp(c.scheduled))}
        {row('Tertagih', rp(c.billed))}
        {row('Terbayar', rp(c.paid))}
        {row(<strong>Sisa kontrak</strong>, <strong>{rp(c.sisa_kontrak)}</strong>)}
        {!!c.is_multi_year && row('Dibayar tahun lalu', rp(c.prior_year_paid))}
      </div>
      <div className="mt-3 md:col-span-2"><dt className="text-slate-500">Uraian</dt><dd className="whitespace-pre-wrap">{c.description}</dd></div>
      {c.notes && <div className="mt-3 md:col-span-2"><dt className="text-slate-500">Catatan</dt><dd className="whitespace-pre-wrap">{c.notes}</dd></div>}
      <div className="md:col-span-2"><RelatedDocs numbers={[c.contract_number, c.vendor_contract_number]} /></div>
      <p className="mt-3 text-xs text-slate-400 md:col-span-2">Dibuat {c.created_by}, {c.created_at.slice(0, 10)} · diubah {c.updated_by}, {c.updated_at.slice(0, 10)}</p>
    </dl>
  );
}

const EMPTY_ADD: AddendumInput = { addendum_number: '', addendum_date: '', value_change: 0, period_start: null, period_end: null, new_end_date: null, description: '' };

function Addendums({ detail, canWrite, onChanged }: { detail: ContractDetail; canWrite: boolean; onChanged: () => void }) {
  const { toast } = useFeedback(); const warn = useWarnings();
  const [a, setA] = useState<AddendumInput | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.ppk.contracts.addAddendum(detail.contract.id, a!); warn('Addendum dicatat.', r.warnings); setA(null); onChanged(); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const d = (k: 'period_start' | 'period_end' | 'new_end_date') => ({ value: a?.[k] ?? '', onChange: (e: { target: { value: string } }) => setA({ ...a!, [k]: e.target.value || null }) });
  return <>
    {!detail.addendums.length && <p className="text-sm text-slate-500">Belum ada addendum.</p>}
    {!!detail.addendums.length && (
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>
          <th className="px-3 py-2 text-left">Nomor</th><th className="px-3 py-2 text-left">Tanggal</th><th className="px-3 py-2 text-right">Perubahan nilai</th>
          <th className="px-3 py-2 text-left">Selesai baru</th><th className="px-3 py-2 text-left">Uraian</th><th />
        </tr></thead>
        <tbody>{detail.addendums.map((x) => (
          <tr key={x.id} className={cn('border-t border-slate-100', x.voided_at && 'text-slate-400 line-through')}>
            <td className="px-3 py-2">{x.addendum_number}</td><td className="px-3 py-2">{x.addendum_date}</td>
            <td className="px-3 py-2 text-right tabular-nums">{rp(x.value_change)}</td><td className="px-3 py-2">{x.new_end_date ?? '—'}</td>
            <td className="px-3 py-2">{x.description || '—'}{x.voided_at && <div className="text-xs no-underline">Dibatalkan {x.voided_by}: {x.void_reason}</div>}</td>
            <td className="px-3 py-2 text-right">{canWrite && !x.voided_at && (
              <Button size="icon" variant="ghost" title="Batalkan addendum" aria-label={`Batalkan addendum ${x.addendum_number}`} onClick={() => setVoiding(x.id)}><Trash2 size={15} /></Button>)}</td>
          </tr>))}</tbody>
      </table>
    )}
    {canWrite && !a && <Button className="mt-3" variant="outline" onClick={() => setA(EMPTY_ADD)}><Plus size={15} />Catat Addendum</Button>}
    {a && (
      <Card className="mt-4 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Nomor addendum" required><Input value={a.addendum_number} onChange={(e) => setA({ ...a, addendum_number: e.target.value })} autoFocus /></Field>
          <Field label="Tanggal addendum" required><Input type="date" value={a.addendum_date} onChange={(e) => setA({ ...a, addendum_date: e.target.value })} /></Field>
          <Field label="Perubahan nilai" hint="Minus untuk pengurangan; 0 bila hanya waktu"><RupiahInput allowNegative value={a.value_change} onChange={(n) => setA({ ...a, value_change: n ?? NaN })} /></Field>
          <Field label="Awal periode"><Input type="date" {...d('period_start')} /></Field>
          <Field label="Akhir periode"><Input type="date" {...d('period_end')} /></Field>
          <Field label="Tanggal selesai baru"><Input type="date" {...d('new_end_date')} /></Field>
          <Field label="Uraian" className="md:col-span-3"><Textarea value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} /></Field>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setA(null)}>Batal</Button>
          <Button disabled={busy || !a.addendum_number.trim() || !a.addendum_date || !Number.isSafeInteger(a.value_change)} onClick={save}>Simpan Addendum</Button>
        </div>
      </Card>
    )}
    {voiding && <ReasonDialog title="Batalkan addendum?" message="Addendum tetap tercatat dengan tanda dibatalkan dan tidak lagi dihitung dalam nilai kontrak."
      confirmLabel="Batalkan Addendum" onClose={() => setVoiding(null)}
      onSubmit={async (reason) => {
        try { const r = await api.ppk.contracts.voidAddendum(voiding, reason); warn('Addendum dibatalkan.', r.warnings); setVoiding(null); onChanged(); } catch (e) { toast(errMsg(e), 'error'); }
      }} />}
  </>;
}

function Schedule({ detail, canWrite, onChanged }: { detail: ContractDetail; canWrite: boolean; onChanged: () => void }) {
  const { toast } = useFeedback(); const warn = useWarnings();
  const c = detail.contract;
  const [rows, setRows] = useState<ScheduleRow[]>(detail.schedule);
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((a, r) => a + (Number.isSafeInteger(r.planned_amount) ? r.planned_amount : 0), 0);
  const ok = rows.every((r) => Number.isSafeInteger(r.planned_amount) && r.planned_amount >= 0);
  const save = async () => {
    setBusy(true);
    try { const r = await api.ppk.contracts.setSchedule(c.id, rows); warn('Jadwal disimpan.', r.warnings); onChanged(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return <>
    {canWrite && <div className="mb-3 flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => setRows(splitEven(c.latest_value, monthsBetween(c.start_date, c.effective_end)))}>Bagi rata {c.start_date.slice(0, 7)} s.d. {c.effective_end.slice(0, 7)}</Button>
      <span className="text-xs text-slate-500">Sisa pembagian masuk bulan terakhir agar total sama persis.</span>
    </div>}
    {!rows.length && <p className="text-sm text-slate-500">Belum ada jadwal nilai.</p>}
    {!!rows.length && (
      <table className="w-full max-w-xl text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Bulan</th><th className="px-3 py-2 text-right">Rencana nilai</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.month} className="border-t border-slate-100">
            <td className="px-3 py-1.5">{r.month}</td>
            <td className="px-3 py-1.5">{canWrite
              ? <RupiahInput aria-label={`Rencana ${r.month}`} value={r.planned_amount} onChange={(n) => setRows(rows.map((x, j) => (j === i ? { ...x, planned_amount: n ?? NaN } : x)))} />
              : <div className="text-right tabular-nums">{rp(r.planned_amount)}</div>}</td>
          </tr>))}</tbody>
        <tfoot className="border-t-2 border-slate-200 font-semibold"><tr>
          <td className="px-3 py-2">Total</td>
          <td className={cn('px-3 py-2 text-right tabular-nums', total !== c.latest_value && 'text-amber-700')}>{rp(total)}{total !== c.latest_value && <div className="text-xs font-normal">Nilai kontrak {rp(c.latest_value)}</div>}</td>
        </tr></tfoot>
      </table>
    )}
    {canWrite && <Button className="mt-3" disabled={busy || !ok} onClick={save}>Simpan Jadwal</Button>}
  </>;
}

function Allocations({ detail, canWrite, onChanged }: { detail: ContractDetail; canWrite: boolean; onChanged: () => void }) {
  const { toast } = useFeedback(); const warn = useWarnings();
  const c = detail.contract;
  const lines = useAsync(() => api.ppk.budget.list({ fiscal_year_id: c.fiscal_year_id, include_inactive: true }), [c.fiscal_year_id]);
  const [rows, setRows] = useState<AllocationRow[]>(detail.allocations.map(({ budget_line_id, amount }) => ({ budget_line_id, amount })));
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((a, r) => a + (Number.isSafeInteger(r.amount) ? r.amount : 0), 0);
  const ok = rows.every((r) => r.budget_line_id && Number.isSafeInteger(r.amount) && r.amount > 0) && total <= c.latest_value;
  const byId = new Map((lines.data ?? []).map((l) => [l.id, l]));
  const save = async () => {
    setBusy(true);
    try { const r = await api.ppk.contracts.setAllocations(c.id, rows); warn('Pembebanan disimpan.', r.warnings); onChanged(); lines.reload(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const used = new Set(rows.map((r) => r.budget_line_id));
  const own = new Map(detail.allocations.map((a) => [a.budget_line_id, a.amount]));
  return <>
    <p className="mb-3 text-sm text-slate-600">Bebankan nilai kontrak ke baris anggaran (MAK + sumber dana) TA {c.year}. Total tidak boleh melebihi nilai kontrak terakhir {rp(c.latest_value)}.</p>
    {!rows.length && <p className="text-sm text-slate-500">Belum dibebankan ke anggaran.</p>}
    {!!rows.length && (
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>
          <th className="px-3 py-2 text-left">Baris anggaran</th><th className="px-3 py-2 text-right">Sisa pagu (di luar kontrak ini)</th><th className="px-3 py-2 text-right">Nilai dibebankan</th><th />
        </tr></thead>
        <tbody>{rows.map((r, i) => {
          const l = byId.get(r.budget_line_id);
          const free = l ? l.sisa + (own.get(l.id) ?? 0) : null;
          return (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-3 py-1.5">{canWrite
                ? <Select value={r.budget_line_id} aria-label="Baris anggaran" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, budget_line_id: e.target.value } : x)))}>
                    <option value="">— Pilih baris anggaran —</option>
                    {lines.data?.filter((x) => (x.is_active || own.has(x.id)) && (x.id === r.budget_line_id || !used.has(x.id))).map((x) => <option key={x.id} value={x.id}>{budgetLabel(x)}</option>)}
                  </Select>
                : l ? budgetLabel(l) : '…'}</td>
              <td className={cn('px-3 py-1.5 text-right tabular-nums', free != null && Number.isSafeInteger(r.amount) && r.amount > free && 'text-red-700')}>{rp(free)}</td>
              <td className="px-3 py-1.5">{canWrite
                ? <RupiahInput aria-label="Nilai dibebankan" value={r.amount} onChange={(n) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: n ?? NaN } : x)))} />
                : <div className="text-right tabular-nums">{rp(r.amount)}</div>}</td>
              <td className="px-1 text-right">{canWrite && <Button size="icon" variant="ghost" aria-label="Hapus baris" title="Hapus baris" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>}</td>
            </tr>);
        })}</tbody>
        <tfoot className="border-t-2 border-slate-200 font-semibold"><tr>
          <td className="px-3 py-2" colSpan={2}>Total dibebankan</td>
          <td className={cn('px-3 py-2 text-right tabular-nums', total > c.latest_value && 'text-red-700')}>{rp(total)}</td><td />
        </tr></tfoot>
      </table>
    )}
    {canWrite && <div className="mt-3 flex gap-2">
      <Button variant="outline" onClick={() => setRows([...rows, { budget_line_id: '', amount: Math.max(0, c.latest_value - total) }])}><Plus size={15} />Tambah Baris</Button>
      <Button disabled={busy || !ok} onClick={save}><FileText size={15} />Simpan Pembebanan</Button>
    </div>}
    {!lines.data?.length && lines.data && <p className="mt-2 text-xs text-amber-700">Belum ada baris anggaran TA {c.year}. Tambahkan di Database Anggaran.</p>}
  </>;
}

/** Kontrak tahun jamak: nilai estimasi per tahun anggaran (dipakai prognosis tahun itu). */
function YearValues({ detail, canWrite, onChanged }: { detail: ContractDetail; canWrite: boolean; onChanged: () => void }) {
  const { toast } = useFeedback(); const warn = useWarnings();
  const c = detail.contract;
  const [rows, setRows] = useState(detail.year_values.length ? detail.year_values : [{ year: c.year, amount: NaN }]);
  const [busy, setBusy] = useState(false);
  const ok = rows.every((r) => Number.isSafeInteger(r.amount) && r.amount >= 0) && new Set(rows.map((r) => r.year)).size === rows.length;
  const save = async () => {
    setBusy(true);
    try { const r = await api.ppk.contracts.setYearValues(c.id, rows); warn('Nilai per tahun disimpan.', r.warnings); onChanged(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return <>
    <p className="mb-3 text-sm text-slate-600">Masa kontrak {c.term_start ?? c.start_date} s.d. {c.term_end ?? c.effective_end}. Nilai tahun anggaran berjalan dipakai laporan prognosis sebagai pengganti nilai kontrak keseluruhan.</p>
    <table className="w-full max-w-xl text-sm">
      <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Tahun</th><th className="px-3 py-2 text-right">Nilai estimasi</th><th /></tr></thead>
      <tbody>{rows.map((r, i) => (
        <tr key={i} className="border-t border-slate-100">
          <td className="px-3 py-1.5">{canWrite
            ? <Input type="number" className="w-28" aria-label="Tahun" value={r.year} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, year: Number(e.target.value) } : x)))} />
            : r.year}</td>
          <td className="px-3 py-1.5">{canWrite
            ? <RupiahInput aria-label={`Nilai ${r.year}`} value={Number.isNaN(r.amount) ? null : r.amount} onChange={(n) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: n ?? NaN } : x)))} />
            : <div className="text-right tabular-nums">{rp(r.amount)}</div>}</td>
          <td className="px-1">{canWrite && <Button size="icon" variant="ghost" aria-label={`Hapus tahun ${r.year}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>}</td>
        </tr>))}</tbody>
    </table>
    {canWrite && <div className="mt-3 flex gap-2">
      <Button variant="outline" onClick={() => setRows([...rows, { year: Math.max(c.year - 1, ...rows.map((r) => r.year)) + 1, amount: NaN }])}><Plus size={15} />Tambah tahun</Button>
      <Button disabled={busy || !ok} onClick={save}>Simpan Nilai per Tahun</Button>
    </div>}
  </>;
}
