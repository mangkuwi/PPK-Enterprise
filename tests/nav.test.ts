import { describe, expect, it } from 'vitest';
import { GROUPS, SECTIONS, activeTab, sectionFor } from '@shared/nav';

describe('struktur menu', () => {
  it('setiap rute lama punya bagian di menu', () => {
    const routes = ['/generator', '/templates/abc', '/archive', '/documents/1', '/importer', '/importer/analyze', '/importer/review/9', '/importer/preview', '/importer/templates', '/importer/history',
      '/bank-nomor', '/penomoran', '/penomoran/pengaturan', '/penomoran/impor', '/register/nota-dinas', '/ppk/anggaran', '/ppk/kontrak', '/ppk/tagihan', '/ppk/impor', '/ppk/laporan',
      '/ppk/rekonsiliasi', '/ppk/penyedia', '/ppk/pengaturan', '/ppk/server', '/ppk/agenda', '/ppk/agenda/x', '/ppk/kotak-masuk', '/settings'];
    for (const r of routes) expect(sectionFor(r), r).not.toBeNull();
    expect(sectionFor('/penomoran/pengaturan')?.key).toBe('pengaturan');
    expect(sectionFor('/penomoran')?.key).toBe('register');
    expect(sectionFor('/ppk/impor')?.key).toBe('anggaran');
  });
  it('setiap bagian tampil tepat sekali di sidebar', () => {
    const keys = GROUPS.flatMap((g) => g.sections);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(SECTIONS.map((s) => s.key).sort());
  });
  it('tab aktif memilih yang paling spesifik', () => {
    const t = SECTIONS.find((s) => s.key === 'template')!;
    expect(activeTab(t, '/importer/review/9', '')).toBe('/importer/review');
    expect(activeTab(t, '/importer', '')).toBe('/importer');
    const d = SECTIONS.find((s) => s.key === 'dokumen')!;
    expect(activeTab(d, '/archive', '?status=draft')).toBe('/archive?status=draft');
    expect(activeTab(d, '/archive', '')).toBe('/archive');
  });
});
