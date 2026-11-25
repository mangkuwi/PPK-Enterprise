import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatRupiah, parseRupiah } from '@shared/ppk/money';

const tryParse = (t: string) => { try { return parseRupiah(t); } catch { return null; } };

/** Isian rupiah bulat: menerima "1.250.000" atau "Rp 1.250.000"; null = kosong/tidak valid. Server tetap memvalidasi. */
export function RupiahInput({ value, onChange, allowNegative = false, ...p }: {
  value: number | null; onChange: (v: number | null) => void; allowNegative?: boolean; 'aria-label'?: string; autoFocus?: boolean; className?: string;
}) {
  const [text, setText] = useState(value == null ? '' : formatRupiah(value));
  useEffect(() => { if (value != null && Number.isSafeInteger(value) && tryParse(text) !== value) setText(formatRupiah(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = text.trim() ? tryParse(text) : null;
  const bad = !!text.trim() && (n == null || (!allowNegative && n < 0));
  return <>
    <Input {...p} inputMode="numeric" value={text} aria-invalid={bad}
      onChange={(e) => { setText(e.target.value); const v = tryParse(e.target.value); onChange(v != null && (allowNegative || v >= 0) ? v : null); }}
      onBlur={() => { if (n != null && !bad) setText(formatRupiah(n)); }} className={`text-right tabular-nums ${p.className ?? ''}`} />
    {bad && <p className="mt-1 text-xs text-red-600">Isi rupiah bulat{allowNegative ? '' : ' tanpa minus'}, mis. 1.250.000.</p>}
  </>;
}

export const rp = (n: number | null | undefined) => (n == null ? '—' : formatRupiah(n));

/** Tampilkan peringatan dari server (bukan galat) satu per satu. */
export function useWarnings() {
  const { toast } = useFeedback();
  return (ok: string, warnings: string[]) => { toast(ok, 'success'); for (const w of warnings) toast(w, 'info'); };
}

/** Dialog alasan untuk tindakan yang wajib beralasan (batal kontrak, batal addendum). */
export function ReasonDialog({ title, message, label = 'Alasan', confirmLabel, onClose, onSubmit }: {
  title: string; message: string; label?: string; confirmLabel: string; onClose: () => void; onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={title} description={message}
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={async () => { setBusy(true); try { await onSubmit(reason); } finally { setBusy(false); } }}>{confirmLabel}</Button></>}>
        <Field label={label} required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
      </DialogContent>
    </Dialog>
  );
}

/** Tahun anggaran aktif terbaru sebagai pilihan awal. */
export function useFiscalYears() {
  const fy = useAsync(() => api.ppk.masterList('fiscal_years'), []);
  const [id, setId] = useState('');
  useEffect(() => {
    if (!id && fy.data?.length) setId(String([...fy.data].sort((a, b) => Number(b.year) - Number(a.year)).find((y) => y.is_active)?.id ?? fy.data[0].id));
  }, [fy.data, id]);
  return { years: fy.data ?? [], id, setId };
}
