export const BUDGET_KIND_LABEL = { dipa: 'Pagu DIPA', saldo_kas: 'Saldo Kas' } as const;
export type BudgetKind = keyof typeof BUDGET_KIND_LABEL;

export interface BudgetLineInput {
  fiscal_year_id: string; unit_id: string; program_id: string; activity_id: string; budget_account_id: string;
  output_detail: string; funding_source_id: string; kind: BudgetKind; description: string;
}
/** Pagu awal dicatat bersama baris anggaran baru, selalu dengan dokumen sumber. */
export interface BudgetAmountInput { amount: number; effective_date: string; source_document: string; notes: string }

export interface BudgetLine extends BudgetLineInput {
  id: string; is_active: number; version: number;
  year: number; unit_name: string; program_code: string; program_name: string; activity_name: string;
  mak: string; mak_name: string; source_code: string; source_name: string;
  pagu_awal: number; pagu_terakhir: number; revisions: number;
  /** Komitmen kontraktual: jumlah pembebanan kontrak yang tidak dibatalkan. */
  allocated: number; sisa: number;
}
export interface BudgetVersion { id: string; version_no: number; kind: 'awal' | 'revisi'; amount: number; effective_date: string; source_document: string; notes: string; created_by: string; created_at: string }

export interface Warned<T> { data: T; warnings: string[] }

export const budgetLabel = (b: Pick<BudgetLine, 'mak' | 'output_detail' | 'source_code'> & { kind: string }) =>
  `${b.mak}${b.output_detail ? ` · ${b.output_detail}` : ''} · ${b.source_code} · ${BUDGET_KIND_LABEL[b.kind as BudgetKind] ?? b.kind}`;
