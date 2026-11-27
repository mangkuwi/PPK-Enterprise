import { describe, expect, it } from 'vitest';
import { extractFromDoc, fieldsFromDoc, generateContent, replaceInString, unresolvedKeys, docToPlainText } from '@shared/placeholder';
import { formatDateID } from '@shared/date';
import type { TipTapNode } from '@shared/types';

const p = (text: string): TipTapNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...c: TipTapNode[]): TipTapNode => ({ type: 'doc', content: c });

describe('placeholder engine', () => {
  it('mendeteksi placeholder, opsional, tipe, default, dan pilihan', () => {
    const d = doc(p('Yth. [TUJUAN_SURAT] tanggal [TANGGAL]'), p('[?SIFAT|select:Biasa,Segera|default=Biasa] [LATAR_BELAKANG] [JUMLAH_ORANG|number]'));
    const f = fieldsFromDoc(d);
    expect(f.map((x) => x.key)).toEqual(['TUJUAN_SURAT', 'TANGGAL', 'SIFAT', 'LATAR_BELAKANG', 'JUMLAH_ORANG']);
    expect(f.find((x) => x.key === 'TANGGAL')?.type).toBe('date');
    expect(f.find((x) => x.key === 'LATAR_BELAKANG')?.type).toBe('textarea');
    const sifat = f.find((x) => x.key === 'SIFAT')!;
    expect(sifat).toMatchObject({ type: 'select', required: false, default_value: 'Biasa', options: ['Biasa', 'Segera'] });
    expect(f.find((x) => x.key === 'JUMLAH_ORANG')?.type).toBe('number');
  });

  it('tidak salah mengenali teks biasa dalam kurung siku', () => {
    expect(extractFromDoc(doc(p('Lihat [1] dan [lampiran] serta [A. B]')))).toEqual([]);
  });

  it('mempertahankan konfigurasi field yang sudah diubah dan membuang field yang hilang', () => {
    const d1 = doc(p('[A] [B]'));
    const f1 = fieldsFromDoc(d1).map((f) => (f.key === 'A' ? { ...f, label: 'Label Kustom', required: false } : f));
    const f2 = fieldsFromDoc(doc(p('[A] [C]')), f1);
    expect(f2.map((f) => f.key)).toEqual(['A', 'C']);
    expect(f2[0]).toMatchObject({ label: 'Label Kustom', required: false });
  });

  it('mengganti placeholder, memformat tanggal, dan tidak memutasi template', () => {
    const tpl = doc(p('Nomor [NOMOR_SURAT] tgl [TANGGAL]'));
    const before = JSON.stringify(tpl);
    const fields = fieldsFromDoc(tpl);
    const r = generateContent(tpl, fields, { NOMOR_SURAT: 'B-1/2026', TANGGAL: '2026-11-23' });
    expect(docToPlainText(r.content)).toContain('Nomor B-1/2026 tgl 23 November 2026');
    expect(r.unresolved).toEqual([]);
    expect(JSON.stringify(tpl)).toBe(before);
  });

  it('placeholder wajib yang kosong tetap terlihat, opsional kosong dihapus dan dilaporkan', () => {
    const tpl = doc(p('A:[WAJIB] B:[?OPSI]'));
    const r = generateContent(tpl, fieldsFromDoc(tpl), { WAJIB: '  ', OPSI: '' });
    expect(docToPlainText(r.content)).toContain('A:[WAJIB] B:');
    expect(r.unresolved).toEqual(['WAJIB']);
    expect(r.removedOptional).toEqual(['OPSI']);
    expect(unresolvedKeys(r.content)).toEqual(['WAJIB']);
  });

  it('nilai multi-baris menjadi hardBreak dan mempertahankan marks', () => {
    const tpl = doc({ type: 'paragraph', content: [{ type: 'text', text: '[ISI|textarea]', marks: [{ type: 'bold' }] }] });
    const r = generateContent(tpl, fieldsFromDoc(tpl), { ISI: 'baris1\nbaris2' });
    const kids = r.content.content![0].content!;
    expect(kids.map((k) => k.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(kids[0].marks).toEqual([{ type: 'bold' }]);
  });

  it('rich text mengganti paragraf tunggal dengan blok isi', () => {
    const tpl = doc(p('[HASIL|richtext]'), p('penutup'));
    const rich = JSON.stringify({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p('poin 1')] }] }] });
    const r = generateContent(tpl, fieldsFromDoc(tpl), { HASIL: rich });
    expect(r.content.content!.map((n) => n.type)).toEqual(['bulletList', 'paragraph']);
  });

  it('header/footer string ikut diganti', () => {
    const f = fieldsFromDoc(doc(p('[INSTANSI]')));
    expect(replaceInString('Hal [INSTANSI]', f, { INSTANSI: 'Divisi Satelit' })).toBe('Hal Divisi Satelit');
  });

  it('formatDateID', () => {
    expect(formatDateID('2026-01-05')).toBe('5 Januari 2026');
    expect(formatDateID('bukan tanggal')).toBe('bukan tanggal');
  });
});
