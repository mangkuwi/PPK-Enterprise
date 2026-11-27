import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import Table from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { placeholderRegex } from '@shared/placeholder';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: { setFontSize: (size: string) => ReturnType; unsetFontSize: () => ReturnType };
    indent: { indent: () => ReturnType; outdent: () => ReturnType };
    pageBreak: { setPageBreak: () => ReturnType };
    searchReplace: {
      setSearch: (term: string) => ReturnType;
      findNext: (dir?: 1 | -1) => ReturnType;
      replaceCurrent: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
          renderHTML: (a) => (a.fontSize ? { style: `font-size:${a.fontSize}` } : {})
        }
      }
    }];
  },
  addCommands() {
    return {
      setFontSize: (size) => ({ chain }) => chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }) => chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run()
    };
  }
});

export const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => parseInt((el as HTMLElement).getAttribute('data-indent') || '0', 10) || 0,
          renderHTML: (a) => (a.indent ? { 'data-indent': a.indent, style: `margin-left:${a.indent * 1.25}cm` } : {})
        }
      }
    }];
  },
  addCommands() {
    const shift = (delta: number) => () => ({ state, tr, dispatch }: any) => {
      const { from, to } = state.selection;
      state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
        if (node.type.name === 'paragraph' || node.type.name === 'heading') {
          const next = Math.max(0, Math.min(8, (node.attrs.indent || 0) + delta));
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
        }
      });
      dispatch?.(tr);
      return true;
    };
    return { indent: shift(1), outdent: shift(-1) };
  }
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-type="page-break"]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'page-break', class: 'page-break' })],
  addCommands() {
    return { setPageBreak: () => ({ chain }) => chain().insertContent({ type: 'pageBreak' }).run() };
  }
});

/** Tabel dengan atribut `borderless` (untuk blok info tanpa garis). */
export const NdTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      borderless: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-borderless') === 'true',
        renderHTML: (a: Record<string, any>) => ({ 'data-borderless': a.borderless ? 'true' : 'false' })
      }
    };
  }
});

export const NdImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el: HTMLElement) => parseInt(el.getAttribute('width') || '', 10) || null,
        renderHTML: (a: Record<string, any>) => (a.width ? { width: a.width } : {})
      }
    };
  }
});

/** Sorot placeholder [KEY] yang belum terisi sehingga tidak hilang secara diam-diam. */
export const PlaceholderHighlight = Extension.create({
  name: 'placeholderHighlight',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('placeholderHighlight'),
      props: {
        decorations(state) {
          const decos: Decoration[] = [];
          const re = placeholderRegex();
          state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(node.text))) decos.push(Decoration.inline(pos + m.index, pos + m.index + m[0].length, { class: 'ph-unfilled' }));
          });
          return DecorationSet.create(state.doc, decos);
        }
      }
    })];
  }
});

// ---------- Cari & ganti ----------
const searchKey = new PluginKey<{ term: string; current: number }>('searchReplace');

export function findMatches(doc: PMNode, term: string): Array<{ from: number; to: number }> {
  if (!term) return [];
  const needle = term.toLowerCase();
  const out: Array<{ from: number; to: number }> = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    const hay = node.text.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) { out.push({ from: pos + i, to: pos + i + needle.length }); i = hay.indexOf(needle, i + needle.length); }
  });
  return out;
}

export const SearchReplace = Extension.create({
  name: 'searchReplace',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => ({ term: '', current: 0 }),
        apply: (tr, v) => { const meta = tr.getMeta(searchKey); return meta ? { ...v, ...meta } : v; }
      },
      props: {
        decorations(state) {
          const s = searchKey.getState(state);
          if (!s?.term) return DecorationSet.empty;
          const ms = findMatches(state.doc, s.term);
          return DecorationSet.create(state.doc, ms.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'search-current' : 'search-match' })));
        }
      }
    })];
  },
  addCommands() {
    return {
      setSearch: (term) => ({ tr, dispatch }) => { dispatch?.(tr.setMeta(searchKey, { term, current: 0 })); return true; },
      findNext: (dir = 1) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        const ms = findMatches(state.doc, s?.term ?? '');
        if (!ms.length) return false;
        const cur = (((s?.current ?? 0) + dir) % ms.length + ms.length) % ms.length;
        tr.setMeta(searchKey, { current: cur }).setSelection(TextSelection.create(state.doc, ms[cur].from, ms[cur].to)).scrollIntoView();
        dispatch?.(tr);
        return true;
      },
      replaceCurrent: (replacement) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        const ms = findMatches(state.doc, s?.term ?? '');
        const m = ms[Math.min(s?.current ?? 0, ms.length - 1)];
        if (!m) return false;
        tr.insertText(replacement, m.from, m.to);
        dispatch?.(tr);
        return true;
      },
      replaceAll: (replacement) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state);
        const ms = findMatches(state.doc, s?.term ?? '');
        if (!ms.length) return false;
        for (const m of [...ms].reverse()) tr.insertText(replacement, m.from, m.to);
        dispatch?.(tr);
        return true;
      }
    };
  }
});
