import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, ExternalLink, History, Plus, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useActor } from '@/features/numbering/NumberingContext';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { todayISO } from '@shared/date';
import { REGISTER_CODES, REGISTER_LABEL, STATUS_LABEL, STATUS_TONE, type BatchPreview, type NumberRecord, type NumberStatus, type RegisterCode } from '@shared/numbering';
import { cn } from '@/lib/utils';
import { DetailDialog } from './RegisterPage';

const LONG_MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const longDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return m >= 1 && m <= 12 ? `${d} ${LONG_MONTHS[m - 1]} ${y}` : iso; };
const isIso = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** BANK NOMOR DOKUMEN: nomor dibuat lebih dulu (AVAILABLE), dipilih saat membuat dokumen, terbit saat dokumen final. */
export default function BankNomorPage() {
  const { toast, confirm } = useFeedback();
  const { actor, isAdmin } = useActor();
  const [code, setCode] = useState<RegisterCode>('BERITA_ACARA');
  const year0 = new Date().getFullYear();
  const regs = useAsync(() => api.numbering.registers(), []);
  const reg = regs.data?.find((r) => r.code === code);
  const sums = useAsync(() => api.numbering.summary(year0), [year0]);
  const sum = sums.data?.find((s) => s.register.code === code);
  const [f, setF] = useState({ search: '', date: '', year: '', status: '', creator: '' });
  const [page, setPage] = useState(1);
  const dSearch = useDebounced(f.search, 300); const dCr = useDebounced(f.creator, 300);
  useEffect(() => setPage(1), [code, f.date, f.year, f.status, dSearch, dCr]);
  const size = 25;
  const list = useAsync(() => (reg ? api.numbering.records({
    register_id: reg.id, search: dSearch || undefined, creator: dCr || undefined, date: isIso(f.date) ? f.date : undefined, year: f.year ? Number(f.year) : undefined,
    status: (f.status || undefined) as NumberStatus | undefined, sort: 'seq', dir: 'desc', page, page_size: size
  }) : Promise.resolve(null)), [reg?.id, dSearch, dCr, f.date, f.year, f.status, page]);
  const [hist, setHist] = useState<string | null>(null);
  const [voidRec, setVoidRec] = useState<NumberRecord | null>(null);
  const [relRec, setRelRec] = useState<NumberRecord | null>(null);
  const [review, setReview] = useState(false);
  const refreshAll = () => { list.reload(); sums.reload(); };
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); refreshAll(); } catch (e) { toast(errMsg(e), 'error'); } };
  const canTouch = (r: NumberRecord) => !!actor && (isAdmin || r.assigned_by === actor.name);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / size)) : 1;
  const years = Array.from({ length: 8 }, (_, i) => year0 + 1 - i);

  return (
    <Page>
      <PageHeader title="BANK NOMOR DOKUMEN" subtitle="Buat nomor resmi lebih dulu, lalu pilih saat membuat dokumen. Membatalkan atau menghapus draf tidak membatalkan nomor — nomor kembali Tersedia."
        actions={<>
          {isAdmin && (sum?.review ?? 0) > 0 && <Button variant="outline" size="sm" onClick={() => setReview(true)}><ShieldCheck size={14} /> Tinjauan migrasi ({sums.data?.reduce((a, s) => a + s.review, 0)})</Button>}
          <Link to={`/register/${reg ? reg.code.toLowerCase().replace(/_/g, '-') : ''}`}><Button variant="outline" size="sm">Register</Button></Link>
        </>} />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Kategori">
        {REGISTER_CODES.map((c) => (
          <button key={c} role="tab" aria-selected={c === code} onClick={() => setCode(c)}
            className={cn('rounded-md border px-3 py-1.5 text-sm font-medium', c === code ? 'border-navy-700 bg-navy-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>{REGISTER_LABEL[c]}</button>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {([['Total Available', sum?.available, 'navy'], ['Total Assigned', sum?.assigned, 'amber'], ['Total Issued', sum?.issued, 'green'], ['Total Void', sum?.void, 'red']] as const).map(([l, n, t]) => (
          <Card key={l} className="p-3 text-center"><div className="text-2xl font-bold text-navy-900">{n ?? '—'}</div><Badge tone={t}>{l}</Badge></Card>
        ))}
      </div>

      {reg && <GeneratePanel registerId={reg.id} registerName={reg.name} onDone={refreshAll} />}

      <Card className="mb-3 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <div className="relative col-span-2 md:col-span-1"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><Input className="pl-7" placeholder="Cari nomor…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} /></div>
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} aria-label="Tanggal penomoran" />
          <Select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} aria-label="Tahun"><option value="">Semua tahun</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">Semua status</option>{(['available', 'assigned', 'issued', 'void'] as const).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</Select>
          <Input placeholder="Pembuat" value={f.creator} onChange={(e) => setF({ ...f, creator: e.target.value })} />
        </div>
      </Card>

      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>
            {['Tanggal', 'Nomor', 'Kategori', 'Status', 'Dokumen terkait', 'Pembuat', ''].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}
          </tr></thead>
          <tbody>
            {(list.data?.rows ?? []).map((r) => (
              <tr key={r.id} className={cn('border-t border-slate-100 hover:bg-slate-50', r.status === 'void' && 'text-slate-400')}>
                <td className="whitespace-nowrap px-3 py-2">{r.number_date}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.number_text}</td>
                <td className="px-3 py-2">{REGISTER_LABEL[r.register_code]}</td>
                <td className="px-3 py-2"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>{r.legacy_review && <Badge className="ml-1" tone="amber">tinjau migrasi</Badge>}{r.released_count > 0 && <span className="ml-1 text-xs text-slate-500" title="Pernah dilepas dari draf">↺{r.released_count}</span>}</td>
                <td className="px-3 py-2">{r.document_id ? <Link className="text-navy-700 hover:underline" to={`/documents/${r.document_id}`}>{r.document_title ?? 'Buka dokumen'} <ExternalLink className="inline" size={12} /></Link> : r.status === 'assigned' ? <span className="text-xs text-amber-700">draf belum disimpan ({r.assigned_by})</span> : '—'}</td>
                <td className="px-3 py-2">{r.creator}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <Button size="icon" variant="ghost" title="Riwayat" onClick={() => setHist(r.id)}><History size={14} /></Button>
                  {r.status === 'assigned' && canTouch(r) && <Button size="sm" variant="outline" onClick={() => setRelRec(r)}><RotateCcw size={13} /> Lepas</Button>}
                  {r.status === 'available' && isAdmin && <Button size="icon" variant="ghost" title="Void (admin)" onClick={() => setVoidRec(r)}><Ban size={14} /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.loading && !list.data?.rows.length && <div className="p-6"><Empty>Belum ada nomor pada filter ini. Buat nomor di panel “Buat nomor” di atas.</Empty></div>}
      </Card>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{list.data ? `${list.data.total} nomor` : ''}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
          <span>Halaman {page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</Button>
        </div>
      </div>

      <ReasonDialog rec={voidRec} title="Void nomor" confirmLabel="Void nomor" destructive onClose={() => setVoidRec(null)}
        hint="Void bersifat permanen: nomor tetap tercatat, tidak dapat dipakai, dan tidak akan dipakai ulang. Alasan dan pelaku dicatat."
        onSubmit={async (why) => { const r = voidRec!; if (!(await confirm({ title: 'Konfirmasi void', message: `Void nomor ${r.number_text}? Tindakan ini tidak dapat dibatalkan.`, confirmLabel: 'Ya, void', destructive: true }))) return; setVoidRec(null); await act(() => api.numbering.void(r.id, why, true), `Nomor ${r.number_text} di-void.`); }} />
      <ReasonDialog rec={relRec} title="Lepas nomor dari draf" confirmLabel="Lepas" onClose={() => setRelRec(null)}
        hint="Nomor kembali Tersedia dan dapat dipilih dokumen lain; riwayat penugasan tetap tersimpan."
        onSubmit={async (why) => { const r = relRec!; setRelRec(null); await act(() => api.numbering.release(r.id, why), `Nomor ${r.number_text} kembali tersedia.`); }} />
      <DetailDialog id={hist} onClose={() => setHist(null)} />
      {isAdmin && <MigrationReviewDialog open={review} onClose={() => setReview(false)} onDone={refreshAll} />}
    </Page>
  );
}

export function GeneratePanel({ registerId, registerName, onDone }: { registerId: string; registerName: string; onDone: () => void }) {
  const { toast } = useFeedback();
  const [date, setDate] = useState(todayISO());
  const [qty, setQty] = useState('1');
  const [pv, setPv] = useState<BatchPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPv(null); setError(''); }, [registerId, date, qty]);
  const n = Number(qty);
  const preview = async () => {
    setError(''); setPv(null); setBusy(true);
    try { setPv(await api.numbering.previewBatch(registerId, date, n)); } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    if (!pv) return;
    setBusy(true);
    try {
      const r = await api.numbering.generateBatch({ register_id: registerId, number_date: date, quantity: n, expect_first: pv.first, expect_last: pv.last });
      toast(`${r.records.length} nomor terdaftar (${r.batch.first_number}–${r.batch.last_number}), status Tersedia.`, 'success');
      setPv(null); onDone();
    } catch (e) { setError(errMsg(e)); setPv(null); } finally { setBusy(false); }
  };
  const ok = isIso(date) && Number.isInteger(n) && n >= 1 && n <= 500;
  return (
    <Card className="mb-4 p-4">
      <h2 className="mb-2 flex items-center gap-2 font-semibold text-navy-900"><Plus size={16} /> Buat nomor — {registerName}</h2>
      <div className="grid items-end gap-3 md:grid-cols-4">
        <Field label="Tanggal penomoran" hint={isIso(date) ? longDate(date) : undefined}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Jumlah nomor" hint="1–500; maks. 99 per kategori per tanggal (format DDSS)."><Input type="number" min={1} max={500} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Button variant="outline" onClick={preview} disabled={!ok || busy}>Pratinjau nomor</Button>
        <Button onClick={commit} disabled={!pv || busy}>Konfirmasi & daftarkan</Button>
      </div>
      {error && <div className="mt-3 flex items-start gap-2 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{error}</div>}
      {pv && (
        <div className="mt-3 rounded border border-navy-200 bg-navy-50/40 p-3 text-sm">
          <div className="mb-1 font-medium text-navy-900">Pratinjau {pv.quantity} nomor ({pv.format_label}) — {longDate(pv.date)}: {pv.first}{pv.quantity > 1 ? ` s.d. ${pv.last}` : ''} · sisa kapasitas tanggal ini {pv.remaining}</div>
          <div className="flex max-h-28 flex-wrap gap-1 overflow-auto">{pv.numbers.map((t) => <span key={t} className="rounded bg-white px-1.5 py-0.5 font-mono text-xs ring-1 ring-slate-300">{t}</span>)}</div>
          <p className="mt-2 text-xs text-slate-600">Belum tersimpan. Tekan “Konfirmasi & daftarkan” untuk mendaftarkan semuanya sekaligus (atomik); status awal Tersedia.</p>
        </div>
      )}
    </Card>
  );
}

