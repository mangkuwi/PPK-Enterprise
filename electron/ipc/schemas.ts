import { z } from 'zod';
import type { TipTapNode } from '@shared/types';
import { SETTING_KEYS } from '@shared/settings';
import { AI_ACTIONS } from '@shared/ai-guard';

export const id = z.string().min(1).max(64);
export const empty = z.object({}).passthrough();

export const layout = z.object({
  fontFamily: z.string().min(1).max(80),
  fontSize: z.number().min(6).max(72),
  lineHeight: z.number().min(0.8).max(3),
  marginTop: z.number().min(0).max(80),
  marginRight: z.number().min(0).max(80),
  marginBottom: z.number().min(0).max(80),
  marginLeft: z.number().min(0).max(80),
  showPageNumber: z.boolean()
});

export const content = z.custom<TipTapNode>(
  (v) => typeof v === 'object' && v !== null && (v as any).type === 'doc' && JSON.stringify(v).length < 20_000_000,
  'Isi dokumen tidak valid atau terlalu besar'
);

export const field = z.object({
  id: z.string().optional(),
  key: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(60),
  label: z.string().max(120),
  type: z.enum(['text', 'textarea', 'date', 'select', 'richtext', 'number']),
  required: z.boolean(),
  default_value: z.string().max(5000),
  options: z.array(z.string().max(200)).max(100),
  sort_order: z.number().int()
});

export const templateInput = z.object({
  id: id.optional(),
  category_id: id.nullable(),
  name: z.string().trim().min(1, 'Nama template wajib diisi').max(200),
  description: z.string().max(2000),
  content,
  header_text: z.string().max(2000),
  footer_text: z.string().max(2000),
  layout,
  is_favorite: z.boolean().optional(),
  is_active: z.boolean(),
  fields: z.array(field).max(200)
});

export const documentInput = z.object({
  id: id.optional(),
  template_id: id.nullable(),
  template_name: z.string().max(200),
  category_id: id.nullable(),
  title: z.string().trim().min(1, 'Nama dokumen wajib diisi').max(300),
  letter_number: z.string().max(200),
  recipient: z.string().max(500),
  subject: z.string().max(1000),
  doc_date: z.string().max(10),
  status: z.enum(['draft', 'review', 'final']),
  content,
  header_text: z.string().max(2000),
  footer_text: z.string().max(2000),
  layout,
  form_values: z.record(z.string().max(200_000)),
  use_kop: z.boolean(),
  note: z.string().max(300).optional()
});

export const exportDoc = z.object({
  doc: z.object({
    title: z.string().max(300), category_code: z.string().max(20), doc_date: z.string().max(10),
    content, layout, header_text: z.string().max(2000), footer_text: z.string().max(2000), use_kop: z.boolean()
  })
});

export const documentFilter = z.object({
  search: z.string().max(200).optional(), categoryId: id.optional().or(z.literal('')),
  status: z.enum(['draft', 'review', 'final', '']).optional(),
  dateFrom: z.string().max(10).optional(), dateTo: z.string().max(10).optional(),
  sortBy: z.enum(['title', 'doc_date', 'created_at', 'updated_at', 'status', 'letter_number']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional()
});

export const templateFilter = z.object({
  search: z.string().max(200).optional(), categoryId: id.optional().or(z.literal('')),
  favoriteOnly: z.boolean().optional(), activeOnly: z.boolean().optional()
});

const NUMERIC: Record<string, [number, number]> = {
  default_font_size: [6, 72], line_height: [0.8, 3], margin_top: [0, 80], margin_right: [0, 80], margin_bottom: [0, 80], margin_left: [0, 80], auto_backup_keep: [1, 365]
};

export const settingsInput = z.record(z.string().max(3_000_000)).superRefine((v, ctx) => {
  for (const [k, val] of Object.entries(v)) {
    if (!SETTING_KEYS.includes(k)) ctx.addIssue({ code: 'custom', message: `Pengaturan tidak dikenal: ${k}` });
    const r = NUMERIC[k];
    if (r) { const n = Number(val); if (!Number.isFinite(n) || n < r[0] || n > r[1]) ctx.addIssue({ code: 'custom', message: `Nilai ${k} harus ${r[0]}–${r[1]}` }); }
    if (k === 'institution_logo' && val && !/^data:image\/(png|jpe?g|gif|bmp);base64,/i.test(val)) ctx.addIssue({ code: 'custom', message: 'Logo harus PNG/JPEG/GIF/BMP' });
  }
});

export const aiRun = z.object({
  action: z.enum(Object.keys(AI_ACTIONS) as [keyof typeof AI_ACTIONS, ...Array<keyof typeof AI_ACTIONS>]),
  text: z.string().min(1).max(20000),
  consent: z.literal(true, { errorMap: () => ({ message: 'Persetujuan pengiriman ke layanan AI diperlukan' }) })
});

export const templateImportFile = z.object({
  format: z.literal('naskahdinas-templates'),
  version: z.literal(1),
  exported_at: z.string(),
  templates: z.array(z.object({
    id: z.string().optional(), name: z.string().min(1).max(200), category_code: z.string().max(20), category_name: z.string().max(100),
    description: z.string().max(2000), content, header_text: z.string().max(2000), footer_text: z.string().max(2000),
    layout, is_active: z.boolean(), fields: z.array(field.omit({ id: true }))
  })).max(500)
});

/** Rujukan nomor register lain yang sudah terbit: kunci kolom + id catatan nomor. */
export const numberRefs = z.array(z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(60), record_id: id })).max(20);
