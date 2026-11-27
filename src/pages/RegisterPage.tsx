import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowDown, ArrowUp, Ban, CheckCircle2, ExternalLink, FileSpreadsheet, FileText, Plus, Search, Upload } from 'lucide-react';
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
import { REGISTER_CODES, REGISTER_PATH, STATUS_LABEL as NUM_STATUS, STATUS_TONE, type NumberRecord, type RecordQuery, type RegisterCode } from '@shared/numbering';
import { cn } from '@/lib/utils';

type SortKey = NonNullable<RecordQuery['sort']>;
const COLS: Array<{ key: SortKey; label: string }> = [
  { key: 'number_date', label: 'Tanggal' }, { key: 'number_text', label: 'Nomor' }, { key: 'counterparty', label: 'Pihak' },
  { key: 'subject', label: 'Perihal' }, { key: 'creator', label: 'Pembuat' }, { key: 'status', label: 'Status' }
];

export function registerCodeFromPath(p: string | undefined): RegisterCode | null {
  return REGISTER_CODES.find((c) => REGISTER_PATH[c] === p) ?? null;
}

export default function RegisterPage() {
  const { slug } = useParams();
  const code = registerCodeFromPath(slug);
  const regs = useAsync(() => api.numbering.registers(), []);
  const reg = regs.data?.find((r) => r.code === code);
  const { toast } = useFeedback();
  const { actor, isAdmin } = useActor();
  const [f, setF] = useState({ search: '', year: '', status: '', date_from: '', date_to: '', subject: '', counterparty: '', creator: '' });
  const [sort, setSort] = useState<SortKey>('number_date');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const size = 25;
  const dSearch = useDebounced(f.search, 300); const dSub = useDebounced(f.subject, 300); const dCp = useDebounced(f.counterparty, 300); const dCr = useDebounced(f.creator, 300);
  const query = useMemo<RecordQuery | null>(() => reg ? {
    register_id: reg.id, search: dSearch || undefined, subject: dSub || undefined, counterparty: dCp || undefined, creator: dCr || undefined,
    year: f.year ? Number(f.year) : undefined, status: (f.status || undefined) as RecordQuery['status'], date_from: f.date_from || undefined, date_to: f.date_to || undefined,
    sort, dir, page, page_size: size
  } : null, [reg, dSearch, dSub, dCp, dCr, f.year, f.status, f.date_from, f.date_to, sort, dir, page]);
  const list = useAsync(() => (query ? api.numbering.records(query) : Promise.resolve(null)), [JSON.stringify(query)]);
  useEffect(() => { setPage(1); }, [dSearch, dSub, dCp, dCr, f.year, f.status, f.date_from, f.date_to, code]);
  const [detail, setDetail] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [cancel, setCancel] = useState<NumberRecord | null>(null);
  const [edit, setEdit] = useState<NumberRecord | null>(null);
  const [release, setRelease] = useState<NumberRecord | null>(null);

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); list.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  const sortBy = (k: SortKey) => { if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('asc'); } };
  const exportQ = (): RecordQuery => ({ ...(query as RecordQuery), page: undefined, page_size: undefined });
  const doExport = async (kind: 'xlsx' | 'pdf') => {
    try { const r = kind === 'xlsx' ? await api.numbering.exportXlsx(exportQ()) : await api.numbering.exportPdf(exportQ()); if (!r.canceled) toast(`Register diekspor ke ${r.path}`, 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  const canTouch = (r: NumberRecord) => !!actor && (isAdmin || r.assigned_by === actor.name || r.creator_id === actor.id);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / size)) : 1;
  const years = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i);

  if (!code) return <Page><Empty>Register tidak dikenal.</Empty></Page>;
  return (
    <Page>
      <PageHeader title={`Register ${reg?.name ?? ''}`} subtitle="Nomor resmi hanya dibuat oleh sistem (Bank Nomor Dokumen). Nomor terbit/void tidak dapat dihapus atau dipakai ulang."
        actions={<>
          <Button variant="outline" size="sm" onClick={() => doExport('xlsx')}><FileSpreadsheet size={14} /> Excel</Button>
          <Button variant="outline" size="sm" onClick={() => doExport('pdf')}><FileText size={14} /> PDF</Button>
          {isAdmin && <Link to={`/penomoran/impor?register=${code}`}><Button variant="outline" size="sm"><Upload size={14} /> Impor Excel</Button></Link>}
          <Button size="sm" onClick={() => setCreate(true)}><Plus size={14} /> Catat Nomor</Button>
        </>} />
      <Card className="mb-4 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <div className="relative col-span-2"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><Input className="pl-7" placeholder="Cari nomor, perihal, pihak…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} /></div>
          <Select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} aria-label="Tahun"><option value="">Semua tahun</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
          <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">Semua status</option>{(['available', 'assigned', 'issued', 'void'] as const).map((s) => <option key={s} value={s}>{NUM_STATUS[s]}</option>)}</Select>
          <Input type="date" value={f.date_from} onChange={(e) => setF({ ...f, date_from: e.target.value })} aria-label="Dari tanggal" />
          <Input type="date" value={f.date_to} onChange={(e) => setF({ ...f, date_to: e.target.value })} aria-label="Sampai tanggal" />
          <Input placeholder="Perihal" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <Input placeholder="Pihak" value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />
          <Input placeholder="Pembuat" value={f.creator} onChange={(e) => setF({ ...f, creator: e.target.value })} />
          <Button variant="ghost" size="sm" onClick={() => setF({ search: '', year: '', status: '', date_from: '', date_to: '', subject: '', counterparty: '', creator: '' })}>Reset filter</Button>
        </div>
      </Card>
      {list.error && <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{list.error}</div>}
      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>{COLS.map((c) => (
              <th key={c.key} className="cursor-pointer select-none px-3 py-2 text-left" onClick={() => sortBy(c.key)}>
                <span className="inline-flex items-center gap-1">{c.label}{sort === c.key && (dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</span>
              </th>))}<th className="px-3 py-2 text-right">Aksi</th></tr>
          </thead>
          <tbody>
            {(list.data?.rows ?? []).map((r) => {
              const st = r.status;
              return (
                <tr key={r.id} className={cn('border-t border-slate-100 hover:bg-slate-50', r.status === 'void' && 'text-slate-400')}>
                  <td className="px-3 py-2 whitespace-nowrap">{r.number_date}</td>
                  <td className="px-3 py-2"><button className="text-left font-mono text-xs text-navy-800 hover:underline" onClick={() => setDetail(r.id)}>{r.number_text}</button></td>
                  <td className="px-3 py-2">{r.counterparty}</td><td className="px-3 py-2">{r.subject}</td><td className="px-3 py-2">{r.creator}</td>
                  <td className="px-3 py-2"><Badge tone={STATUS_TONE[st]}>{NUM_STATUS[st]}</Badge>{r.legacy_review && <Badge className="ml-1" tone="amber">tinjau migrasi</Badge>}{r.source === 'import' && <Badge className="ml-1" tone="slate">impor</Badge>}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.document_id && <Link to={`/documents/${r.document_id}`}><Button size="icon" variant="ghost" title="Buka dokumen"><ExternalLink size={14} /></Button></Link>}
                    {r.status === 'assigned' && canTouch(r) && <Button size="icon" variant="ghost" title="Terbitkan" onClick={() => act(() => api.numbering.issue(r.id), 'Nomor diterbitkan.')}><CheckCircle2 size={14} /></Button>}
                    {r.status === 'assigned' && canTouch(r) && <Button size="sm" variant="outline" onClick={() => setRelease(r)}>Lepas</Button>}
                    {r.status === 'available' && isAdmin && <Button size="icon" variant="ghost" title="Void (admin)" onClick={() => setCancel(r)}><Ban size={14} /></Button>}
                    {r.status !== 'void' && canTouch(r) && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Ubah</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.loading && !list.data?.rows.length && <div className="p-6"><Empty>Belum ada catatan nomor pada filter ini.</Empty></div>}
      </Card>
      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{list.data ? `${list.data.total} catatan` : ''}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</Button>
          <span>Halaman {page} / {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Berikutnya</Button>
        </div>
      </div>

      {reg && <CreateDialog open={create} onClose={() => setCreate(false)} registerId={reg.id} isAdmin={isAdmin} actorName={actor?.name ?? ""} onDone={() => { setCreate(false); list.reload(); }} />}
      <CancelDialog rec={cancel} onClose={() => setCancel(null)} title="Void nomor" onSubmit={(why) => act(async () => { await api.numbering.void(cancel!.id, why, true); setCancel(null); }, 'Nomor di-void.')}
        hint="Void bersifat permanen: nomor tetap tercatat, tidak dapat dipakai, dan tidak akan dipakai ulang. Pelaku dan alasan dicatat." />
      <CancelDialog rec={release} onClose={() => setRelease(null)} title="Lepas nomor dari draf" confirmLabel="Lepas" destructive={false} onSubmit={(why) => act(async () => { await api.numbering.release(release!.id, why); setRelease(null); }, 'Nomor kembali tersedia.')}
        hint="Nomor kembali AVAILABLE dan dapat dipilih dokumen lain; riwayat penugasan tetap tersimpan." />
      <EditDialog rec={edit} isAdmin={isAdmin} onClose={() => setEdit(null)} onDone={() => { setEdit(null); list.reload(); }} />
      <DetailDialog id={detail} onClose={() => setDetail(null)} />
    </Page>
  );
}

function CancelDialog({ rec, onClose, onSubmit, title, hint, confirmLabel = 'Konfirmasi', destructive = true }: { rec: NumberRecord | null; onClose: () => void; onSubmit: (reason: string) => void; title: string; hint?: string; confirmLabel?: string; destructive?: boolean }) {
  const [why, setWhy] = useState('');
  useEffect(() => { setWhy(''); }, [rec]);
  return (
    <Dialog open={!!rec} onOpenChange={(o) => { if (!o) onClose(); }}>
      {rec && <DialogContent title={title} description={rec.number_text} footer={<><Button variant="outline" onClick={onClose}>Tutup</Button><Button variant={destructive ? 'destructive' : 'default'} disabled={why.trim().length < 3} onClick={() => onSubmit(why)}>{confirmLabel}</Button></>}>
        <Field label="Alasan (wajib)" hint={hint ?? 'Alasan dicatat pada riwayat.'}><Textarea value={why} onChange={(e) => setWhy(e.target.value)} autoFocus /></Field>
      </DialogContent>}
    </Dialog>
  );
}

function CreateDialog({ open, onClose, registerId, isAdmin, actorName, onDone }: { open: boolean; onClose: () => void; registerId: string; isAdmin: boolean; actorName: string; onDone: () => void }) {
  const { toast } = useFeedback();
  const [v, setV] = useState({ number_date: todayISO(), subject: '', counterparty: '', notes: '', creator: actorName, seq: '', number_text: '' });
  useEffect(() => { if (open) setV((x) => ({ ...x, creator: x.creator || actorName })); }, [open, actorName]);
  const [busy, setBusy] = useState(false);
  const next = useAsync(() => (open && /^\d{4}-\d{2}-\d{2}$/.test(v.number_date) ? api.numbering.next(registerId, v.number_date) : Promise.resolve(null)), [open, registerId, v.number_date]);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.numbering.createManual({ register_id: registerId, number_date: v.number_date, subject: v.subject, counterparty: v.counterparty, notes: v.notes, creator: v.creator.trim() || actorName, ...(isAdmin && v.number_text ? { number_text: v.number_text } : isAdmin && v.seq ? { seq: Number(v.seq) } : {}) });
      toast(`Nomor ${r.number_text} dicatat sebagai terbit.`, 'success'); onDone();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="Catat nomor" description="Untuk nomor yang digunakan di luar aplikasi. Nomor berikutnya otomatis; nomor langsung berstatus Terbit."
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={submit} disabled={busy}>Catat</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tanggal penomoran" required><Input type="date" value={v.number_date} onChange={(e) => setV({ ...v, number_date: e.target.value })} /></Field>
          <Field label="Nomor berikutnya"><Input readOnly value={next.data?.preview ?? ''} className="bg-slate-100 font-mono text-xs" /></Field>
          <Field label="Pihak"><Input value={v.counterparty} onChange={(e) => setV({ ...v, counterparty: e.target.value })} /></Field>
          <Field label="Perihal"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
          <Field label="Pembuat nomor" hint="Nama pembuat/pemohon nomor; bawaan pengguna aktif."><Input value={v.creator} onChange={(e) => setV({ ...v, creator: e.target.value })} /></Field>
          <Field label="Keterangan"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          {isAdmin && <>
            <Field label="Nomor urut tertentu (admin)" hint="Kosongkan untuk otomatis."><Input type="number" min={1} value={v.seq} onChange={(e) => setV({ ...v, seq: e.target.value, number_text: '' })} /></Field>
            <Field label="atau nomor lengkap (admin)" hint="Harus sesuai format register."><Input value={v.number_text} onChange={(e) => setV({ ...v, number_text: e.target.value, seq: '' })} /></Field>
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ rec, isAdmin, onClose, onDone }: { rec: NumberRecord | null; isAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useFeedback();
  const [v, setV] = useState({ subject: '', counterparty: '', notes: '', creator: '' });
  useEffect(() => { if (rec) setV({ subject: rec.subject, counterparty: rec.counterparty, notes: rec.notes, creator: rec.creator }); }, [rec]);
  const submit = async () => { try { await api.numbering.updateMeta({ id: rec!.id, subject: v.subject, counterparty: v.counterparty, notes: v.notes, ...(isAdmin ? { creator: v.creator } : {}) }); toast('Catatan diperbarui.', 'success'); onDone(); } catch (e) { toast(errMsg(e), 'error'); } };
  return (
    <Dialog open={!!rec} onOpenChange={(o) => { if (!o) onClose(); }}>
      {rec && <DialogContent title="Ubah keterangan" description={`${rec.number_text} — nomor, tahun, dan tanggal tidak dapat diubah.`} footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button onClick={submit}>Simpan</Button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pihak"><Input value={v.counterparty} onChange={(e) => setV({ ...v, counterparty: e.target.value })} /></Field>
          <Field label="Perihal"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
          <Field label="Keterangan" className="col-span-2"><Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
          {isAdmin && <Field label="Pembuat (admin)"><Input value={v.creator} onChange={(e) => setV({ ...v, creator: e.target.value })} /></Field>}
        </div>
      </DialogContent>}
    </Dialog>
  );
}

export function DetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const d = useAsync(() => (id ? api.numbering.record(id) : Promise.resolve(null)), [id]);
  const r = d.data?.record;
  return (
    <Dialog open={!!id} onOpenChange={(o) => { if (!o) onClose(); }}>
      {id && <DialogContent wide title={r?.number_text ?? 'Memuat…'} description={r ? `${r.register_code} · tahun ${r.year}` : undefined}>
        {r && <div className="grid gap-4 md:grid-cols-2">
          <dl className="space-y-1 text-sm">
            {([['Status', NUM_STATUS[r.status]], ['Tanggal penomoran', r.number_date], ['Pihak', r.counterparty || '—'], ['Perihal', r.subject || '—'], ['Keterangan', r.notes || '—'], ['Pembuat nomor', r.creator], ['Sumber', r.source],
              ['Dibuat', r.generated_at ? `${r.generated_at.slice(0, 16).replace('T', ' ')} oleh ${r.generated_by ?? '—'}` : '—'], ['Dipilih draf', r.assigned_at ? `${r.assigned_at.slice(0, 16).replace('T', ' ')} oleh ${r.assigned_by}` : '—'],
              ['Terbit', r.issued_at ? `${r.issued_at.slice(0, 16).replace('T', ' ')} oleh ${r.issued_by}` : '—'], ['Void', r.voided_at ? `${r.voided_at.slice(0, 16).replace('T', ' ')} oleh ${r.voided_by}: ${r.void_reason}` : '—'],
              ['Pernah dilepas', String(r.released_count)]] as Array<[string, string]>)
              .map(([k, val]) => <div key={k} className="flex gap-2"><dt className="w-36 shrink-0 text-slate-500">{k}</dt><dd className="break-words">{val}</dd></div>)}
            {r.document_id && <div className="pt-2"><Link className="text-navy-700 underline" to={`/documents/${r.document_id}`}>Buka dokumen: {r.document_title}</Link></div>}
            {!!d.data?.referenced_by.length && <div className="pt-2"><div className="text-slate-500">Dirujuk oleh dokumen:</div>{d.data.referenced_by.map((x) => <div key={x.document_id + x.key}><Link className="text-navy-700 underline" to={`/documents/${x.document_id}`}>{x.title}</Link> <span className="text-xs text-slate-500">({x.key})</span></div>)}</div>}
          </dl>
          <div>
            <div className="mb-1 text-sm font-semibold text-navy-900">Riwayat</div>
            <ol className="space-y-2 border-l-2 border-slate-200 pl-3 text-sm">
              {d.data!.events.map((e) => <li key={e.id}><div className="font-medium">{e.event.replace('_', ' ')}</div><div className="text-xs text-slate-500">{e.at.slice(0, 16).replace('T', ' ')} · {e.actor_name}</div>
                {Object.keys(e.detail).length > 0 && <div className="break-words text-xs text-slate-600">{Object.entries(e.detail).filter(([, x]) => x !== null && typeof x !== 'object').map(([k, x]) => `${k}: ${String(x)}`).join(' · ')}</div>}</li>)}
            </ol>
          </div>
        </div>}
      </DialogContent>}
    </Dialog>
  );
}
