import { formatDateID } from './date';
import type { FieldType, TemplateField, TipTapNode } from './types';

/**
 * Sintaks placeholder:
 *   [KEY]                              wajib, teks
 *   [?KEY]                             opsional (dihapus bila kosong, dilaporkan ke pengguna)
 *   [KEY|textarea]                     tipe: text|textarea|date|select|dropdown|richtext|number
 *   [KEY|select:Biasa,Segera]          dropdown dengan pilihan
 *   [KEY|default=Jakarta|label=Kota]   nilai bawaan / label (opsi: type=, default=, options=, label=)
 * Catatan: nilai default/label/opsi tidak boleh mengandung karakter  | [ ]
 */
const SOURCE = String.raw`\[(\??)([A-Z][A-Z0-9_]*)((?:\|[^\[\]|]*)*)\]`;
export const placeholderRegex = () => new RegExp(SOURCE, 'g');

const TYPES: Record<string, FieldType> = {
  text: 'text', textarea: 'textarea', date: 'date', select: 'select', dropdown: 'select', richtext: 'richtext', number: 'number'
};

interface Spec { type?: FieldType; label?: string; defaultValue?: string; options?: string[] }
export interface Placeholder { key: string; optional: boolean; spec: Spec }

const splitList = (s: string) => s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);

function parseSpec(raw: string): Spec {
  const spec: Spec = {};
  for (const part of raw.split('|').slice(1)) {
    const p = part.trim();
    if (!p) continue;
    const eq = p.indexOf('=');
    const colon = p.indexOf(':');
    if (eq > 0) {
      const k = p.slice(0, eq).trim().toLowerCase();
      const v = p.slice(eq + 1).trim();
      if (k === 'type' && TYPES[v.toLowerCase()]) spec.type = TYPES[v.toLowerCase()];
      else if (k === 'default') spec.defaultValue = v;
      else if (k === 'label') spec.label = v;
      else if (k === 'options') { spec.options = splitList(v); spec.type ??= 'select'; }
    } else if (colon > 0 && TYPES[p.slice(0, colon).toLowerCase()]) {
      spec.type = TYPES[p.slice(0, colon).toLowerCase()];
      if (spec.type === 'select') spec.options = splitList(p.slice(colon + 1));
    } else if (TYPES[p.toLowerCase()]) {
      spec.type = TYPES[p.toLowerCase()];
    }
  }
  return spec;
}

export function keyToLabel(key: string): string {
  return key.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');
}

export function inferType(key: string): FieldType {
  if (/(^|_)(TANGGAL|TGL)(_|$)/.test(key)) return 'date';
  if (/(LATAR_BELAKANG|MAKSUD|AGENDA|PENUTUP|URAIAN|DASAR|ISI_|ALAMAT|CATATAN|TEMBUSAN|PEMBUKA)/.test(key)) return 'textarea';
  if (/(^|_)(JUMLAH|NOMINAL|ANGKA)(_|$)/.test(key)) return 'number';
  return 'text';
}

export function collectTextNodes(node: TipTapNode, out: string[] = []): string[] {
  if (typeof node.text === 'string') out.push(node.text);
  node.content?.forEach((c) => collectTextNodes(c, out));
  return out;
}

/** Semua placeholder unik pada dokumen, urut kemunculan. */
export function extractFromDoc(doc: TipTapNode): Placeholder[] {
  const map = new Map<string, Placeholder>();
  for (const text of collectTextNodes(doc)) {
    const re = placeholderRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const key = m[2];
      const optional = m[1] === '?';
      const spec = parseSpec(m[3] ?? '');
      const prev = map.get(key);
      if (!prev) map.set(key, { key, optional, spec });
      else {
        prev.optional = prev.optional && optional;
        prev.spec = { ...spec, ...prev.spec };
      }
    }
  }
  return [...map.values()];
}

/** Bentuk daftar field dari isi template; konfigurasi field yang sudah ada (existing) dipertahankan. */
export function fieldsFromDoc(doc: TipTapNode, existing: TemplateField[] = []): TemplateField[] {
  const prev = new Map(existing.map((f) => [f.key, f]));
  return extractFromDoc(doc).map((ph, i) => {
    const old = prev.get(ph.key);
    if (old) return { ...old, sort_order: i };
    return {
      key: ph.key,
      label: ph.spec.label ?? keyToLabel(ph.key),
      type: ph.spec.type ?? inferType(ph.key),
      required: !ph.optional,
      default_value: ph.spec.defaultValue ?? '',
      options: ph.spec.options ?? [],
      sort_order: i
    };
  });
}

