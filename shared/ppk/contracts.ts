export const CONTRACT_STATUS_LABEL = { draft: 'Draf', aktif: 'Aktif', selesai: 'Selesai', dibatalkan: 'Dibatalkan' } as const;
export type ContractStatus = keyof typeof CONTRACT_STATUS_LABEL;
export const CONTRACT_TYPE_LABEL = { biasa: 'Kontrak biasa', kpbu: 'KPBU' } as const;
export type ContractType = keyof typeof CONTRACT_TYPE_LABEL;

/** Status boleh maju; dibatalkan dan selesai bersifat final. */
export const CONTRACT_NEXT: Record<ContractStatus, ContractStatus[]> = { draft: ['aktif', 'dibatalkan'], aktif: ['selesai', 'dibatalkan'], selesai: [], dibatalkan: [] };

export interface ContractInput {
  fiscal_year_id: string; unit_id: string; vendor_id: string; program_id: string; activity_id: string; service_package_id: string | null;
  contract_type: ContractType; contract_number: string; vendor_contract_number: string; contract_date: string; description: string;
  initial_value: number; start_date: string; end_date: string; is_multi_year: boolean; term_start: string | null; term_end: string | null;
  prior_year_paid: number; notes: string;
}
export interface Contract extends Omit<ContractInput, 'is_multi_year'> {
  id: string; status: ContractStatus; version: number; is_multi_year: number;
  year: number; vendor_name: string; program_code: string; activity_name: string; package_code: string | null;
  addendum_total: number; addendum_count: number;
  /** Nilai awal + perubahan nilai addendum yang tidak dibatalkan. */
  latest_value: number;
  /** Tanggal selesai terakhir: tanggal baru dari addendum sah terakhir, atau tanggal selesai kontrak. */
  effective_end: string;
  allocated: number; scheduled: number;
  /** Tagihan tidak dibatalkan; sisa kontrak = nilai terakhir − tagihan. */
  billed: number; paid: number; sisa_kontrak: number;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
}
export interface Addendum {
  id: string; contract_id: string; addendum_number: string; addendum_date: string; value_change: number;
  period_start: string | null; period_end: string | null; new_end_date: string | null; description: string;
  created_by: string; created_at: string; voided_at: string | null; voided_by: string | null; void_reason: string | null;
}
export type AddendumInput = Pick<Addendum, 'addendum_number' | 'addendum_date' | 'value_change' | 'period_start' | 'period_end' | 'new_end_date' | 'description'>;
export interface ScheduleRow { month: string; planned_amount: number }
export interface AllocationRow { budget_line_id: string; amount: number }
export interface AllocationView extends AllocationRow { mak: string; output_detail: string; source_code: string; kind: string; pagu_terakhir: number }
export interface YearValueRow { year: number; amount: number }
export interface ContractDetail { contract: Contract; addendums: Addendum[]; schedule: ScheduleRow[]; allocations: AllocationView[]; year_values: YearValueRow[] }
export interface ContractFilter { fiscal_year_id?: string; status?: ContractStatus | 'semua'; vendor_id?: string; search?: string }

/** Bulan YYYY-MM dari tanggal mulai sampai tanggal selesai (inklusif). */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let y = Number(start.slice(0, 4)); let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4)); const em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
    if (out.length > 600) throw new Error('Rentang jadwal terlalu panjang.');
  }
  return out;
}

/** Bagi rata nilai (rupiah bulat) ke bulan-bulan; sisa pembagian masuk bulan terakhir agar total tepat sama. */
export function splitEven(total: number, months: string[]): ScheduleRow[] {
  if (!months.length) return [];
  const base = Math.floor(total / months.length);
  return months.map((month, i) => ({ month, planned_amount: i === months.length - 1 ? total - base * (months.length - 1) : base }));
}

/** Hari tersisa sampai tanggal selesai (negatif = lewat). */
export function daysUntil(date: string, today = new Date().toISOString().slice(0, 10)): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
