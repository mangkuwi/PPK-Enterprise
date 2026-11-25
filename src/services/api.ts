import type { Channel } from '@shared/channels';
import type {
  BackupRecord, BackupType, Category, DocumentFilter, DocumentInput, DocumentRecord, DocumentSummary, DocStatus, ExportDoc,
  ImportedTemplate, Settings, Stats, Template, TemplateFilter, TemplateInput, TemplateSummary, VersionRecord, VersionSummary
} from '@shared/types';
import type { ValidationReport, VisualCompareResult } from '@shared/importer';
import type { CompareView, DocxTemplateInfo, ImportReview, ImportSaveInput, ImportSummary } from '@shared/importer';
import type { AiAction } from '@shared/ai-guard';
import type { PpkAccess, PpkRole, PpkUserRow } from '@shared/ppk/access';
import type { MasterKey, MasterRow } from '@shared/ppk/master';
import type { PpkImportReport } from '@shared/ppk/import';
import type { PpkReport } from '@shared/ppk/forecast';
import type { Bill, BillDetail, BillFilter, BillInput, PaymentInput } from '@shared/ppk/bills';
import type { BudgetAmountInput, BudgetLine, BudgetLineInput, BudgetVersion, Warned } from '@shared/ppk/budget';
import type { AddendumInput, AllocationRow, Contract, ContractDetail, ContractFilter, ContractInput, ContractStatus, ScheduleRow } from '@shared/ppk/contracts';
import type { Vendor, VendorFilter, VendorInput, VendorStatus } from '@shared/ppk/vendors';
import type {
  Actor, AppUser, AuditRow, CategoryMapRow, ConfigHistoryRow, DocNumbering, ImportCommitInput, ImportPreview, ImportRecordRow, ImportReport, ImportResult, NextInfo,
  AvailableQuery, BatchPreview, MigrationReview, NumberBatch, NumberEvent, NumberRecord, NumberRef, NumberingContext, RecordPage, RecordQuery, Register, RegisterSummary, Role, TemplateMapRow
} from '@shared/numbering';

declare global {
  interface Window {
    api: { invoke(channel: string, payload?: unknown): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> };
  }
}

async function call<T>(channel: Channel, payload?: unknown): Promise<T> {
  if (!window.api) throw new Error('Jembatan IPC tidak tersedia. Jalankan aplikasi melalui Electron.');
  const r = await window.api.invoke(channel, payload);
  if (!r.ok) throw new Error(r.error);
  return r.data as T;
}

export interface SaveResult { canceled: boolean; path?: string }