export function docToPlainText(node: TipTapNode): string {
  if (typeof node.text === 'string') return node.text;
  if (node.type === 'hardBreak') return '\n';
  const inner = (node.content ?? []).map(docToPlainText).join('');
  if (['paragraph', 'heading', 'listItem', 'tableRow'].includes(node.type)) return inner + '\n';
  if (node.type === 'tableCell' || node.type === 'tableHeader') return inner.replace(/\n+$/, '') + '\t';
  return inner;
}

export interface GenerateResult {
  content: TipTapNode;
  filled: string[];
  unresolved: string[];
  removedOptional: string[];
}

interface Ctx {
  fields: Map<string, TemplateField>;
  values: Record<string, string>;
  filled: Set<string>;
  unresolved: Set<string>;
  removed: Set<string>;
}

function richDoc(value: string | undefined): TipTapNode[] | null {
  if (!value || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && parsed.type === 'doc' && Array.isArray(parsed.content)) {
      return docToPlainText(parsed).trim() ? parsed.content : null;
    }
  } catch { /* bukan JSON: perlakukan sebagai teks biasa */ }
  return value.split(/\r?\n/).map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : undefined }));
}

function formatValue(raw: string | undefined, type: FieldType): string {
  if (raw === undefined) return '';
  let v = raw.trim();
  if (!v) return '';
  if (type === 'richtext') {
    try {
      const parsed = JSON.parse(v);
      if (parsed?.type === 'doc') v = docToPlainText(parsed).trim();
    } catch { /* teks biasa */ }
  }
  if (type === 'date') v = formatDateID(v);
  return v;
}

function resolve(ctx: Ctx, optionalMark: string, key: string): string {
  const f = ctx.fields.get(key);
  const val = formatValue(ctx.values[key], f?.type ?? 'text');
  if (val) { ctx.filled.add(key); return val; }
  const optional = f ? !f.required : optionalMark === '?';
  if (optional) { ctx.removed.add(key); return ''; }
  ctx.unresolved.add(key);
  return `[${key}]`; // tetap terlihat dan ditandai di editor
}

function replaceTextNode(n: TipTapNode, ctx: Ctx): TipTapNode[] {
  const text = n.text ?? '';
  const replaced = text.replace(placeholderRegex(), (_m, q: string, key: string) => resolve(ctx, q, key));
  if (!replaced) return [];
  const marks = n.marks ? { marks: n.marks } : {};
  const parts = replaced.split(/\r?\n/);
  const out: TipTapNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) out.push({ type: 'hardBreak' });
    if (part) out.push({ type: 'text', text: part, ...marks });
  });
  return out;
}

const SOLO = /^\s*\[(\??)([A-Z][A-Z0-9_]*)(?:\|[^[\]|]*)*\]\s*$/;

function processContent(nodes: TipTapNode[], ctx: Ctx): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const n of nodes) {
    if (n.type === 'text') { out.push(...replaceTextNode(n, ctx)); continue; }
    if (n.type === 'paragraph' && n.content?.length === 1 && n.content[0].type === 'text') {
      const m = SOLO.exec(n.content[0].text ?? '');
      if (m && ctx.fields.get(m[2])?.type === 'richtext') {
        const rich = richDoc(ctx.values[m[2]]);
        if (rich) { ctx.filled.add(m[2]); out.push(...rich); continue; }
      }
    }
    const copy: TipTapNode = { ...n };
    if (n.content) {
      copy.content = processContent(n.content, ctx);
      if (copy.content.length === 0) delete copy.content;
    }
    out.push(copy);
  }
  return out;
}

export function generateContent(content: TipTapNode, fields: TemplateField[], values: Record<string, string>): GenerateResult {
  const ctx: Ctx = {
    fields: new Map(fields.map((f) => [f.key, f])),
    values, filled: new Set(), unresolved: new Set(), removed: new Set()
  };
  const clone: TipTapNode = JSON.parse(JSON.stringify(content));
  const result = { ...clone, content: processContent(clone.content ?? [], ctx) };
  if (!result.content.length) result.content = [{ type: 'paragraph' }];
  return { content: result, filled: [...ctx.filled], unresolved: [...ctx.unresolved], removedOptional: [...ctx.removed] };
}

/** Terapkan nilai ke string biasa (header/footer). Placeholder kosong dibiarkan terlihat. */
export function replaceInString(text: string, fields: TemplateField[], values: Record<string, string>): string {
  const ctx: Ctx = { fields: new Map(fields.map((f) => [f.key, f])), values, filled: new Set(), unresolved: new Set(), removed: new Set() };
  return text.replace(placeholderRegex(), (_m, q: string, key: string) => resolve(ctx, q, key));
}

/** Placeholder yang masih tersisa di dokumen (belum terisi). */
export function unresolvedKeys(doc: TipTapNode): string[] {
  const keys = new Set<string>();
  for (const text of collectTextNodes(doc)) {
    const re = placeholderRegex();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) keys.add(m[2]);
  }
  return [...keys];
}
