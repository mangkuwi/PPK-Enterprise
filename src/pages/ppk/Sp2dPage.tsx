import { useState } from 'react';
import { Ban, Plus } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PpkGate } from '@/features/ppk/PpkGate';
import { ReasonDialog, RupiahInput, rp, useFiscalYears } from '@/features/ppk/inputs';
import { api } from '@/services/api';
import { RECON_STATUS_LABEL, type ReconStatus } from '@shared/ppk/sp2d';

const TONE: Record<ReconStatus, 'green' | 'red' | 'amber' | 'navy' | 'slate'> = { cocok: 'green', selisih_nilai: 'red', hanya_sakti: 'amber', hanya_aplikasi: 'navy', selisih_tanggal: 'slate' };
const empty = () => ({ sp2d_number: '', sp2d_date: new Date().toISOString().slice(0, 10), amount: null as number | null, notes: '' });

export default function Sp2dPage() {
  const { can } = usePpkAccess();
  const { toast } = useFeedback();
  const { years, id: fyId, setId: setFy } = useFiscalYears();
  const rep = useAsync(() => (fyId ? api.ppk.sp2d.report(fyId) : Promise.resolve(null)), [fyId]);
  const [form, setForm] = useState(empty());
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [filter, setFilter] = useState<ReconStatus | 'semua'>('semua');
  const rows = (rep.data?.rows ?? []).filter((r) => filter === 'semua' || r.status === filter);
  const count = (s: ReconStatus) => rep.data?.rows.filter((r) => r.status === s).length ?? 0;
  const add = async () => {
    if (form.amount == null) return;
    setBusy(true);
    try { await api.ppk.sp2d.add(fyId, { ...form, amount: form.amount }); toast(`SP2D ${form.sp2d_number} dicatat.`, 'success'); setForm(empty()); rep.reload(); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Rekonsiliasi SP2D" subtitle="Cocokkan SP2D menurut SAKTI dengan pembayaran kanal SAKTI yang dicatat di tagihan. Pencocokan memakai nomor SP2D (spasi dan huruf besar/kecil diabaikan)." />
        <div className="mb-4 flex flex-wrap gap-3">
          <Select className="w-40" value={fyId} onChange={(e) => setFy(e.target.value)} aria-label="Tahun anggaran">
            {years.map((y) => <option key={y.id} value={y.id}>TA {y.year}</option>)}
          </Select>
        </div>
        {can('write') && (
          <Card className="mb-4 p-4">
            <div className="mb-2 text-sm font-semibold text-navy-900">Catat SP2D dari SAKTI</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1.4fr_1fr_1.2fr_1.6fr_auto] md:items-end">
              <Field label="Nomor SP2D" required><Input value={form.sp2d_number} onChange={(e) => setForm({ ...form, sp2d_number: e.target.value })} /></Field>
              <Field label="Tanggal SP2D" required><Input type="date" value={form.sp2d_date} onChange={(e) => setForm({ ...form, sp2d_date: e.target.value })} /></Field>
              <Field label="Nilai" required><RupiahInput aria-label="Nilai SP2D" value={form.amount} onChange={(n) => setForm({ ...form, amount: n })} /></Field>
              <Field label="Catatan"><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
              <Button disabled={busy || !form.sp2d_number.trim() || !form.sp2d_date || !form.amount} onClick={add}><Plus size={16} />Catat</Button>
            </div>
          </Card>
        )}
        {rep.error && <Empty>{rep.error}</Empty>}
        {rep.data && <>
          <div className="mb-3 flex flex-wrap gap-2" role="tablist">
            {(['semua', 'selisih_nilai', 'hanya_sakti', 'hanya_aplikasi', 'selisih_tanggal', 'cocok'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={`rounded-full border px-3 py-1 text-xs ${filter === k ? 'border-navy-800 bg-navy-800 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                {k === 'semua' ? `Semua (${rep.data!.rows.length})` : `${RECON_STATUS_LABEL[k]} (${count(k)})`}
              </button>))}
          </div>
          {!rows.length && <Empty>{rep.data.rows.length ? 'Tidak ada baris dengan status ini.' : 'Belum ada SP2D di SAKTI maupun pembayaran kanal SAKTI untuk tahun ini.'}</Empty>}
          {!!rows.length && (
            <Card className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                  <th className="px-3 py-2 text-left">Nomor SP2D</th><th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Menurut SAKTI</th><th className="px-3 py-2 text-right">Di aplikasi</th><th className="px-3 py-2 text-right">Selisih</th>
                  <th className="px-3 py-2 text-left">Tagihan</th><th />
                </tr></thead>
                <tbody>{rows.map((r) => (
                  <tr key={`${r.sp2d_number}:${r.sakti_id ?? 'app'}`} className="border-t border-slate-100 align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{r.sp2d_number}</td>
                    <td className="px-3 py-2"><Badge tone={TONE[r.status]}>{RECON_STATUS_LABEL[r.status]}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.sakti_id ? <>{rp(r.sakti_amount)}<div className="text-xs text-slate-500">{r.sakti_date}</div></> : '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{r.app_date ? <>{rp(r.app_amount)}<div className="text-xs text-slate-500">{r.app_date}</div></> : '—'}</td>
                    <td className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${r.diff ? 'text-red-700' : 'text-slate-400'}`}>{r.diff ? rp(r.diff) : '0'}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{r.bills.length ? r.bills.map((b) => <div key={b}>{b}</div>) : '—'}</td>
                    <td className="px-2 py-1.5">{r.sakti_id && can('write') &&
                      <Button size="icon" variant="ghost" title="Batalkan data SP2D" aria-label={`Batalkan SP2D ${r.sp2d_number}`} onClick={() => setVoiding(r.sakti_id)}><Ban size={15} /></Button>}</td>
                  </tr>))}
                </tbody>
              </table>
            </Card>
          )}
          <p className="mt-3 text-xs text-slate-500">Pembayaran BLU lewat FO tidak ikut rekonsiliasi ini. Data SP2D yang salah dicatat dibatalkan dengan alasan, tidak dihapus.</p>
        </>}
        {voiding && <ReasonDialog title="Batalkan data SP2D?" message="Data tetap tersimpan dengan tanda dibatalkan dan tidak lagi dipakai dalam rekonsiliasi." confirmLabel="Batalkan"
          onClose={() => setVoiding(null)}
          onSubmit={async (reason) => { try { await api.ppk.sp2d.void(voiding, reason); setVoiding(null); rep.reload(); } catch (e) { toast(errMsg(e), 'error'); } }} />}
      </PpkGate>
    </Page>
  );
}
