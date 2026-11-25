export const VENDOR_STATUS = ['aktif', 'nonaktif', 'arsip'] as const;
export type VendorStatus = (typeof VENDOR_STATUS)[number];
export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = { aktif: 'Aktif', nonaktif: 'Nonaktif', arsip: 'Diarsipkan' };

export interface VendorInput {
  name: string; npwp: string; nib: string; address: string; contact_person: string; email: string; phone: string;
  bank_name: string; account_number: string; account_holder: string; service_category_id: string | null; notes: string;
}
export interface Vendor extends VendorInput {
  id: string; status: VendorStatus; version: number; service_category_name: string | null;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
}
export interface VendorFilter { search?: string; status?: VendorStatus | 'semua'; service_category_id?: string }

// Bentuk badan usaha dan kata umum yang tidak membedakan penyedia.
const NOISE = new Set(['pt', 'cv', 'tbk', 'persero', 'perseroan', 'terbatas', 'ud', 'pd', 'koperasi']);

const words = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/** "PT. Telkom Satelit Indonesia (Persero) Tbk" → "telkom satelit indonesia". Kunci unik penyedia. */
export function vendorNameKey(name: string): string {
  const w = words(name); const core = w.filter((x) => !NOISE.has(x));
  return (core.length ? core : w).join(' ');
}

/** NPWP disimpan sebagai digit saja; 15 digit (format lama) atau 16 digit (NIK/NPWP baru). Kosong boleh. */
export function normalizeNpwp(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d && d.length !== 15 && d.length !== 16) throw new Error('NPWP harus 15 atau 16 digit.');
  return d;
}

/** Kemiripan nama 0..1 dari kata yang sama (Dice). Dipakai untuk peringatan penyedia mirip, bukan penolakan. */
export function nameSimilarity(a: string, b: string): number {
  const A = new Set(vendorNameKey(a).split(' ').filter(Boolean)); const B = new Set(vendorNameKey(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let same = 0; for (const x of A) if (B.has(x)) same++;
  return (2 * same) / (A.size + B.size);
}
