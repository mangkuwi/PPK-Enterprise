import { Fragment, useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import type { SaveResult } from '@/services/api';
import { Select } from '@/components/ui/form';
import { projectOptions } from '@shared/ppk/contracts';

/** Gaya tabel database PPK, sama dengan tabel Prognosis: header & total lengket, kolom pertama terkunci, rupiah penuh rata kanan. */
export const TBL = {
  card: 'max-h-[70vh] overflow-auto',
  table: 'w-full border-separate border-spacing-0 text-[13px]',
  head: 'sticky top-0 z-20 bg-slate-50 text-xs text-slate-600',
  th: 'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-semibold',
  thNum: 'whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3 py-2 text-right font-semibold',
  td: 'border-b border-slate-100 px-3 py-2 align-top',
  num: 'min-w-[8.5rem] whitespace-nowrap border-b border-slate-100 px-3 py-2 text-right align-top tabular-nums',
  /** Kolom identitas yang tetap terlihat saat tabel digeser ke kanan. */
  first: 'sticky left-0 z-10 w-64 min-w-64 max-w-64 [overflow-wrap:anywhere] border-r border-slate-200 bg-white group-hover:bg-slate-50',
  foot: 'sticky bottom-0 z-20 border-t-2 border-slate-300 bg-slate-100 px-3 py-2 font-semibold',
  row: 'group hover:bg-slate-50'
};

/** Tombol Ekspor Excel: memanggil kanal ekspor lalu memberi tahu lokasi berkas. */
export function ExportButton({ run, disabled }: { run: () => Promise<SaveResult>; disabled?: boolean }) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const x = await run(); if (!x.canceled) toast(`Tersimpan: ${x.path}`, 'success'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return <Button variant="outline" onClick={go} disabled={disabled || busy}><Download size={16} />{busy ? 'Mengekspor…' : 'Ekspor Excel'}</Button>;
}

/** Nomor dokumen panjang dipatahkan setelah garis miring, bukan di tengah kata (tanpa menyisipkan karakter saat disalin). */
export const SlashWrap = ({ text }: { text: string }) =>
  <>{text.split('/').map((p, i, a) => <Fragment key={i}>{p}{i < a.length - 1 && <>/<wbr /></>}</Fragment>)}</>;

/** Filter jenis project (IP HUB, IP Transit, SATRIA 1, ...), pilihannya dari project kontrak yang ada. */
export function ProjectFilter({ projects, value, onChange }: { projects: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select className="w-48" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Filter project">
      <option value="">Semua project</option>
      {projectOptions(value ? [...projects, value] : projects).map((p) => <option key={p} value={p}>{p}</option>)}
    </Select>
  );
}