function ReasonDialog({ rec, onClose, onSubmit, title, hint, confirmLabel, destructive }: { rec: NumberRecord | null; onClose: () => void; onSubmit: (reason: string) => void | Promise<void>; title: string; hint: string; confirmLabel: string; destructive?: boolean }) {
  const [why, setWhy] = useState('');
  useEffect(() => { setWhy(''); }, [rec]);
  return (
    <Dialog open={!!rec} onOpenChange={(o) => { if (!o) onClose(); }}>
      {rec && <DialogContent title={title} description={`${rec.number_text} · ${rec.number_date}`} footer={<><Button variant="outline" onClick={onClose}>Tutup</Button><Button variant={destructive ? 'destructive' : 'default'} disabled={why.trim().length < 3} onClick={() => void onSubmit(why)}>{confirmLabel}</Button></>}>
        <Field label="Alasan (wajib)" hint={hint}><Textarea value={why} onChange={(e) => setWhy(e.target.value)} autoFocus /></Field>
      </DialogContent>}
    </Dialog>
  );
}

/** Tinjauan migrasi (admin): catatan yang statusnya tidak dapat dipastikan (dipesan tanpa dokumen) tidak diasumsikan tersedia. */
function MigrationReviewDialog({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const rv = useAsync(() => (open ? api.numbering.migrationReview() : Promise.resolve(null)), [open]);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [why, setWhy] = useState('');
  useEffect(() => { setSel({}); setWhy(''); }, [open, rv.data]);
  const ids = Object.keys(sel).filter((k) => sel[k]);
  const run = async (action: 'release' | 'void') => {
    try { const n = await api.numbering.resolveLegacy(ids, action, why); toast(`${n} nomor ${action === 'release' ? 'dijadikan tersedia' : 'di-void'}.`, 'success'); rv.reload(); onDone(); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  const c = rv.data?.counts;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent wide title="Tinjauan migrasi bank nomor" description="Pratinjau pemetaan data lama. Tidak ada nomor, tanggal, atau urutan yang diubah.">
        {c && <div className="mb-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <Card className="p-2 text-center"><b>{c.issued}</b><div className="text-xs text-slate-500">Terbit (tetap)</div></Card>
          <Card className="p-2 text-center"><b>{c.void}</b><div className="text-xs text-slate-500">Void (dari “dibatalkan”)</div></Card>
          <Card className="p-2 text-center"><b>{c.assigned_with_document}</b><div className="text-xs text-slate-500">Dipakai draf (punya dokumen)</div></Card>
          <Card className="p-2 text-center"><b>{c.pending_review}</b><div className="text-xs text-slate-500">Menunggu tinjauan</div></Card>
        </div>}
        <p className="mb-2 text-xs text-slate-600">Nomor “dipesan tanpa dokumen” dari versi lama tidak diasumsikan tersedia. Periksa pemakaian sebenarnya, lalu jadikan tersedia atau void.</p>
        <div className="max-h-[38vh] overflow-auto rounded border border-slate-200">
          <table className="w-full text-sm"><tbody>
            {(rv.data?.pending ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100 first:border-0">
                <td className="px-2 py-1"><input type="checkbox" aria-label={`Pilih ${r.number_text}`} checked={!!sel[r.id]} onChange={(e) => setSel({ ...sel, [r.id]: e.target.checked })} /></td>
                <td className="px-2 py-1 font-mono text-xs">{r.number_text}</td><td className="px-2 py-1">{REGISTER_LABEL[r.register_code]}</td><td className="px-2 py-1">{r.number_date}</td><td className="px-2 py-1 text-slate-600">{r.creator}</td>
              </tr>
            ))}
          </tbody></table>
          {rv.data && !rv.data.pending.length && <div className="p-4"><Empty>Tidak ada catatan yang menunggu tinjauan.</Empty></div>}
        </div>
        <div className="mt-3 grid items-end gap-2 md:grid-cols-[1fr_auto_auto]">
          <Field label="Alasan peninjauan (wajib)"><Input value={why} onChange={(e) => setWhy(e.target.value)} /></Field>
          <Button variant="outline" disabled={!ids.length || why.trim().length < 3} onClick={() => run('release')}>Jadikan tersedia</Button>
          <Button variant="destructive" disabled={!ids.length || why.trim().length < 3} onClick={() => run('void')}>Void</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
