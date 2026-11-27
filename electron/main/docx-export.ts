import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, LevelFormat, LineRuleType, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, convertMillimetersToTwip
} from 'docx';
import { parseImage } from './image';
import type { KopInfo, Layout, TipTapNode } from '@shared/types';

export interface ExportInput {
  title: string;
  content: TipTapNode;
  layout: Layout;
  headerText: string;
  footerText: string;
  kop: KopInfo | null;
}

type Block = Paragraph | Table;
interface Ctx { layout: Layout; contentPx: number; olInstance: number }

const PX_TO_TWIP = 15;
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED
};
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: '000000' };

const pt = (v: unknown): number | undefined => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

function runs(nodes: TipTapNode[] | undefined, ctx: Ctx, base: { bold?: boolean; size?: number } = {}): Array<TextRun | ImageRun> {
  const out: Array<TextRun | ImageRun> = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') { out.push(new TextRun({ break: 1 })); continue; }
    if (n.type === 'image') { const img = imageRun(n, ctx); if (img) out.push(img); continue; }
    if (n.type !== 'text' || !n.text) continue;
    const marks = n.marks ?? [];
    const has = (t: string) => marks.some((m) => m.type === t);
    const ts = marks.find((m) => m.type === 'textStyle')?.attrs ?? {};
    out.push(new TextRun({
      text: n.text,
      bold: base.bold || has('bold') || undefined,
      italics: has('italic') || undefined,
      underline: has('underline') ? {} : undefined,
      strike: has('strike') || undefined,
      font: ts.fontFamily ? String(ts.fontFamily).split(',')[0].replace(/["']/g, '').trim() : ctx.layout.fontFamily,
      size: Math.round((pt(ts.fontSize) ?? base.size ?? ctx.layout.fontSize) * 2)
    }));
  }
  return out;
}

function imageRun(n: TipTapNode, ctx: Ctx): ImageRun | null {
  const img = parseImage(String(n.attrs?.src ?? ''));
  if (!img) return null;
  let w = Number(n.attrs?.width) > 0 ? Number(n.attrs?.width) : img.width;
  w = Math.max(10, Math.min(w, ctx.contentPx));
  const h = Math.max(10, Math.round((w * img.height) / img.width));
  return new ImageRun({ type: img.type, data: img.data, transformation: { width: w, height: h } });
}

function spacing(ctx: Ctx, after = 120) {
  return { after, line: Math.round(ctx.layout.lineHeight * 240), lineRule: LineRuleType.AUTO };
}

function paragraph(n: TipTapNode, ctx: Ctx, extra: Record<string, unknown> = {}, base: { bold?: boolean; size?: number } = {}, after = 120): Paragraph {
  const indent = Number(n.attrs?.indent ?? 0);
  const ownIndent = indent > 0 ? { indent: { left: Math.round(indent * 709) } } : {};
  return new Paragraph({
    children: runs(n.content, ctx, base),
    alignment: ALIGN[n.attrs?.textAlign as string],
    spacing: spacing(ctx, after),
    ...ownIndent,
    ...extra
  });
}

const HEADING_PT: Record<number, number> = { 1: 16, 2: 14, 3: 12 };

function listBlocks(list: TipTapNode, ctx: Ctx, level: number): Block[] {
  const ordered = list.type === 'orderedList';
  const instance = ordered ? ++ctx.olInstance : 0;
  const out: Block[] = [];
  for (const li of list.content ?? []) {
    let first = true;
    for (const child of li.content ?? []) {
      if (child.type === 'paragraph') {
        const numbering = ordered
          ? { numbering: { reference: 'ol', level: Math.min(level, 8), instance } }
          : { bullet: { level: Math.min(level, 8) } };
        out.push(paragraph(child, ctx, first ? numbering : { indent: { left: 720 * (level + 1) } }, {}, 60));
        first = false;
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        out.push(...listBlocks(child, ctx, level + 1));
      } else {
        out.push(...blocks([child], ctx));
      }
    }
  }
  return out;
}

function columnWidths(rows: TipTapNode[], ctx: Ctx): number[] {
  const first = rows[0]?.content ?? [];
  const widths: Array<number | undefined> = [];
  for (const c of first) {
    const span = Math.max(1, Number(c.attrs?.colspan ?? 1));
    const cw = c.attrs?.colwidth as number[] | null | undefined;
    for (let i = 0; i < span; i++) widths.push(Array.isArray(cw) && cw[i] > 0 ? cw[i] : undefined);
  }
  if (!widths.length) widths.push(undefined);
  const known = widths.reduce<number>((s, w) => s + (w ?? 0), 0);
  const unknown = widths.filter((w) => !w).length;
  const share = unknown ? Math.max(40, (ctx.contentPx - known) / unknown) : 0;
  return widths.map((w) => Math.round((w ?? share) * PX_TO_TWIP));
}

function tableBlock(n: TipTapNode, ctx: Ctx): Table {
  const borderless = !!n.attrs?.borderless;
  const border = borderless ? NONE : LINE;
  const cols = columnWidths(n.content ?? [], ctx);
  const rows = (n.content ?? []).map((row) => new TableRow({
    children: (row.content ?? []).map((cellNode) => {
      const isHead = cellNode.type === 'tableHeader';
      const kids = blocks(cellNode.content ?? [], ctx, { cell: true, bold: isHead });
      if (!kids.length || kids[kids.length - 1] instanceof Table) kids.push(new Paragraph(''));
      const span = Math.max(1, Number(cellNode.attrs?.colspan ?? 1));
      const rspan = Math.max(1, Number(cellNode.attrs?.rowspan ?? 1));
      return new TableCell({
        children: kids,
        columnSpan: span > 1 ? span : undefined,
        rowSpan: rspan > 1 ? rspan : undefined,
        verticalAlign: VerticalAlign.TOP,
        shading: isHead && !borderless ? { type: ShadingType.CLEAR, fill: 'E5E7EB', color: 'auto' } : undefined,
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        borders: { top: border, bottom: border, left: border, right: border }
      });
    })
  }));
  return new Table({
    rows,
    columnWidths: cols,
    width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border }
  });
}

