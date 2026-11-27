import { describe, expect, it } from 'vitest';
import { compareLayout, type PageMetrics } from '../electron/main/pdf-metrics';

const W = 595; const H = 842;
const page = (n: number, text: Array<[string, number, number]>, images = 0): PageMetrics => ({ page: n, width: W, height: H, images, text: text.map(([str, x, y]) => ({ str, x, y, w: str.length * 5, h: 10 })) });
const base = () => [page(1, [['KOP INSTANSI', 100, 50], ['Isi surat', 72, 300], ['Halaman 1', 280, 820]], 1)];

describe('compareLayout', () => {
  it('identik → tanpa temuan', () => expect(compareLayout(base(), base())).toEqual({ pages_original: 1, pages_generated: 1, findings: [], material: false }));
  it('halaman tambahan', () => {
    const r = compareLayout(base(), [...base(), page(2, [['lanjutan', 72, 100]])]);
    expect(r.findings.map((f) => f.code)).toContain('extra_pages');
    expect(r.material).toBe(true);
  });
  it('gambar hilang', () => expect(compareLayout(base(), [page(1, [['KOP INSTANSI', 100, 50], ['Isi surat', 72, 300], ['Halaman 1', 280, 820]], 0)]).findings.map((f) => f.code)).toContain('missing_images'));
  it('header bergeser dan footer hilang', () => {
    const r = compareLayout(base(), [page(1, [['KOP INSTANSI', 100, 80], ['Isi surat', 72, 300]], 1)]);
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain('hf_displaced');
  });
  it('teks melewati batas kanan', () => {
    const r = compareLayout(base(), [page(1, [['KOP INSTANSI', 100, 50], ['x'.repeat(200), 72, 300]], 1)]);
    expect(r.findings.map((f) => f.code)).toContain('overflow');
  });
  it('banyak teks tengah bergeser horizontal → perubahan tabel', () => {
    const o = [page(1, [['A', 100, 200], ['B', 200, 200], ['C', 300, 200], ['D', 400, 200]], 0)];
    const g = [page(1, [['A', 120, 200], ['B', 230, 200], ['C', 340, 200], ['D', 440, 200]], 0)];
    expect(compareLayout(o, g).findings.map((f) => f.code)).toContain('layout_shift');
  });
});
