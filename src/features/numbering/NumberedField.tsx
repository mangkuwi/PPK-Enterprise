import { useState } from 'react';
import { CalendarClock, Hash, Link2, Lock, RefreshCw, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { FieldInput } from '@/features/generator/FieldInput';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { useActor } from './NumberingContext';
import { todayISO } from '@shared/date';
import { GeneratePanel } from '@/pages/BankNomorPage';
import { REGISTER_LABEL, STATUS_LABEL, STATUS_TONE } from '@shared/numbering';
import type { NumberingState } from './useNumbering';
import type { TemplateField } from '@shared/types';

/** Bagian "PILIH NOMOR DOKUMEN": selalu tampil di atas formulir, tidak bergantung pada ada-tidaknya isian nomor di template. */
export function NumberBanner({ n }: { n: NumberingState }) {
  const { toast } = useFeedback();
  const { isAdmin } = useActor();
  const [picker, setPicker] = useState(false);
  const regs = useAsync(() => (n.ctx && !n.ctx.register ? api.numbering.registers() : Promise.resolve([])), [n.ctx]);
  const [mapTo, setMapTo] = useState('');
  if (n.loading) return <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">Memuat pengaturan penomoran…</div>;
  if (n.error) return (
    <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      Penomoran tidak dapat dimuat: {n.error}
      <Button size="sm" variant="outline" className="ml-3" onClick={n.retry}>Coba lagi</Button>
    </div>
  );
  if (!n.ctx) return null;
  if (!n.ctx.register) {
    return (
      <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
        <div className="font-semibold text-navy-900">PILIH NOMOR DOKUMEN</div>
        <p className="mt-1 text-xs text-slate-700">Template/kategori ini belum dihubungkan ke register penomoran, sehingga belum ada nomor yang dapat dipilih.
          {isAdmin ? ' Pilih register lalu hubungkan (berlaku untuk template ini; isian formulir tidak hilang).' : ' Minta administrator menghubungkannya di Pengaturan Nomor → Pemetaan.'}</p>
        {isAdmin && n.templateId && (
          <div className="mt-2 flex gap-2">
            <Select value={mapTo} onChange={(e) => setMapTo(e.target.value)} aria-label="Register"><option value="">— pilih register —</option>{(regs.data ?? []).filter((r) => r.is_active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
            <Button size="sm" disabled={!mapTo} onClick={async () => { try { await api.numbering.setTemplateMap(n.templateId!, mapTo); n.retry(); } catch (e) { toast(errMsg(e), 'error'); } }}>Hubungkan</Button>
          </div>
        )}
      </div>
    );
  }
  const reg = n.ctx.register; const r = n.record;
  return (
    <div className={r ? 'mb-4 rounded border border-navy-200 bg-navy-50/50 p-3' : 'mb-4 rounded border border-amber-300 bg-amber-50 p-3'}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Lock size={14} className="text-navy-700" />
        <span className="font-semibold text-navy-900">PILIH NOMOR DOKUMEN — {reg.name}:</span>
        <span className="font-mono">{r?.number_text ?? 'belum dipilih'}</span>
        {r && <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>}
        {r && <span className="text-xs text-slate-600">tanggal {r.number_date} · {REGISTER_LABEL[r.register_code]}</span>}
        <Button size="sm" variant={r ? 'outline' : 'default'} className="ml-auto" onClick={() => setPicker(true)}><Hash size={14} /> {r ? 'Ganti nomor' : 'Pilih nomor'}</Button>
        {r && <Button size="sm" variant="ghost" onClick={async () => { try { await n.clear(); } catch (e) { toast(errMsg(e), 'error'); } }}>Lepas</Button>}
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {r
          ? `Nomor dari Bank Nomor Dokumen, diisikan ke ${n.ctx.own_keys.length ? n.ctx.own_keys.map((k) => `[${k}]`).join(', ') : 'dokumen'}. Terbit saat dokumen difinalkan; membatalkan draf mengembalikan nomor menjadi Tersedia.`
          : 'Pilih nomor Tersedia dari Bank Nomor Dokumen. Sistem tidak membuat nomor otomatis dan AI tidak membuat nomor resmi.'}
        {!n.ctx.own_keys.length && ` Template ini tidak memiliki isian ${reg.placeholder_keys.map((k) => `[${k}]`).join('/')}; nomor tetap tertaut ke dokumen tetapi tidak tercetak otomatis.`}
      </p>
      <AvailablePicker open={picker} onClose={() => setPicker(false)} registerId={reg.id} registerName={reg.name} currentId={r?.id ?? null}
        onPick={async (x) => { try { await n.select(x); setPicker(false); toast('Nomor dokumen berhasil ditugaskan.', 'success'); } catch (er) { toast(`${errMsg(er)} Silakan pilih nomor lain.`, 'error'); } }} />
    </div>
  );
}

/** Isian formulir yang sadar penomoran: nomor read-only, tanggal memesan ulang, kolom rujukan memakai pemilih. */
export function NumberedField({ field, value, onChange, n }: { field: TemplateField; value: string; onChange: (v: string) => void; n: NumberingState }) {
  const { toast } = useFeedback();
  const [picker, setPicker] = useState(false);
  const [numPicker, setNumPicker] = useState(false);
  const c = n.ctx;
  if (c?.register) {
    const reg = c.register;
    if (c.own_keys.includes(field.key)) {
      const rec = n.record;
      return (
        <div>
          <div className="flex gap-2">
            <Input readOnly value={rec?.number_text ?? ''} placeholder="Belum dipilih — pilih dari Bank Nomor Dokumen" className="bg-slate-100 font-mono" aria-label={field.label} />
            <Button type="button" variant="outline" onClick={() => setNumPicker(true)}><Hash size={14} /> {rec ? 'Ganti' : 'Pilih'}</Button>
            {rec && <Button type="button" variant="ghost" size="icon" aria-label="Lepas nomor" title="Lepas nomor (kembali Tersedia)" onClick={async () => { try { await n.clear(); } catch (er) { toast(errMsg(er), 'error'); } }}><X size={14} /></Button>}
          </div>
          <p className="mt-1 text-xs text-slate-500">Nomor tidak diketik manual. Memilih menugaskan nomor ke draf ini; mengganti melepas nomor lama (kembali Tersedia).</p>
          <AvailablePicker open={numPicker} onClose={() => setNumPicker(false)} registerId={reg.id} registerName={reg.name} currentId={rec?.id ?? null}
            onPick={async (r) => { try { await n.select(r); setNumPicker(false); toast('Nomor dokumen berhasil ditugaskan.', 'success'); } catch (er) { toast(`${errMsg(er)} Silakan pilih nomor lain.`, 'error'); } }} />
        </div>
      );
    }
    if (c.date_key === field.key) {
      return (
        <div>
          <Input type="date" readOnly value={n.record?.number_date ?? ''} className="bg-slate-100" aria-label={field.label} />
          <div className="mt-1 flex items-center gap-1 text-xs text-slate-500"><CalendarClock size={12} /> Tanggal mengikuti tanggal penomoran nomor yang dipilih (DD = hari, SS = urutan harian).</div>
        </div>
      );
    }
    const ref = c.ref_fields.find((f) => f.key === field.key);
    if (ref) {
      const picked = n.refs[field.key];
      return (
        <div>
          <div className="flex gap-2">
            <Input readOnly value={picked?.number_text ?? ''} placeholder={`Pilih nomor ${ref.register_name} yang sudah terbit`} className="bg-slate-50 font-mono" />
            <Button type="button" variant="outline" onClick={() => setPicker(true)}><Link2 size={14} /> Pilih</Button>
            {picked && <Button type="button" variant="ghost" size="icon" aria-label="Hapus rujukan" onClick={() => { n.setRef(field.key, null); onChange(''); }}><X size={14} /></Button>}
          </div>
          <p className="mt-1 text-xs text-slate-500">Merujuk nomor yang sudah ada; tidak membuat nomor baru di register {ref.register_name}.</p>
          <ReferencePicker open={picker} onClose={() => setPicker(false)} registerId={ref.register_id} registerName={ref.register_name}
            onPick={(r) => { n.setRef(field.key, r); onChange(r.number_text); setPicker(false); }} />
        </div>
      );
    }
  }
  return <FieldInput field={field} value={value} onChange={onChange} />;
}

function ReferencePicker({ open, onClose, registerId, registerName, onPick }: { open: boolean; onClose: () => void; registerId: string; registerName: string; onPick: (r: import('@shared/numbering').NumberRecord) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const res = useAsync(() => (open ? api.numbering.search(registerId, dq) : Promise.resolve([])), [open, registerId, dq]);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`Pilih nomor ${registerName}`} description="Hanya nomor berstatus terbit atau dipakai draf yang dapat dirujuk." wide>
        <div className="relative mb-3"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><Input className="pl-7" placeholder="Cari nomor, perihal, atau pihak…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
        <div className="max-h-[50vh] overflow-auto rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-2 py-1 text-left">Nomor</th><th className="px-2 py-1 text-left">Tanggal</th><th className="px-2 py-1 text-left">Pihak</th><th className="px-2 py-1 text-left">Perihal</th><th /></tr></thead>
            <tbody>{(res.data ?? []).map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-2 py-1 font-mono text-xs">{r.number_text}</td><td className="px-2 py-1">{r.number_date}</td><td className="px-2 py-1">{r.counterparty}</td><td className="px-2 py-1">{r.subject}</td>
                <td className="px-2 py-1 text-right"><Button size="sm" onClick={() => onPick(r)}>Pilih</Button></td>
              </tr>))}
            </tbody>
          </table>
          {!res.loading && !(res.data ?? []).length && <div className="p-4 text-center text-sm text-slate-500">Tidak ada nomor yang cocok.</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** PILIH NOMOR DOKUMEN: default hanya AVAILABLE pada tanggal dokumen (hari ini); tanggal lain butuh konfirmasi eksplisit. */
function AvailablePicker({ open, onClose, registerId, registerName, currentId, onPick }: { open: boolean; onClose: () => void; registerId: string; registerName: string; currentId: string | null; onPick: (r: import('@shared/numbering').NumberRecord) => void | Promise<void> }) {
  const { confirm } = useFeedback();
  const today = todayISO();
  const [q, setQ] = useState('');
  const [date, setDate] = useState(today);
  const [all, setAll] = useState(false);
  const dq = useDebounced(q, 250);
  const res = useAsync(() => (open ? api.numbering.available({ register_id: registerId, search: dq || undefined, date: date || undefined, include_all: all, limit: 200 }) : Promise.resolve([])), [open, registerId, dq, date, all]);
  const rows = res.data ?? [];
  const avail = rows.filter((r) => r.status === 'available');
  const pick = async (r: import('@shared/numbering').NumberRecord) => {
    if (r.number_date !== today && !(await confirm({ title: 'Tanggal nomor berbeda', message: `Nomor ${r.number_text} bertanggal ${r.number_date}, bukan hari ini. Tanggal dokumen akan mengikuti tanggal nomor. Lanjutkan?`, confirmLabel: 'Ya, pakai nomor ini' }))) return;
    try { await onPick(r); } finally { res.reload(); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title="PILIH NOMOR DOKUMEN" description={`Kategori ${registerName}. Hanya nomor Tersedia yang dapat dipilih.`} wide>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="relative min-w-[180px] flex-1"><Search size={14} className="absolute left-2 top-2.5 text-slate-400" /><Input className="pl-7" placeholder="Cari nomor…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
          <Input type="date" className="w-44" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Tanggal penomoran" />
          <Button type="button" variant="outline" size="sm" onClick={() => setDate('')}>Semua tanggal</Button>
          <Button type="button" variant="outline" size="icon" aria-label="Muat ulang" onClick={res.reload}><RefreshCw size={14} /></Button>
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Semua status (baca-saja)</label>
        </div>
        <div className="mb-2 text-xs text-slate-600">{res.loading ? 'Memuat nomor tersedia…' : `${avail.length} nomor tersedia${date ? ` untuk ${date}` : ''}`}</div>
        <div className="max-h-[40vh] overflow-auto rounded border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-2 py-1 text-left">Nomor</th><th className="px-2 py-1 text-left">Tanggal</th><th className="px-2 py-1 text-left">Kategori</th><th className="px-2 py-1 text-left">Status</th><th className="px-2 py-1 text-left">Riwayat</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-2 py-1 font-mono text-xs">{r.number_text}</td><td className="px-2 py-1">{r.number_date}</td><td className="px-2 py-1">{REGISTER_LABEL[r.register_code]}</td>
                <td className="px-2 py-1"><Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
                <td className="px-2 py-1 text-xs text-slate-500">{r.released_count > 0 ? `pernah dilepas ${r.released_count}×` : '—'}</td>
                <td className="px-2 py-1 text-right">{r.status === 'available' && r.id !== currentId ? <Button size="sm" onClick={() => void pick(r)}>Pilih</Button> : r.id === currentId ? <span className="text-xs text-slate-500">terpilih</span> : null}</td>
              </tr>))}
            </tbody>
          </table>
          {!res.loading && !rows.length && <div className="p-4 text-center text-sm text-slate-500">Tidak ada nomor tersedia. Buat nomor di bawah ini; data draf Anda tidak hilang.</div>}
        </div>
        <details className="mt-3" open={!res.loading && !avail.length}>
          <summary className="cursor-pointer text-sm font-medium text-navy-700">Buat nomor baru di Bank Nomor ({registerName})</summary>
          <div className="mt-2"><GeneratePanel registerId={registerId} registerName={registerName} onDone={res.reload} /></div>
        </details>
      </DialogContent>
    </Dialog>
  );
}
