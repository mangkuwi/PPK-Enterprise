import type { KopInfo, Layout, TipTapMark, TipTapNode } from './types';
import { DOC_FONT_CSS, FONT_FALLBACK } from './docFonts';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const safeCss = (v: unknown) => String(v ?? '').replace(/[^\w\s.,%#()'"-]/g, '');

function renderMarks(text: string, marks: TipTapMark[] = []): string {
  let html = esc(text);
  for (const m of marks) {
    switch (m.type) {
      case 'bold': html = `<strong>${html}</strong>`; break;
      case 'italic': html = `<em>${html}</em>`; break;
      case 'underline': html = `<u>${html}</u>`; break;
      case 'strike': html = `<s>${html}</s>`; break;
      case 'textStyle': {
        const css: string[] = [];
        if (m.attrs?.fontSize) css.push(`font-size:${safeCss(m.attrs.fontSize)}`);
        if (m.attrs?.fontFamily) css.push(`font-family:${safeCss(m.attrs.fontFamily)}`);
        if (css.length) html = `<span style="${css.join(';')}">${html}</span>`;
        break;
      }
    }
  }
  return html;
}

function blockStyle(attrs?: Record<string, any>): string {
  const css: string[] = [];
  const a = attrs?.textAlign;
  if (['left', 'center', 'right', 'justify'].includes(a)) css.push(`text-align:${a}`);
  const ind = Number(attrs?.indent ?? 0);
  if (ind > 0) css.push(`margin-left:${Math.min(ind, 8) * 1.25}cm`);
  return css.length ? ` style="${css.join(';')}"` : '';
}

export function nodeToHtml(n: TipTapNode): string {
  const kids = (n.content ?? []).map(nodeToHtml).join('');
  switch (n.type) {
    case 'doc': return kids;
    case 'text': return renderMarks(n.text ?? '', n.marks);
    case 'hardBreak': return '<br>';
    case 'paragraph': return `<p${blockStyle(n.attrs)}>${kids || '&nbsp;'}</p>`;
    case 'heading': {
      const lvl = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
      return `<h${lvl}${blockStyle(n.attrs)}>${kids}</h${lvl}>`;
    }
    case 'bulletList': return `<ul>${kids}</ul>`;
    case 'orderedList': return `<ol${Number(n.attrs?.start) > 1 ? ` start="${Number(n.attrs?.start)}"` : ''}>${kids}</ol>`;
    case 'listItem': return `<li>${kids}</li>`;
    case 'table': return `<table class="nd-table${n.attrs?.borderless ? ' borderless' : ''}"><tbody>${kids}</tbody></table>`;
    case 'tableRow': return `<tr>${kids}</tr>`;
    case 'tableCell':
    case 'tableHeader': {
      const tag = n.type === 'tableHeader' ? 'th' : 'td';
      const a = n.attrs ?? {};
      const w = Array.isArray(a.colwidth) && a.colwidth.length === 1 ? ` style="width:${Number(a.colwidth[0])}px"` : '';
      const span = `${a.colspan > 1 ? ` colspan="${Number(a.colspan)}"` : ''}${a.rowspan > 1 ? ` rowspan="${Number(a.rowspan)}"` : ''}`;
      return `<${tag}${span}${w}>${kids || '&nbsp;'}</${tag}>`;
    }
    case 'image': {
      const src = String(n.attrs?.src ?? '');
      if (!/^data:image\/(png|jpe?g|gif|bmp|webp);base64,/i.test(src)) return '';
      const w = Number(n.attrs?.width);
      return `<p><img src="${esc(src)}" alt="${esc(String(n.attrs?.alt ?? ''))}"${w > 0 ? ` style="width:${w}px;max-width:100%"` : ' style="max-width:100%"'}></p>`;
    }
    case 'pageBreak': return '<div class="page-break" style="break-after:page;page-break-after:always"></div>';
    default: return kids;
  }
}

export function kopToHtml(kop: KopInfo): string {
  const logo = /^data:image\//.test(kop.logo) ? `<td class="kop-logo"><img src="${esc(kop.logo)}" alt=""></td>` : '';
  const addr = esc(kop.address).replace(/\r?\n/g, '<br>');
  return `<div class="kop"><table><tr>${logo}<td class="kop-text"><div class="kop-name">${esc(kop.name)}</div><div class="kop-addr">${addr}</div></td></tr></table></div>`;
}

export const DOC_CSS = `
.nd-doc p{margin:0 0 .5em}
.nd-doc h1{font-size:1.5em;margin:0 0 .5em}.nd-doc h2{font-size:1.25em;margin:0 0 .5em}.nd-doc h3{font-size:1.1em;margin:0 0 .5em}
.nd-doc ul,.nd-doc ol{margin:0 0 .5em;padding-left:1.6em}
.nd-doc table.nd-table{border-collapse:collapse;width:100%;table-layout:fixed;margin:0 0 .5em}
.nd-doc table.nd-table td,.nd-doc table.nd-table th{border:1px solid #000;padding:3px 6px;vertical-align:top;word-wrap:break-word}
.nd-doc table.nd-table th{background:#e5e7eb}
.nd-doc table.nd-table td p,.nd-doc table.nd-table th p{margin:0 0 .15em}
.nd-doc table.nd-table.borderless td,.nd-doc table.nd-table.borderless th{border-color:transparent;background:none}
.nd-doc img{display:inline-block}
.kop table{width:100%;border-collapse:collapse}
.kop .kop-logo{width:90px;vertical-align:middle}.kop .kop-logo img{max-width:80px;max-height:80px}
.kop .kop-text{text-align:center;vertical-align:middle}
.kop .kop-name{font-weight:bold;font-size:1.25em;text-transform:uppercase}.kop .kop-addr{font-size:.85em}
.kop{border-bottom:3px double #000;padding-bottom:6px;margin-bottom:12px}
`;

export interface HtmlOptions {
  title: string;
  content: TipTapNode;
  layout: Layout;
  kop?: KopInfo | null;
  mode: 'preview' | 'print';
}

export function buildDocumentHtml(o: HtmlOptions): string {
  const l = o.layout;
  const margins = `${l.marginTop}mm ${l.marginRight}mm ${l.marginBottom}mm ${l.marginLeft}mm`;
  const body = `<div class="nd-doc">${o.kop ? kopToHtml(o.kop) : ''}${nodeToHtml(o.content)}</div>`;
  const base = `font-family:${FONT_FALLBACK[l.fontFamily] ?? `'${safeCss(l.fontFamily)}',Arial,sans-serif`};font-size:${Number(l.fontSize)}pt;line-height:${Number(l.lineHeight)};color:#000`;
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">`;
  if (o.mode === 'print') {
    return `<!doctype html><html lang="id"><head><meta charset="utf-8">${csp}<title>${esc(o.title)}</title><style>${DOC_FONT_CSS}
@page{size:A4;margin:${margins}}html,body{margin:0;padding:0}body{${base}}${DOC_CSS}</style></head><body>${body}</body></html>`;
  }
  return `<!doctype html><html lang="id"><head><meta charset="utf-8">${csp}<title>${esc(o.title)}</title><style>${DOC_FONT_CSS}
body{margin:0;background:#cbd5e1;padding:24px 0}.paper{width:210mm;min-height:297mm;box-sizing:border-box;margin:0 auto;background:#fff;padding:${margins};box-shadow:0 2px 12px rgba(0,0,0,.25);${base}}${DOC_CSS}</style></head><body><div class="paper">${body}</div></body></html>`;
}
