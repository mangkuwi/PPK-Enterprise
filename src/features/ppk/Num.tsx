import { cn } from '@/lib/utils';
import { rp } from './inputs';

export const UNITS = [[1e9, 'Miliar Rp'], [1e6, 'Juta Rp'], [1, 'Rupiah']] as const;
/** Angka ringkas sesuai satuan; nilai persis tampil saat kursor diarahkan. */
export function Num({ n, unit, signed = false, className }: { n: number; unit: number; signed?: boolean; className?: string }) {
  if (!n) return <span className="text-slate-300">–</span>;
  const v = Math.abs(n) / unit;
  const t = v.toLocaleString('id-ID', { minimumFractionDigits: unit === 1e9 ? 2 : 0, maximumFractionDigits: unit === 1e9 ? 2 : unit === 1e6 ? 1 : 0 });
  const tiny = /^0(,0*)?$/.test(t); // nilai kecil jangan tampil 0
  return <span title={rp(n)} className={cn(signed && (n > 0 ? 'text-red-700' : 'text-emerald-700'), className)}>{signed ? (n > 0 ? '+' : '−') : n < 0 ? '−' : ''}{tiny ? `<${unit === 1e9 ? '0,01' : '0,1'}` : t}</span>;
}

