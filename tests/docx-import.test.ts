import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { buildDocx } from '../electron/main/docx-export';
import { importDocxBuffer } from '../electron/main/docx-import-file';
import { DEFAULT_SETTINGS, layoutFromSettings } from '@shared/settings';
import { docToPlainText } from '@shared/placeholder';
import type { TipTapNode } from '@shared/types';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const t = (text: string, marks?: any[]): TipTapNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (c: TipTapNode[], attrs?: any): TipTapNode => ({ type: 'paragraph', attrs, content: c });

function makeDocx(documentXml: string): Buffer {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0"?><w:document ${W}><w:body>${documentXml}</w:body></w:document>`));
  return zip.toBuffer();
}

describe('import template dari Word', () => {
  it('membaca paragraf, format, placeholder yang terpecah antar-run, dan sintaks mail-merge', () => {
    const r = importDocxBuffer(makeDocx(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>[NOMOR</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>_SURAT] dan {{nama pejabat}}</w:t></w:r></w:p>'
    ), 'Nota_Dinas_Contoh.docx');
    expect(r.name).toBe('Nota Dinas Contoh');
    expect(r.fields.map((f) => f.key)).toEqual(['NOMOR_SURAT', 'NAMA_PEJABAT']);
    expect(r.content.content![0].content![0].marks).toEqual([{ type: 'bold' }]);
  });

  it('menolak berkas yang bukan docx', () => {
    expect(() => importDocxBuffer(Buffer.from('bukan zip'), 'x.docx')).toThrow();
    const zip = new AdmZip(); zip.addFile('hello.txt', Buffer.from('hi'));
    expect(() => importDocxBuffer(zip.toBuffer(), 'x.docx')).toThrow(/\.docx/);
  });

  it('round-trip: DOCX hasil export aplikasi dapat diimpor kembali dengan isi yang sama', async () => {
    const content: TipTapNode = { type: 'doc', content: [
      p([t('NOTA DINAS', [{ type: 'bold' }])], { textAlign: 'center' }),
      p([t('Yth. [TUJUAN_SURAT]')]),
      { type: 'orderedList', content: [{ type: 'listItem', content: [p([t('satu')])] }, { type: 'listItem', content: [p([t('dua')])] }] },
      { type: 'table', attrs: { borderless: false }, content: [{ type: 'tableRow', content: [
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [p([t('A')])] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [300] }, content: [p([t('[B]')])] }] }] }
    ] };
    const buf = await buildDocx({ title: 'RT', content, layout: layoutFromSettings(DEFAULT_SETTINGS), headerText: '', footerText: '', kop: null });
    const r = importDocxBuffer(buf, 'rt.docx');
    const text = docToPlainText(r.content);
    for (const s of ['NOTA DINAS', 'Yth. [TUJUAN_SURAT]', 'satu', 'dua', 'A', '[B]']) expect(text).toContain(s);
    expect(r.content.content!.some((n) => n.type === 'orderedList')).toBe(true);
    expect(r.content.content!.some((n) => n.type === 'table')).toBe(true);
    expect(r.fields.map((f) => f.key)).toEqual(['TUJUAN_SURAT', 'B']);
  });
});