export const api = {
  info: () => call<{ name: string; version: string; platform: string; dbPath: string; userData: string }>('app:info'),
  showInFolder: (path: string) => call<boolean>('app:showInFolder', { path }),
  stats: () => call<Stats>('stats:get'),
  categories: () => call<Category[]>('categories:list'),
  templates: {
    list: (f: TemplateFilter = {}) => call<TemplateSummary[]>('templates:list', f),
    get: (id: string) => call<Template>('templates:get', { id }),
    save: (t: TemplateInput) => call<Template>('templates:save', t),
    remove: (id: string) => call<boolean>('templates:delete', { id }),
    duplicate: (id: string) => call<Template>('templates:duplicate', { id }),
    favorite: (id: string, value: boolean) => call<boolean>('templates:favorite', { id, value }),
    export: (ids: string[]) => call<{ canceled: boolean; path?: string; count?: number }>('templates:export', { ids }),
    import: () => call<{ canceled: boolean; imported?: number }>('templates:import'),
    importDocx: () => call<{ canceled: boolean; template?: ImportedTemplate }>('templates:importDocx')
  },
  documents: {
    list: (f: DocumentFilter = {}) => call<DocumentSummary[]>('documents:list', f),
    get: (id: string) => call<DocumentRecord>('documents:get', { id }),
    save: (d: DocumentInput & { number_record_id?: string | null; number_refs?: NumberRef[] }) => call<DocumentRecord & { numbering: DocNumbering | null }>('documents:save', d),
    remove: (id: string) => call<boolean>('documents:delete', { id }),
    duplicate: (id: string) => call<DocumentRecord>('documents:duplicate', { id }),
    setStatus: (id: string, status: DocStatus) => call<boolean>('documents:setStatus', { id, status }),
    versions: (id: string) => call<VersionSummary[]>('documents:versions', { id }),
    version: (id: string) => call<VersionRecord>('documents:version', { id }),
    restoreVersion: (id: string) => call<DocumentRecord>('documents:restoreVersion', { id })
  },
  export: {
    docx: (doc: ExportDoc) => call<SaveResult>('export:docx', { doc }),
    pdf: (doc: ExportDoc) => call<SaveResult>('export:pdf', { doc }),
    print: (doc: ExportDoc) => call<{ printed: boolean }>('export:print', { doc })
  },
  backup: {
    create: (type: BackupType) => call<{ path: string; size: number }>('backup:create', { type }),
    restore: () => call<{ canceled: boolean; type?: BackupType; imported?: number; safetyBackup?: string }>('backup:restore'),
    history: () => call<BackupRecord[]>('backup:history')
  },
  settings: {
    get: () => call<Settings>('settings:get'),
    set: (v: Record<string, string>) => call<Settings>('settings:set', v),
    chooseDir: (purpose: 'export' | 'backup') => call<{ canceled: boolean; path?: string }>('settings:chooseDir', { purpose }),
    setAiKey: (key: string) => call<Settings>('settings:setAiKey', { key })
  },
  numbering: {
    whoami: () => call<{ actor: Actor | null; users: AppUser[] }>('numbering:whoami'),
    login: (user_id: string, pin?: string) => call<Actor>('numbering:login', { user_id, pin }),
    logout: () => call<boolean>('numbering:logout'),
    users: () => call<AppUser[]>('numbering:users'),
    createUser: (i: { name: string; role: Role; pin?: string | null }) => call<AppUser>('numbering:createUser', i),
    updateUser: (i: { id: string; name?: string; role?: Role; is_active?: boolean }) => call<AppUser>('numbering:updateUser', i),
    setPin: (id: string, pin: string | null) => call<boolean>('numbering:setPin', { id, pin }),
    summary: (year: number) => call<RegisterSummary[]>('numbering:summary', { year }),
    registers: () => call<Register[]>('numbering:registers'),
    updateRegister: (id: string, patch: Partial<Pick<Register, 'name' | 'format' | 'prefix' | 'suffix' | 'seq_length' | 'initial_sequence' | 'ttl_hours' | 'placeholder_keys' | 'is_active'>>, reason?: string) => call<Register>('numbering:updateRegister', { id, patch, reason }),
    configHistory: (register_id: string) => call<ConfigHistoryRow[]>('numbering:configHistory', { register_id }),
    next: (register_id: string, date: string) => call<NextInfo>('numbering:next', { register_id, date }),
    setNext: (register_id: string, date: string, next: number, confirm: boolean) => call<NextInfo>('numbering:setNext', { register_id, date, next, confirm }),
    mappings: () => call<{ categories: CategoryMapRow[]; templates: TemplateMapRow[] }>('numbering:mappings'),
    setCategoryMap: (category_id: string, register_id: string | null) => call<boolean>('numbering:setCategoryMap', { category_id, register_id }),
    setTemplateMap: (template_id: string, register_id: string | null) => call<boolean>('numbering:setTemplateMap', { template_id, register_id }),
    audit: (f: { search?: string; action?: string } = {}) => call<AuditRow[]>('numbering:audit', f),
    records: (q: RecordQuery) => call<RecordPage>('numbering:records', q),
    record: (id: string) => call<{ record: NumberRecord; events: NumberEvent[]; referenced_by: Array<{ document_id: string; title: string; key: string }> }>('numbering:record', { id }),
    createManual: (i: { register_id: string; number_date: string; subject?: string; counterparty?: string; notes?: string; creator?: string; seq?: number; number_text?: string }) => call<NumberRecord>('numbering:createManual', i),
    updateMeta: (i: { id: string; subject?: string; counterparty?: string; notes?: string; creator?: string }) => call<NumberRecord>('numbering:updateMeta', i),
    void: (id: string, reason: string, confirm: boolean) => call<NumberRecord>('numbering:void', { id, reason, confirm }),
    release: (id: string, reason: string) => call<NumberRecord>('numbering:release', { id, reason }),
    issue: (id: string) => call<NumberRecord>('numbering:issue', { id }),
    search: (register_id: string, q: string) => call<NumberRecord[]>('numbering:search', { register_id, q }),
    forTemplate: (template_id: string) => call<NumberingContext>('numbering:forTemplate', { template_id }),
    assign: (template_id: string, record_id: string, previous_id?: string | null) => call<NumberRecord>('numbering:assign', { template_id, record_id, previous_id }),
    available: (q: AvailableQuery) => call<NumberRecord[]>('numbering:available', q),
    previewBatch: (register_id: string, number_date: string, quantity: number) => call<BatchPreview>('numbering:previewBatch', { register_id, number_date, quantity }),
    generateBatch: (i: { register_id: string; number_date: string; quantity: number; expect_first?: string; expect_last?: string; note?: string }) => call<{ batch: NumberBatch; records: NumberRecord[] }>('numbering:generateBatch', i),
    batches: (register_id: string) => call<NumberBatch[]>('numbering:batches', { register_id }),
    migrationReview: () => call<MigrationReview>('numbering:migrationReview', {}),
    resolveLegacy: (ids: string[], action: 'release' | 'void', reason: string) => call<number>('numbering:resolveLegacy', { ids, action, reason }),
    releaseDraft: (record_id: string) => call<NumberRecord>('numbering:releaseDraft', { record_id }),
    documentInfo: (document_id: string) => call<{ record: NumberRecord | null; refs: Array<{ key: string; record: NumberRecord }> }>('numbering:documentInfo', { document_id }),
    importPick: () => call<{ canceled: true } | { canceled: false; token: string; file_name: string; preview: ImportPreview }>('numbering:importPick'),
    importPreview: (token: string, sheet?: string, header_row?: number) => call<ImportPreview>('numbering:importPreview', { token, sheet, header_row }),
    importValidate: (token: string, input: ImportCommitInput) => call<ImportReport>('numbering:importValidate', { token, input }),
    importCommit: (token: string, input: ImportCommitInput) => call<ImportResult>('numbering:importCommit', { token, input }),
    imports: (register_id?: string) => call<ImportRecordRow[]>('numbering:imports', { register_id }),
    exportXlsx: (q: RecordQuery) => call<SaveResult>('numbering:exportXlsx', q),
    exportPdf: (q: RecordQuery) => call<SaveResult>('numbering:exportPdf', q)
  },
  importer: {
    upload: () => call<{ canceled: boolean; id?: string }>('importer:upload'),
    list: () => call<ImportSummary[]>('importer:list'),
    review: (id: string) => call<ImportReview>('importer:review', { id }),
    saveReview: (i: ImportSaveInput) => call<boolean>('importer:saveReview', i),
    reanalyze: (id: string) => call<ImportReview>('importer:reanalyze', { id }),
    saveTemplate: (i: ImportSaveInput) => call<{ templateId: string }>('importer:saveTemplate', i),
    compare: (id: string) => call<CompareView>('importer:compare', { id }),
    restoreSource: (id: string) => call<ImportReview>('importer:restoreSource', { id }),
    remove: (id: string, withTemplate: boolean) => call<boolean>('importer:delete', { id, withTemplate }),
    saveOriginal: (id: string) => call<SaveResult>('importer:saveOriginal', { id }),
    docxInfo: (templateId: string) => call<DocxTemplateInfo | null>('importer:docxInfo', { templateId }),
    generate: (i: { templateId: string; title: string; values: Record<string, string>; categoryId: string | null; templateName: string; docDate: string; letterNumber: string; recipient: string; subject: string; number_record_id?: string | null; number_refs?: NumberRef[] }) => call<DocumentRecord>('importer:generate', i),
    regenerate: (id: string, values: Record<string, string>) => call<DocumentRecord>('importer:regenerate', { id, values }),
    exportDocx: (id: string) => call<SaveResult & { state?: 'pristine' | 'edited' }>('importer:exportDocx', { id }),
    exportPdf: (id: string) => call<SaveResult>('importer:exportPdf', { id }),
    restoreVersion: (id: string, versionId: string) => call<{ templateId: string }>('importer:restoreVersion', { id, versionId }),
    visualCompare: (id: string) => call<VisualCompareResult>('importer:visualCompare', { id }),
    aiDraft: (i: { templateId: string; title: string; recipient: string; subject: string; instructions: string; references: string }) => call<{ values: Record<string, string>; missing: string[]; dropped: string[]; warnings: string[] }>('importer:aiDraft', { ...i, consent: true }),
    validation: (id: string) => call<ValidationReport | null>('importer:validation', { id }),
    variantDecision: (id: string, groupNo: number, decision: 'confirm' | 'reject') => call<ImportReview>('importer:variantDecision', { id, groupNo, decision }),
    variantPdf: (id: string, variantId: string) => call<{ pdf: string }>('importer:variantPdf', { id, variantId }),
    variantRegistry: (id: string) => call<{ master_templates: number; document_categories: number; template_variants: number; shared_placeholder_configurations: number; mappings: number; duplicated_in_variants: number }>('importer:variantRegistry', { id }),
    capabilities: () => call<{ libreoffice: boolean }>('importer:capabilities')
  },
  ppk: {
    access: () => call<PpkAccess | null>('ppk:access'),
    users: () => call<PpkUserRow[]>('ppk:users'),
    setRole: (user_id: string, role: PpkRole | null) => call<boolean>('ppk:setRole', { user_id, role }),
    masterList: (key: MasterKey) => call<MasterRow[]>('ppk:master:list', { key }),
    masterSave: (key: MasterKey, values: Record<string, string | number | boolean | null>) => call<MasterRow>('ppk:master:save', { key, values }),
    taxRates: () => call<Array<{ id: string; valid_from: string; ppn_bp: number; pph23_bp: number; note: string }>>('ppk:taxRates'),
    vendors: {
      list: (f: VendorFilter = {}) => call<Vendor[]>('ppk:vendors:list', f),
      get: (id: string) => call<Vendor>('ppk:vendors:get', { id }),
      similar: (name: string, npwp: string, except_id?: string) => call<Array<{ id: string; name: string; npwp: string; status: VendorStatus; score: number }>>('ppk:vendors:similar', { name, npwp, except_id }),
      create: (v: VendorInput) => call<Vendor>('ppk:vendors:create', v),
      update: (id: string, version: number, values: VendorInput) => call<Vendor>('ppk:vendors:update', { id, version, values }),
      setStatus: (id: string, status: VendorStatus, reason: string) => call<Vendor>('ppk:vendors:setStatus', { id, status, reason }),
      exportXlsx: (status: VendorStatus | 'semua' = 'semua') => call<SaveResult>('ppk:vendors:export', { status })
    },
    budget: {
      list: (f: { fiscal_year_id?: string; include_inactive?: boolean } = {}) => call<BudgetLine[]>('ppk:budget:list', f),
      create: (line: BudgetLineInput, pagu: BudgetAmountInput) => call<BudgetLine>('ppk:budget:create', { line, pagu }),
      update: (id: string, version: number, description: string, is_active: boolean) => call<BudgetLine>('ppk:budget:update', { id, version, description, is_active }),
      revise: (id: string, revision: BudgetAmountInput) => call<Warned<BudgetLine>>('ppk:budget:revise', { id, revision }),
      versions: (id: string) => call<BudgetVersion[]>('ppk:budget:versions', { id })
    },
    contracts: {
      list: (f: ContractFilter = {}) => call<Contract[]>('ppk:contracts:list', f),
      get: (id: string) => call<ContractDetail>('ppk:contracts:get', { id }),
      create: (v: ContractInput) => call<Contract>('ppk:contracts:create', v),
      update: (id: string, version: number, values: ContractInput) => call<Contract>('ppk:contracts:update', { id, version, values }),
      setStatus: (id: string, status: ContractStatus, reason: string) => call<Contract>('ppk:contracts:setStatus', { id, status, reason }),
      addAddendum: (id: string, addendum: AddendumInput) => call<Warned<Contract>>('ppk:contracts:addAddendum', { id, addendum }),
      voidAddendum: (id: string, reason: string) => call<Warned<Contract>>('ppk:contracts:voidAddendum', { id, reason }),
      setSchedule: (id: string, rows: ScheduleRow[]) => call<Warned<Contract>>('ppk:contracts:setSchedule', { id, rows }),
      setAllocations: (id: string, rows: AllocationRow[]) => call<Warned<Contract>>('ppk:contracts:setAllocations', { id, rows })
    },
    bills: {
      list: (f: BillFilter = {}) => call<Bill[]>('ppk:bills:list', f),
      get: (id: string) => call<BillDetail>('ppk:bills:get', { id }),
      save: (id: string | null, version: number | null, values: BillInput) => call<Warned<Bill>>('ppk:bills:save', { id, version, values }),
      setStatus: (id: string, status: 'diverifikasi' | 'dibatalkan', reason = '') => call<Bill>('ppk:bills:setStatus', { id, status, reason }),
      addPayment: (bill_funding_id: string, payment: PaymentInput) => call<Warned<Bill>>('ppk:bills:addPayment', { bill_funding_id, payment }),
      voidPayment: (id: string, reason: string) => call<Bill>('ppk:bills:voidPayment', { id, reason })
    },
    import: {
      pick: () => call<{ canceled: true } | { canceled: false; token: string; file_name: string }>('ppk:import:pick', {}),
      run: (token: string, fiscal_year_id: string, program_id: string, commit: boolean) => call<PpkImportReport>('ppk:import:run', { token, fiscal_year_id, program_id, commit })
    },
    reports: {
      get: (fiscal_year_id: string, cutoff: string, extend: boolean) => call<PpkReport>('ppk:reports:get', { fiscal_year_id, cutoff, extend }),
      exportXlsx: (fiscal_year_id: string, cutoff: string, extend: boolean) => call<SaveResult>('ppk:reports:export', { fiscal_year_id, cutoff, extend })
    }
  },
  ai: {
    run: (action: AiAction, text: string) => call<{ text: string; warnings: string[] }>('ai:run', { action, text, consent: true })
  }
};
