import { describe, expect, it } from 'vitest';
import { buildDraftPrompt, parseDraft } from '@shared/ai-guard';

describe('draf AI untuk area editable', () => {
  const fields = [{ key: 'ISI_UTAMA', label: 'Isi utama' }, { key: 'ISI_PENUTUP', label: 'Penutup' }];
  it('prompt hanya memuat teks isian dan daftar kunci', () => {
    const p = buildDraftPrompt({ title: 'T', recipient: 'Direktur', subject: 'Rapat', instructions: 'buat undangan', references: '', fields });
    expect(p).toContain('ISI_UTAMA — Isi utama');
    expect(p).toContain('Direktur');
  });
  it('mengambil JSON walau dibungkus teks/kode', () => {
    const r = parseDraft('Berikut:\n```json\n{"ISI_UTAMA":"Rapat membahas IP HUB."}\n```', ['ISI_UTAMA'], 'Rapat IP HUB');
    expect(r.values).toEqual({ ISI_UTAMA: 'Rapat membahas IP HUB.' });
  });
  it('kunci di luar area editable dibuang (NOMOR_SURAT tidak boleh diisi AI)', () => {
    const r = parseDraft('{"ISI_UTAMA":"a","NOMOR_SURAT":"B-1/2026"}', ['ISI_UTAMA'], '');
    expect(r.values.NOMOR_SURAT).toBeUndefined();
    expect(r.dropped).toEqual(['NOMOR_SURAT']);
  });
  it('informasi kurang ditandai [ISI_...] dan angka/peraturan baru diberi peringatan', () => {
    const r = parseDraft('{"ISI_UTAMA":"Sesuai Peraturan Menteri 5 Tahun 2020, tanggal [ISI_TANGGAL]."}', ['ISI_UTAMA'], 'Rapat');
    expect(r.missing).toEqual(['ISI_UTAMA']);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('respons non-JSON ditolak dengan pesan jelas', () => {
    expect(() => parseDraft('maaf tidak bisa', ['A'], '')).toThrow(/bukan JSON/);
  });
});
