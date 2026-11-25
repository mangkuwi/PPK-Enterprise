export type FieldType = 'text' | 'textarea' | 'date' | 'select' | 'richtext' | 'number';
export type DocStatus = 'draft' | 'review' | 'final';

export interface TipTapMark { type: string; attrs?: Record<string, any> }
export interface TipTapNode {
  type: string;
  attrs?: Record<string, any>;
  content?: TipTapNode[];
  marks?: TipTapMark[];
  text?: string;
}

export interface Layout {
  fontFamily: string;
  fontSize: number; // pt
  lineHeight: number;
  marginTop: number; // mm
  marginRight: number;
  marginBottom: number;
  marginLeft: number;
  showPageNumber: boolean;
}

export interface Category {
  id: string; name: string; code: string; sort_order: number; is_default: boolean;
  created_at: string; updated_at: string;
}

export interface TemplateField {
  id?: string;
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  default_value: string;
  options: string[];
  sort_order: number;
}

export interface TemplateSummary {
  id: string;
  category_id: string | null;
  category_name: string;
  category_code: string;
  name: string;
  description: string;
  is_favorite: boolean;
  is_active: boolean;
  kind: 'editor' | 'docx';
  field_count: number;
  created_at: string;
  updated_at: string;
}

export interface Template extends TemplateSummary {
  content: TipTapNode;
  header_text: string;
  footer_text: string;
  layout: Layout;
  fields: TemplateField[];
}

export interface TemplateInput {
  id?: string;
  category_id: string | null;
  name: string;
  description: string;
  content: TipTapNode;
  header_text: string;
  footer_text: string;
  layout: Layout;
  is_favorite?: boolean;
  is_active: boolean;
  fields: TemplateField[];
}

export interface DocumentSummary {
  id: string;
  template_id: string | null;
  template_name: string;
  category_id: string | null;
  category_name: string;
  category_code: string;
  title: string;
  letter_number: string;
  recipient: string;
  subject: string;
  doc_date: string;
  status: DocStatus;
  source_kind: 'editor' | 'docx';
  docx_state: 'pristine' | 'edited';
  created_at: string;
  updated_at: string;
}

export interface DocumentInput {
  id?: string;
  template_id: string | null;
  template_name: string;
  category_id: string | null;
  title: string;
  letter_number: string;
  recipient: string;
  subject: string;
  doc_date: string;
  status: DocStatus;
  content: TipTapNode;
  header_text: string;
  footer_text: string;
  layout: Layout;
  form_values: Record<string, string>;
  use_kop: boolean;
  note?: string;
}

export interface DocumentRecord extends DocumentSummary {
  content: TipTapNode;
  header_text: string;
  footer_text: string;
  layout: Layout;
  form_values: Record<string, string>;
  use_kop: boolean;
}

export interface VersionSummary { id: string; document_id: string; version_no: number; title: string; note: string; created_at: string }
export interface VersionRecord extends VersionSummary { content: TipTapNode }

export interface KopInfo { name: string; address: string; logo: string }

export interface ExportDoc {
  title: string;
  category_code: string;
  doc_date: string;
  content: TipTapNode;
  layout: Layout;
  header_text: string;
  footer_text: string;
  use_kop: boolean;
}

export interface Stats {
  totalDocuments: number;
  totalTemplates: number;
  documentsThisMonth: number;
  activeDrafts: number;
  lastDocument: DocumentSummary | null;
  recentDocuments: DocumentSummary[];
  favoriteTemplates: TemplateSummary[];
}

export interface BackupRecord { id: string; path: string; size_bytes: number; type: string; note: string; created_at: string }
export type BackupType = 'full' | 'templates' | 'documents';
export type Settings = Record<string, string>;

export interface TemplateFilter { search?: string; categoryId?: string; favoriteOnly?: boolean; activeOnly?: boolean }
export interface DocumentFilter {
  search?: string; categoryId?: string; status?: DocStatus | '';
  dateFrom?: string; dateTo?: string;
  sortBy?: 'title' | 'doc_date' | 'created_at' | 'updated_at' | 'status' | 'letter_number';
  sortDir?: 'asc' | 'desc';
}

/** Hasil impor berkas Word, ditampilkan di editor template untuk ditinjau sebelum disimpan. */
export interface ImportedTemplate {
  name: string;
  description: string;
  content: TipTapNode;
  header_text: string;
  footer_text: string;
  layout: Layout;
  fields: TemplateField[];
  warnings: string[];
}
