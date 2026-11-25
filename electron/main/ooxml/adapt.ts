import { isApplied, parseIndoDate, type GroupRec, type MappingRec, type VariantGroup } from '@shared/importer';
import type { FieldType } from '@shared/types';
import { applyOps, planCuts, type Cut, type Op } from './fill';
import { scanPart } from './scan';
import { resolveVariants, variantFields } from './variants';
import { Zip } from './zip';

export interface DerivedField { key: string; label: string; type: FieldType; default_value: string; required: boolean; options: string[] }
export interface DerivedGroup { name: string; label: string; columns: Array<{ key: string; label: string; auto_number?: boolean }>; default_rows: Array<Record<string, string>> }
export interface AdaptResult {
  zip: Zip; applied: number; skipped: Array<{ id: string; reason: string }>; fields: DerivedField[]; groups: DerivedGroup[];
  /** isian pemilih varian (bukan token di dokumen) */
  variant_fields: DerivedField[]; restricted: Record<string, string[]>; inherited: number;
}

const tokenOf = (m: MappingRec) => `{{${m.required ? '' : '?'}${m.placeholder_name}}}`;

/** Salinan DOCX asli dengan pemetaan yang berlaku diganti token {{KEY}}. Sumber tidak pernah diubah. */
export function adaptDocx(src: Zip, mappingsIn: MappingRec[], groupsIn: GroupRec[], variants: VariantGroup[] = []): AdaptResult {
  const out = src.clone();
  // Varian: pemetaan master diwarisi ke halaman varian; konfigurasi dibuat SEKALI dan dipakai bersama.
  const bodyXml = src.text('word/document.xml');
  const eff = variants.length && bodyXml ? resolveVariants(scanPart('word/document.xml', bodyXml), mappingsIn, groupsIn, variants) : null;
  const mappings = eff ? [...eff.kept, ...eff.derived] : mappingsIn;
  const groups = eff ? eff.groups : groupsIn;
  const skipped: AdaptResult['skipped'] = [];
  const parts = new Set<string>([...mappings.map((m) => m.part), ...groups.map((g) => g.part)]);
  let applied = 0;
  const live = mappings.filter(isApplied);
  const activeGroups = groups.filter((g) => g.status !== 'rejected' && g.status !== 'confirm');

  for (const part of parts) {
    const xml = src.text(part);
    if (xml === undefined) continue;
    const scan = scanPart(part, xml);
    const cuts: Cut[] = []; const ops: Op[] = [];
    const taken = new Set<string>();

    for (const g of activeGroups.filter((x) => x.part === part)) {
      const rows = scan.rows.filter((r) => r.tbl === g.tbl && g.rows.includes(r.tr));
      if (!rows.length) { skipped.push({ id: g.id, reason: 'Baris tabel tidak ditemukan.' }); continue; }
      const [first, ...rest] = rows;
      for (const col of g.columns) {
        const ps = scan.paras.filter((p) => p.table && p.table.tbl === g.tbl && p.table.tr === first.tr && p.table.tc === col.tc && p.text.length);
        if (!ps.length) continue;
        const p = ps[0];
        cuts.push({ para: p, start: 0, end: p.text.length, text: `{{${g.name}.${col.key}}}` });
        taken.add(`${p.index}`);
        for (const extra of ps.slice(1)) cuts.push({ para: extra, start: 0, end: extra.text.length, text: '' });
      }
      for (const r of rest) ops.push({ start: r.xmlStart, end: r.xmlEnd, text: '' });
      applied++;
    }

    for (const m of live.filter((x) => x.part === part)) {
      const p = scan.paras.find((q) => q.index === m.para_index);
      if (!p) { skipped.push({ id: m.id, reason: 'Paragraf tidak ditemukan.' }); continue; }
      let { start, end } = m;
      if (p.text.slice(start, end) !== m.source_text) {
        const at = p.text.indexOf(m.source_text);
        if (at < 0) { skipped.push({ id: m.id, reason: 'Teks sumber tidak cocok dengan dokumen.' }); continue; }
        start = at; end = at + m.source_text.length;
      }
      if (taken.has(`${p.index}`)) { skipped.push({ id: m.id, reason: 'Paragraf dipakai tabel berulang.' }); continue; }
      cuts.push({ para: p, start, end, text: tokenOf(m) });
    }
    try {
      const all = [...planCuts(cuts), ...ops];
      out.set(part, applyOps(xml, all));
      applied += cuts.length;
    } catch (e) {
      skipped.push({ id: part, reason: (e as Error).message });
    }
  }

  // Turunan: isian unik (nilai awal dari teks asli pertama)
  const fields = new Map<string, DerivedField>();
  for (const m of live) {
    if (fields.has(m.placeholder_name) || m.placeholder_name.includes('.')) continue;
    fields.set(m.placeholder_name, { key: m.placeholder_name, label: m.label, type: m.field_type, default_value: m.field_type === 'date' ? parseIndoDate(m.source_text) ?? m.default_value : m.default_value, required: m.required, options: m.options });
  }
  const dg: DerivedGroup[] = activeGroups.map((g) => ({ name: g.name, label: g.label, columns: g.columns.map((c) => ({ key: c.key, label: c.label, auto_number: c.auto_number })), default_rows: g.default_rows }));
  return { zip: out, applied, skipped, fields: [...fields.values()], groups: dg, variant_fields: variantFields(variants), restricted: eff?.restricted ?? {}, inherited: eff?.derived.length ?? 0 };
}
