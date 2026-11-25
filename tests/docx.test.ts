import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { buildDocx } from '../electron/main/docx-export';
import { DEFAULT_SETTINGS, layoutFromSettings } from '@shared/settings';
import type { TipTapNode } from '@shared/types';

// PNG 1x1 transparan
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const t = (text: string, marks?: any[]): TipTapNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const p = (c: TipTapNode[], attrs?: any): TipTapNode => ({ type: 'paragraph', attrs, content: c });

describe('export DOCX', () => {
  it('menghasilkan berkas DOCX valid dengan paragraf, format, daftar, tabel, gambar, dan page break', async () => {
    const content: TipTapNode = { type: 'doc', content: [
      p([t('NOTA DINAS', [{ type: 'bold' }, { type: 'textStyle', attrs: { fontSize: '14pt' } }])], { textAlign: 'center' }),
      p([t('Isi paragraf biasa dengan '), t('miring', [{ type: 'italic' }])]),
      { type: 'orderedList', content: [{ type: 'listItem', content: [p([t('satu')])] }, { type: 'listItem', content: [p([t('dua')])] }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p([t('poin')])] }] },
      { type: 'table', attrs: { borderless: false }, content: [{ type: 'tableRow', content: [
        { type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: [200] }, content: [p([t('Kolom A')])] },
        { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [300] }, content: [p([t('Sel B')])] }] }] },
      { type: 'image', attrs: { src: PNG, width: 50 } },
      { type: 'pageBreak' },
      p([t('Halaman kedua')])
    ] };
    const buf = await buildDocx({
      title: 'Uji', content, layout: layoutFromSettings(DEFAULT_SETTINGS), headerText: 'Header uji', footerText: 'Footer uji',
      kop: { name: 'Instansi Uji', address: 'Jl. Contoh No. 1', logo: PNG }
    });
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const zip = new AdmZip(buf);
    const xml = zip.readAsText('word/document.xml');
    for (const s of ['NOTA DINAS', 'Isi paragraf biasa', 'satu', 'poin', 'Kolom A', 'Sel B', 'Halaman kedua']) expect(xml).toContain(s);
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('w:type="page"');
    expect(xml).toContain('<w:drawing>');
    expect(zip.getEntries().some((e) => e.entryName.startsWith('word/header'))).toBe(true);
    expect(zip.getEntries().some((e) => e.entryName.startsWith('word/media/'))).toBe(true);
    expect(zip.getEntries().map((e) => zip.readAsText(e)).join('')).toContain('Instansi Uji'.toUpperCase());
  });

  it('dokumen kosong tetap menghasilkan DOCX valid', async () => {
    const buf = await buildDocx({ title: 'Kosong', content: { type: 'doc', content: [] }, layout: layoutFromSettings(DEFAULT_SETTINGS), headerText: '', footerText: '', kop: null });
    expect(new AdmZip(buf).getEntry('word/document.xml')).toBeTruthy();
  });
});