function blocks(nodes: TipTapNode[], ctx: Ctx, o: { cell?: boolean; bold?: boolean } = {}): Block[] {
  const out: Block[] = [];
  const push = (...b: Block[]) => {
    // Dua tabel berurutan akan digabung oleh Word; sisipkan paragraf pemisah kecil.
    if (out.length && out[out.length - 1] instanceof Table && b[0] instanceof Table) out.push(new Paragraph({ spacing: { after: 0 } }));
    out.push(...b);
  };
  for (const n of nodes) {
    switch (n.type) {
      case 'paragraph': push(paragraph(n, ctx, {}, { bold: o.bold }, o.cell ? 40 : 120)); break;
      case 'heading': {
        const lvl = Math.min(3, Math.max(1, Number(n.attrs?.level ?? 1)));
        push(paragraph(n, ctx, {}, { bold: true, size: HEADING_PT[lvl] }));
        break;
      }
      case 'bulletList': case 'orderedList': push(...listBlocks(n, ctx, 0)); break;
      case 'table': push(tableBlock(n, ctx)); break;
      case 'image': {
        const r = imageRun(n, ctx);
        push(new Paragraph({ children: r ? [r] : [new TextRun({ text: '[gambar tidak didukung]', italics: true })], spacing: spacing(ctx) }));
        break;
      }
      case 'pageBreak': push(new Paragraph({ children: [new PageBreak()] })); break;
      default: if (n.content) push(...blocks(n.content, ctx, o));
    }
  }
  return out;
}

function kopBlocks(kop: KopInfo, ctx: Ctx): Block[] {
  const out: Block[] = [];
  const textParas: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 20 }, children: [new TextRun({ text: kop.name.toUpperCase(), bold: true, size: 28, font: ctx.layout.fontFamily })] }),
    ...kop.address.split(/\r?\n/).filter(Boolean).map((line) =>
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: line, size: 18, font: ctx.layout.fontFamily })] }))
  ];
  const logo = kop.logo ? parseImage(kop.logo) : null;
  if (logo) {
    const h = 70;
    const w = Math.max(20, Math.round((h * logo.width) / logo.height));
    const logoW = 90 * PX_TO_TWIP;
    const total = Math.round(ctx.contentPx * PX_TO_TWIP);
    out.push(new Table({
      columnWidths: [logoW, total - logoW],
      width: { size: total, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
      rows: [new TableRow({
        children: [
          new TableCell({ width: { size: logoW, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE },
            children: [new Paragraph({ children: [new ImageRun({ type: logo.type, data: logo.data, transformation: { width: w, height: h } })] })] }),
          new TableCell({ width: { size: total - logoW, type: WidthType.DXA }, verticalAlign: VerticalAlign.CENTER, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, children: textParas })
        ]
      })]
    }));
  } else {
    out.push(...textParas);
  }
  out.push(new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.DOUBLE, size: 6, space: 1, color: '000000' } } }));
  return out;
}

const small = (text: string, ctx: Ctx) =>
  text.split(/\r?\n/).filter((l) => l.trim()).map((line) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 0 }, children: [new TextRun({ text: line, size: 18, font: ctx.layout.fontFamily })] }));

export async function buildDocx(input: ExportInput): Promise<Buffer> {
  const l = input.layout;
  const contentPx = ((210 - l.marginLeft - l.marginRight) * 96) / 25.4;
  const ctx: Ctx = { layout: l, contentPx, olInstance: 0 };
  const body = blocks(input.content.content ?? [], ctx);
  if (!body.length) body.push(new Paragraph(''));

  const headerParas = small(input.headerText, ctx);
  const footerParas: Paragraph[] = small(input.footerText, ctx);
  if (l.showPageNumber) {
    footerParas.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: ['Halaman ', PageNumber.CURRENT, ' dari ', PageNumber.TOTAL_PAGES], size: 18, font: l.fontFamily })]
    }));
  }
  if (!footerParas.length) footerParas.push(new Paragraph(''));
  const defaultHeader = new Header({ children: headerParas.length ? headerParas : [new Paragraph('')] });
  const firstHeader = input.kop ? new Header({ children: [...kopBlocks(input.kop, ctx), ...headerParas] }) : defaultHeader;

  const levels = Array.from({ length: 9 }, (_, i) => ({
    level: i,
    format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][i % 3],
    text: `%${i + 1}.`,
    alignment: AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } }
  }));

  const doc = new Document({
    creator: 'NASKAHDINAS AI',
    title: input.title,
    styles: { default: { document: { run: { font: l.fontFamily, size: Math.round(l.fontSize * 2) } } } },
    numbering: { config: [{ reference: 'ol', levels }] },
    sections: [{
      properties: {
        titlePage: !!input.kop,
        page: {
          size: { width: convertMillimetersToTwip(210), height: convertMillimetersToTwip(297) },
          margin: {
            top: convertMillimetersToTwip(l.marginTop), right: convertMillimetersToTwip(l.marginRight),
            bottom: convertMillimetersToTwip(l.marginBottom), left: convertMillimetersToTwip(l.marginLeft),
            header: convertMillimetersToTwip(10), footer: convertMillimetersToTwip(10)
          }
        }
      },
      headers: { default: defaultHeader, first: firstHeader },
      footers: { default: new Footer({ children: footerParas }), first: new Footer({ children: footerParas }) },
      children: body
    }]
  });
  return Packer.toBuffer(doc);
}
