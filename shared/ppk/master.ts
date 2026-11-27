/** Definisi data master PPK. Satu definisi dipakai validasi di proses utama dan formulir di renderer. */
export interface MasterField {
  key: string; label: string; type: 'text' | 'number' | 'date' | 'select' | 'ref' | 'bool';
  required?: boolean; options?: string[]; /** kunci MASTERS yang dirujuk */ ref?: string; hint?: string;
}
export interface MasterDef { table: string; label: string; fields: MasterField[]; order: string; display: string }

const active: MasterField = { key: 'is_active', label: 'Aktif', type: 'bool' };
const code = (label = 'Kode'): MasterField => ({ key: 'code', label, type: 'text', required: true });
const name = (label = 'Nama'): MasterField => ({ key: 'name', label, type: 'text', required: true });

export const MASTERS = {
  fiscal_years: { table: 'ppk_fiscal_years', label: 'Tahun Anggaran', order: 'year DESC', display: 'year',
    fields: [{ key: 'year', label: 'Tahun', type: 'number', required: true }, active] },
  units: { table: 'ppk_units', label: 'Unit PPK', order: 'code', display: 'name', fields: [code(), name(), active] },
  officials: { table: 'ppk_officials', label: 'Pejabat PPK', order: 'start_date DESC', display: 'name',
    fields: [{ key: 'unit_id', label: 'Unit PPK', type: 'ref', ref: 'units', required: true }, name('Nama pejabat'), { key: 'nip', label: 'NIP', type: 'text' },
      { key: 'start_date', label: 'Mulai menjabat', type: 'date', required: true }, { key: 'end_date', label: 'Selesai menjabat', type: 'date', hint: 'Kosongkan bila masih menjabat' }] },
  programs: { table: 'ppk_programs', label: 'Program', order: 'code', display: 'name', fields: [code(), name('Nama program'), active] },
  activities: { table: 'ppk_activities', label: 'Kegiatan', order: 'code', display: 'name',
    fields: [{ key: 'program_id', label: 'Program', type: 'ref', ref: 'programs', required: true }, code(), name('Nama kegiatan'), active] },
  funding_sources: { table: 'ppk_funding_sources', label: 'Sumber Dana', order: 'code', display: 'code',
    fields: [code(), name(), { key: 'payment_channel', label: 'Kanal pembayaran', type: 'select', options: ['SAKTI', 'FO', 'LAINNYA'], required: true }, active] },
  budget_accounts: { table: 'ppk_budget_accounts', label: 'Akun / MAK', order: 'code', display: 'code', fields: [code('Kode MAK'), name('Uraian'), active] },
  service_categories: { table: 'ppk_service_categories', label: 'Kategori Layanan', order: 'code', display: 'name', fields: [code(), name(), active] },
  service_packages: { table: 'ppk_service_packages', label: 'Paket Layanan', order: 'code', display: 'code',
    fields: [code('Kode paket/hub'), name(), { key: 'location', label: 'Lokasi', type: 'text' }, { key: 'capacity', label: 'Kapasitas', type: 'text' },
      { key: 'notes', label: 'Catatan', type: 'text' }, active] }
} satisfies Record<string, MasterDef>;
export type MasterKey = keyof typeof MASTERS;
export const MASTER_KEYS = Object.keys(MASTERS) as MasterKey[];

export type MasterRow = { id: string; created_at: string; updated_at: string } & Record<string, string | number | null>;
