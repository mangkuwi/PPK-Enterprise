import { useState } from 'react';
import { History, Pencil, Plus, TrendingUp } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PpkGate } from '@/features/ppk/PpkGate';
import { RupiahInput, rp, useFiscalYears, useWarnings } from '@/features/ppk/inputs';
import { api } from '@/services/api';
import type { MasterRow } from '@shared/ppk/master';
import { BUDGET_KIND_LABEL, type BudgetAmountInput, type BudgetKind, type BudgetLine, type BudgetLineInput } from '@shared/ppk/budget';

const today = () => new Date().toISOString().slice(0, 10);
const AMOUNT: BudgetAmountInput = { amount: 0, effective_date: '', source_document: '', notes: '' };

export default function BudgetPage() {
  const { can } = usePpkAccess();
  const { years, id: fyId, setId: setFy } = useFiscalYears();
  const [inactive, setInactive] = useState(false);
  const list = useAsync(() => (fyId ? api.ppk.budget.list({ fiscal_year_id: fyId, include_inactive: inactive }) : Promise.resolve([])), [fyId, inactive]);
  const [dlg, setDlg] = useState<{ kind: 'new' } | { kind: 'revise' | 'history' | 'edit'; line: BudgetLine } | null>(null);
  const done = () => { setDlg(null); list.reload(); };
  const rows = list.data ?? [];
  const sum = (k: 'pagu_awal' | 'pagu_terakhir' | 'allocated' | 'sisa') => rows.filter((r) => r.is_active).reduce((a, r) => a + r[k], 0);

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Database Anggaran" subtitle="Pagu per MAK dan sumber dana, riwayat revisi, dan komitmen kontrak."
          actions={can('write') && <Button onClick={() => setDlg({ kind: 'new' })} disabled={!fyId}><Plus size={16} />Tambah Baris Anggaran</Button>} />
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <Select className="w-44" value={fyId} onChange={(e) => setFy(e.target.value)} aria-label="Tahun anggaran">
            {years.map((y) => <option key={y.id} value={y.id}>TA {y.year}</option>)}
          </Select>
          <Switch checked={inactive} onChange={setInactive} label="Tampilkan baris nonaktif" />
        </div>
        {list.error && <Empty>{list.error}</Empty>}
        {list.data && !rows.length && <Empty>Belum ada baris anggaran untuk tahun ini.</Empty>}
        {!!rows.length && (
          <Card className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                <th className="px-3 py-2 text-left">Program / Kegiatan</th><th className="px-3 py-2 text-left">MAK</th><th className="px-3 py-2 text-left">Detail output</th>
                <th className="px-3 py-2 text-left">Sumber</th><th className="px-3 py-2 text-left">Jenis</th>
                <th className="px-3 py-2 text-right">Pagu awal</th><th className="px-3 py-2 text-right">Pagu terakhir</th>
                <th className="px-3 py-2 text-right">Komitmen kontrak</th><th className="px-3 py-2 text-right">Sisa pagu</th><th className="px-3 py-2 text-right">Aksi</th>
              </tr></thead>
              <tbody>{rows.map((b) => (
                <tr key={b.id} className={`border-t border-slate-100 ${b.is_active ? '' : 'text-slate-400'}`}>
                  <td className="px-3 py-2"><div className="font-medium">{b.program_code}</div><div className="text-xs text-slate-500">{b.activity_name}</div></td>
                  <td className="px-3 py-2 font-mono text-xs" title={b.mak_name}>{b.mak}</td>
                  <td className="px-3 py-2">{b.output_detail || '—'}{!b.is_active && <Badge className="ml-2">Nonaktif</Badge>}</td>
                  <td className="px-3 py-2">{b.source_code}</td>
                  <td className="px-3 py-2">{BUDGET_KIND_LABEL[b.kind]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rp(b.pagu_awal)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rp(b.pagu_terakhir)}{b.revisions > 0 && <div className="text-xs text-slate-500">{b.revisions}× revisi</div>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{rp(b.allocated)}</td>
                  <td className={`px-3 py-2 text-right font-medium tabular-nums ${b.sisa < 0 ? 'text-red-700' : ''}`}>{rp(b.sisa)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <Button size="icon" variant="ghost" title="Riwayat pagu" aria-label={`Riwayat pagu ${b.mak}`} onClick={() => setDlg({ kind: 'history', line: b })}><History size={15} /></Button>
                    {can('write') && <>
                      <Button size="icon" variant="ghost" title="Revisi pagu" aria-label={`Revisi pagu ${b.mak}`} onClick={() => setDlg({ kind: 'revise', line: b })}><TrendingUp size={15} /></Button>
                      <Button size="icon" variant="ghost" title="Ubah uraian/status" aria-label={`Ubah ${b.mak}`} onClick={() => setDlg({ kind: 'edit', line: b })}><Pencil size={15} /></Button>
                    </>}
                  </td>
                </tr>))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold"><tr>
                <td className="px-3 py-2" colSpan={5}>Total baris aktif</td>
                <td className="px-3 py-2 text-right tabular-nums">{rp(sum('pagu_awal'))}</td><td className="px-3 py-2 text-right tabular-nums">{rp(sum('pagu_terakhir'))}</td>
                <td className="px-3 py-2 text-right tabular-nums">{rp(sum('allocated'))}</td><td className="px-3 py-2 text-right tabular-nums">{rp(sum('sisa'))}</td><td />
              </tr></tfoot>
            </table>
          </Card>
        )}
        <p className="mt-3 text-xs text-slate-500">Komitmen = pembebanan kontrak yang tidak dibatalkan. Realisasi pembayaran tampil setelah modul tagihan dan pembayaran selesai.</p>
        {dlg?.kind === 'new' && <NewLineDialog fiscalYearId={fyId} onClose={() => setDlg(null)} onSaved={done} />}
        {dlg?.kind === 'revise' && <ReviseDialog line={dlg.line} onClose={() => setDlg(null)} onSaved={done} />}
        {dlg?.kind === 'edit' && <EditLineDialog line={dlg.line} onClose={() => setDlg(null)} onSaved={done} />}
        {dlg?.kind === 'history' && <HistoryDialog line={dlg.line} onClose={() => setDlg(null)} />}
      </PpkGate>
    </Page>
  );
}

function AmountFields({ a, set, label }: { a: BudgetAmountInput; set: (a: BudgetAmountInput) => void; label: string }) {
  return <>
    <Field label={label} required><RupiahInput value={a.amount} onChange={(v) => set({ ...a, amount: v ?? NaN })} /></Field>
    <Field label="Tanggal berlaku" required><Input type="date" value={a.effective_date} onChange={(e) => set({ ...a, effective_date: e.target.value })} /></Field>
    <Field label="Dokumen sumber" required hint="Nomor DIPA atau surat revisi" className="md:col-span-2"><Input value={a.source_document} onChange={(e) => set({ ...a, source_document: e.target.value })} /></Field>
    <Field label="Catatan" className="md:col-span-2"><Textarea value={a.notes} onChange={(e) => set({ ...a, notes: e.target.value })} /></Field>
  </>;
}
const amountReady = (a: BudgetAmountInput) => Number.isSafeInteger(a.amount) && a.amount >= 0 && !!a.effective_date && !!a.source_document.trim();

function NewLineDialog({ fiscalYearId, onClose, onSaved }: { fiscalYearId: string; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const m = useAsync(async () => {
    const [units, programs, activities, accounts, sources] = await Promise.all((['units', 'programs', 'activities', 'budget_accounts', 'funding_sources'] as const).map((k) => api.ppk.masterList(k)));
    const on = (r: MasterRow[]) => r.filter((x) => x.is_active);
    return { units: on(units), programs: on(programs), activities: on(activities), accounts: on(accounts), sources: on(sources) };
  }, []);
  const [l, setL] = useState<BudgetLineInput>({ fiscal_year_id: fiscalYearId, unit_id: '', program_id: '', activity_id: '', budget_account_id: '', output_detail: '', funding_source_id: '', kind: 'dipa', description: '' });
  const [a, setA] = useState<BudgetAmountInput>({ ...AMOUNT, effective_date: today() });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof BudgetLineInput) => (e: { target: { value: string } }) => setL({ ...l, [k]: e.target.value, ...(k === 'program_id' ? { activity_id: '' } : {}) });
  const ready = l.unit_id && l.program_id && l.activity_id && l.budget_account_id && l.funding_source_id && amountReady(a);
  const save = async () => {
    setBusy(true);
    try { await api.ppk.budget.create(l, a); toast('Baris anggaran ditambahkan.', 'success'); onSaved(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const opts = (rows: MasterRow[] | undefined) => rows?.map((r) => <option key={r.id} value={r.id}>{[r.code, r.name].filter(Boolean).join(' — ')}</option>);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title="Tambah Baris Anggaran" description="Satu baris = TA + MAK + detail output + sumber dana + jenis pagu. Data master diatur di Pengaturan PPK."
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={busy || !ready} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></>}>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Unit PPK" required><Select value={l.unit_id} onChange={set('unit_id')}><option value="">— Pilih —</option>{opts(m.data?.units)}</Select></Field>
          <Field label="Jenis pagu" required>
            <Select value={l.kind} onChange={(e) => setL({ ...l, kind: e.target.value as BudgetKind })}>
              {Object.entries(BUDGET_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Program" required><Select value={l.program_id} onChange={set('program_id')}><option value="">— Pilih —</option>{opts(m.data?.programs)}</Select></Field>
          <Field label="Kegiatan" required>
            <Select value={l.activity_id} onChange={set('activity_id')} disabled={!l.program_id}><option value="">— Pilih —</option>{opts(m.data?.activities.filter((x) => x.program_id === l.program_id))}</Select>
          </Field>
          <Field label="Akun / MAK" required><Select value={l.budget_account_id} onChange={set('budget_account_id')}><option value="">— Pilih —</option>{opts(m.data?.accounts)}</Select></Field>
          <Field label="Sumber dana" required><Select value={l.funding_source_id} onChange={set('funding_source_id')}><option value="">— Pilih —</option>{opts(m.data?.sources)}</Select></Field>
          <Field label="Detail rincian output" hint="Pembeda bila MAK yang sama dipakai untuk beberapa output" className="md:col-span-2"><Input value={l.output_detail} onChange={set('output_detail')} /></Field>
          <Field label="Uraian" className="md:col-span-2"><Textarea value={l.description} onChange={set('description')} /></Field>
          <AmountFields a={a} set={setA} label="Pagu awal" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviseDialog({ line, onClose, onSaved }: { line: BudgetLine; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback(); const warn = useWarnings();
  const [a, setA] = useState<BudgetAmountInput>({ ...AMOUNT, amount: line.pagu_terakhir, effective_date: today() });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { const r = await api.ppk.budget.revise(line.id, a); warn('Revisi pagu dicatat.', r.warnings); onSaved(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Revisi Pagu — ${line.mak}${line.output_detail ? ` · ${line.output_detail}` : ''}`}
        description={`Pagu terakhir ${rp(line.pagu_terakhir)}, komitmen ${rp(line.allocated)}. Versi lama tetap tersimpan.`}
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={busy || !amountReady(a)} onClick={save}>{busy ? 'Menyimpan…' : 'Catat Revisi'}</Button></>}>
        <div className="grid gap-3 md:grid-cols-2"><AmountFields a={a} set={setA} label="Pagu baru" /></div>
      </DialogContent>
    </Dialog>
  );
}

function EditLineDialog({ line, onClose, onSaved }: { line: BudgetLine; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [desc, setDesc] = useState(line.description); const [active, setActive] = useState(!!line.is_active); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.ppk.budget.update(line.id, line.version, desc, active); toast('Baris anggaran diperbarui.', 'success'); onSaved(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Ubah Baris Anggaran — ${line.mak}`} description="MAK, sumber dana, dan tahun tidak dapat diubah. Bila salah, buat baris baru lalu nonaktifkan baris ini."
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></>}>
        <div className="grid gap-3">
          <Field label="Uraian"><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <Switch checked={active} onChange={setActive} label="Aktif (dapat dipakai untuk pembebanan kontrak)" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({ line, onClose }: { line: BudgetLine; onClose: () => void }) {
  const v = useAsync(() => api.ppk.budget.versions(line.id), [line.id]);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title={`Riwayat Pagu — ${line.mak}${line.output_detail ? ` · ${line.output_detail}` : ''}`} description={`${line.source_code} · ${BUDGET_KIND_LABEL[line.kind]}`}>
        {v.error && <Empty>{v.error}</Empty>}
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>
            <th className="px-3 py-2 text-left">Versi</th><th className="px-3 py-2 text-left">Berlaku</th><th className="px-3 py-2 text-right">Pagu</th>
            <th className="px-3 py-2 text-left">Dokumen sumber</th><th className="px-3 py-2 text-left">Catatan</th><th className="px-3 py-2 text-left">Dicatat</th>
          </tr></thead>
          <tbody>{v.data?.map((x) => (
            <tr key={x.id} className="border-t border-slate-100">
              <td className="px-3 py-2">{x.version_no === 1 ? 'Awal' : `Revisi ${x.version_no - 1}`}</td><td className="px-3 py-2">{x.effective_date}</td>
              <td className="px-3 py-2 text-right tabular-nums">{rp(x.amount)}</td><td className="px-3 py-2">{x.source_document}</td>
              <td className="px-3 py-2">{x.notes || '—'}</td><td className="px-3 py-2 text-xs text-slate-500">{x.created_by}, {x.created_at.slice(0, 10)}</td>
            </tr>))}</tbody>
        </table>
      </DialogContent>
    </Dialog>
  );
}
