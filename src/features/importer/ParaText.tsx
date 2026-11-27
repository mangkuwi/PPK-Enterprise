import { cn } from '@/lib/utils';
import { isApplied, type MappingRec, type ParaView } from '@shared/importer';

/** Teks paragraf dengan rentang pemetaan disorot. Setiap potongan membawa data-start agar pilihan teks bisa dipetakan ke offset. */
export function ParaText({ para, mappings, selectedId, onSelect }: { para: ParaView; mappings: MappingRec[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const ms = mappings.filter((m) => m.part === para.part && m.para_index === para.index && m.status !== 'rejected').sort((a, b) => a.start - b.start);
  const parts: Array<{ start: number; text: string; m?: MappingRec }> = [];
  let pos = 0;
  for (const m of ms) {
    if (m.start < pos) continue;
    if (m.start > pos) parts.push({ start: pos, text: para.text.slice(pos, m.start) });
    parts.push({ start: m.start, text: para.text.slice(m.start, m.end), m });
    pos = m.end;
  }
  if (pos < para.text.length) parts.push({ start: pos, text: para.text.slice(pos) });
  return (
    <>
      {parts.map((p, i) => p.m ? (
        <mark key={i} data-start={p.start} title={`${p.m.placeholder_name} · ${Math.round(p.m.confidence * 100)}%`} onClick={() => onSelect((p.m as MappingRec).id)}
          className={cn('cursor-pointer rounded px-0.5', isApplied(p.m) ? 'bg-emerald-200 text-emerald-950' : 'bg-amber-200 text-amber-950',
            selectedId === p.m.id && 'ring-2 ring-navy-600')}>
          {p.text}
        </mark>
      ) : <span key={i} data-start={p.start}>{p.text}</span>)}
    </>
  );
}

/** Offset (dalam teks paragraf) dari pilihan teks pengguna di dalam satu elemen [data-para]. */
export function selectionInPara(root: HTMLElement): { key: string; start: number; end: number; text: string } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const para = (r.commonAncestorContainer instanceof Element ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement)?.closest('[data-para]') as HTMLElement | null;
  if (!para || !root.contains(para)) return null;
  const off = (node: Node, o: number): number | null => {
    const el = node instanceof Element ? node : node.parentElement;
    const span = el?.closest('[data-start]') as HTMLElement | null;
    if (!span) return null;
    return Number(span.dataset.start) + (node instanceof Element ? 0 : o);
  };
  const a = off(r.startContainer, r.startOffset); const b = off(r.endContainer, r.endOffset);
  if (a === null || b === null || b <= a) return null;
  const full = para.dataset.text ?? '';
  let s = a; let e = b;
  while (s < e && /\s/.test(full[s])) s++;
  while (e > s && /\s/.test(full[e - 1])) e--;
  if (e <= s) return null;
  return { key: para.dataset.para as string, start: s, end: e, text: full.slice(s, e) };
}
