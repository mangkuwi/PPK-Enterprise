import { PpkError } from './access';

/** Tanggal kalender YYYY-MM-DD yang benar-benar ada (menolak "2026-09-31"). */
export function isDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
}
export function date(v: string | null | undefined, label: string, required = true): string | null {
  const t = (v ?? '').trim();
  if (!t) { if (required) throw new PpkError('INVALID', `${label} wajib diisi.`); return null; }
  if (!isDate(t)) throw new PpkError('INVALID', `${label} bukan tanggal yang valid.`);
  return t;
}
export function rupiah(v: unknown, label: string, { min = 0 }: { min?: number | null } = {}): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new PpkError('INVALID', `${label} harus bilangan bulat rupiah.`);
  if (min !== null && v < min) throw new PpkError('INVALID', `${label} tidak boleh kurang dari ${min}.`);
  return v;
}
export function text(v: string | null | undefined, label: string, { required = false, max = 500 } = {}): string {
  const t = (v ?? '').trim();
  if (required && !t) throw new PpkError('INVALID', `${label} wajib diisi.`);
  if (t.length > max) throw new PpkError('INVALID', `${label} maksimal ${max} karakter.`);
  return t;
}
/** Terjemahkan pelanggaran constraint SQLite/PostgreSQL menjadi pesan yang dimengerti pengguna. */
export function constraintError(e: unknown, what: string): never {
  if (e instanceof PpkError) throw e;
  const m = String(e instanceof Error ? e.message : e);
  if (/UNIQUE|duplicate key/i.test(m)) throw new PpkError('DUPLICATE', `${what} dengan data kunci yang sama sudah ada.`);
  if (/FOREIGN KEY|foreign key/i.test(m)) throw new PpkError('INVALID', `Data rujukan untuk ${what} tidak ditemukan.`);
  if (/CHECK|check constraint/i.test(m)) throw new PpkError('INVALID', `Isian ${what} tidak memenuhi aturan.`);
  throw e;
}
