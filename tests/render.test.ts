import { describe, expect, it } from 'vitest';
import { buildDocumentHtml, nodeToHtml } from '@shared/render';
import { buildExportName } from '@shared/filename';
import { checkAiOutput } from '@shared/ai-guard';
import { layoutFromSettings, DEFAULT_SETTINGS } from '@shared/settings';
import type { TipTapNode } from '@shared/types';

describe('render HTML', () => {
  it('meloloskan karakter HTML dan menolak gambar non-data URL', () => {
    const doc: TipTapNode = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
      { type: 'image', attrs: { src: 'https://evil.example/x.png' } }
    ] };
    const html = nodeToHtml(doc);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
  });

  it('menghasilkan tabel tanpa garis dan page break', () => {
    const html = nodeToHtml({ type: 'doc', content: [
      { type: 'table', attrs: { borderless: true }, content: [{ type: 'tableRow', content: [{ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [100] }, content: [{ type: 'paragraph' }] }] }] },
      { type: 'pageBreak' }
    ] });
    expect(html).toContain('borderless');
    expect(html).toContain('width:100px');
    expect(html).toContain('page-break-after');
  });

  it('dokumen print memakai @page A4 dengan margin dari layout', () => {
    const layout = layoutFromSettings(DEFAULT_SETTINGS);
    const html = buildDocumentHtml({ title: 'T', content: { type: 'doc', content: [] }, layout, mode: 'print' });
    expect(html).toContain('size:A4');
    expect(html).toContain('25mm 25mm 25mm 30mm');
    expect(html).toContain("default-src 'none'");
  });
});

describe('penamaan file', () => {
  it('mengikuti pola KODE_Judul_Tanggal', () => {
    expect(buildExportName({ code: 'ND', title: 'Pembahasan IP HUB', date: '2026-11-23', ext: 'docx' })).toBe('ND_Pembahasan_IP_HUB_2026-11-23.docx');
    expect(buildExportName({ code: 'ST', title: 'Perjalanan Dinas / Bandung?', date: '2026-01-02', ext: 'pdf' })).toBe('ST_Perjalanan_Dinas_Bandung_2026-01-02.pdf');
  });
});

describe('penjaga keluaran AI', () => {
  it('memperingatkan placeholder hilang, angka baru, dan rujukan peraturan baru', () => {
    const w = checkAiOutput('Rapat [LOKASI] tanggal 5 Mei', 'Rapat digelar sesuai UU Nomor 5 Tahun 2020 pada 9 Mei');
    expect(w.some((x) => x.includes('[LOKASI]'))).toBe(true);
    expect(w.some((x) => x.includes('"9"'))).toBe(true);
    expect(w.some((x) => x.toLowerCase().includes('peraturan'))).toBe(true);
  });
  it('tidak memperingatkan bila hanya bahasa yang diperbaiki', () => {
    expect(checkAiOutput('rapat tgl 5 Mei [LOKASI]', 'Rapat dilaksanakan pada 5 Mei di [LOKASI]')).toEqual([]);
  });
});

describe('font dokumen lintas platform', () => {
  it('menyematkan pengganti Calibri/Cambria dan mengizinkan font data: di CSP', () => {
    const layout = { ...layoutFromSettings(DEFAULT_SETTINGS), fontFamily: 'Bookman Old Style' };
    for (const mode of ['print', 'preview'] as const) {
      const html = buildDocumentHtml({ title: 'T', content: { type: 'doc', content: [] }, layout, mode });
      expect(html).toContain("font-src data:");
      expect(html).toMatch(/@font-face\{font-family:'Calibri';src:local\('Calibri'\),url\(/);
      expect(html).toContain("font-family:'Bookman Old Style','Bookman','URW Bookman',Georgia,serif");
    }
  });
});
