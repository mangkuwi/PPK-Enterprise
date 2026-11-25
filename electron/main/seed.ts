import { randomUUID } from 'node:crypto';
import type { DB } from './db';
import { getRawSetting, listCategories, saveTemplate, setSettings } from './repo';
import { DEFAULT_SETTINGS, layoutFromSettings } from '@shared/settings';
import type { TipTapNode } from '@shared/types';

export const DEFAULT_CATEGORIES: Array<{ name: string; code: string }> = [
  { name: 'Nota Dinas', code: 'ND' },
  { name: 'Surat Undangan', code: 'UND' },
  { name: 'Surat Tugas', code: 'ST' },
  { name: 'Berita Acara', code: 'BA' },
  { name: 'Surat Pengantar', code: 'SP' },
  { name: 'Surat Permohonan', code: 'SPM' },
  { name: 'Surat Pemberitahuan', code: 'SPB' },
  { name: 'Laporan', code: 'LAP' },
  { name: 'Memorandum', code: 'MEMO' },
  { name: 'Lainnya', code: 'DOK' }
];

// ---------- pembangun node TipTap ----------
type Marks = Array<{ type: string }>;
const t = (text: string, marks?: Marks): TipTapNode => ({ type: 'text', text, ...(marks ? { marks } : {}) });
const bold: Marks = [{ type: 'bold' }];
const p = (content: string | TipTapNode[] = '', attrs?: Record<string, unknown>): TipTapNode => ({
  type: 'paragraph', ...(attrs ? { attrs } : {}),
  ...(typeof content === 'string' ? (content ? { content: [t(content)] } : {}) : { content })
});
const center = { textAlign: 'center' };
const justify = { textAlign: 'justify' };
const cell = (content: string | TipTapNode[], width?: number, header = false): TipTapNode => ({
  type: header ? 'tableHeader' : 'tableCell',
  attrs: { colspan: 1, rowspan: 1, colwidth: width ? [width] : null },
  content: typeof content === 'string' ? [p(content)] : content
});
const table = (rows: TipTapNode[][], borderless: boolean): TipTapNode => ({
  type: 'table', attrs: { borderless }, content: rows.map((r) => ({ type: 'tableRow', content: r }))
});
/** Blok informasi "Label : Isi" tanpa garis. Lebar total ≈ 586px (A4, margin kiri 30mm & kanan 25mm). */
const info = (rows: Array<[string, string]>): TipTapNode =>
  table(rows.map(([a, b]) => [cell(a, 110), cell(':', 14), cell(b, 462)]), true);
const signature = (left?: TipTapNode[]): TipTapNode =>
  table([[cell(left ?? [p('')], 293), cell([p('[JABATAN_PEJABAT],', { textAlign: 'center' }), p(''), p(''), p(''), p([t('[NAMA_PEJABAT]', [{ type: 'bold' }, { type: 'underline' }])], { textAlign: 'center' })], 293)]], true);
const doc = (...content: TipTapNode[]): TipTapNode => ({ type: 'doc', content });

const CLOSING = '[PENUTUP|textarea|default=Demikian disampaikan, atas perhatian dan kerja sama Bapak/Ibu diucapkan terima kasih.]';

const SAMPLES: Array<{ code: string; name: string; description: string; content: TipTapNode }> = [
  {
    code: 'ND', name: 'Nota Dinas Standar', description: 'Nota dinas internal dengan blok Yth/Dari/Hal/Tanggal.',
    content: doc(
      p([t('NOTA DINAS', bold)], center),
      p('Nomor: [NOMOR_SURAT]', center),
      p(''),
      info([['Yth.', '[TUJUAN_SURAT]'], ['Dari', '[PENGIRIM]'], ['Hal', '[PERIHAL]'], ['Tanggal', '[TANGGAL]'],
        ['Sifat', '[?SIFAT|select:Biasa,Segera,Sangat Segera,Rahasia|default=Biasa]'], ['Lampiran', '[?LAMPIRAN]']]),
      p(''),
      p('[LATAR_BELAKANG]', justify),
      p('[MAKSUD_SURAT]', justify),
      p('[?DASAR_HUKUM]', justify),
      p(CLOSING, justify),
      p(''),
      signature()
    )
  },
  {
    code: 'UND', name: 'Surat Undangan Rapat', description: 'Undangan rapat/kegiatan lengkap dengan hari, waktu, tempat, dan agenda.',
    content: doc(
      p('[LOKASI_SURAT|default=Jakarta], [TANGGAL]', { textAlign: 'right' }),
      info([['Nomor', '[NOMOR_SURAT]'], ['Lampiran', '[?LAMPIRAN|default=-]'], ['Hal', 'Undangan [PERIHAL]']]),
      p(''),
      p('Yth.'),
      p('[TUJUAN_SURAT]'),
      p('di tempat'),
      p(''),
      p('[MAKSUD_SURAT|textarea|default=Dengan hormat, sehubungan dengan pelaksanaan kegiatan, kami mengundang Bapak/Ibu untuk hadir pada:]', justify),
      info([['Hari/Tanggal', '[TANGGAL_ACARA]'], ['Waktu', '[WAKTU]'], ['Tempat', '[LOKASI]'], ['Agenda', '[AGENDA]']]),
      p(''),
      p(CLOSING, justify),
      p(''),
      signature()
    )
  },
  {
    code: 'ST', name: 'Surat Tugas', description: 'Surat tugas untuk satu pegawai dengan uraian dan tempat penugasan.',
    content: doc(
      p([t('SURAT TUGAS', [{ type: 'bold' }, { type: 'underline' }])], center),
      p('Nomor: [NOMOR_SURAT]', center),
      p(''),
      p('[?DASAR_PENUGASAN|textarea]', justify),
      p('Yang bertanda tangan di bawah ini:'),
      info([['Nama', '[NAMA_PEJABAT]'], ['Jabatan', '[JABATAN_PEJABAT]']]),
      p('Menugaskan kepada:'),
      table([
        [cell('No', 30, true), cell('Nama', 200, true), cell('NIP', 150, true), cell('Jabatan', 206, true)],
        [cell('1', 30), cell('[NAMA_PEGAWAI]', 200), cell('[NIP_PEGAWAI]', 150), cell('[JABATAN_PEGAWAI]', 206)]
      ], false),
      p(''),
      p('Untuk melaksanakan tugas:'),
      p('[URAIAN_TUGAS]', justify),
      info([['Hari/Tanggal', '[TANGGAL_TUGAS]'], ['Tempat', '[LOKASI]']]),
      p(''),
      p('Demikian surat tugas ini dibuat untuk dilaksanakan dengan penuh tanggung jawab.', justify),
      p(''),
      p('[LOKASI_SURAT|default=Jakarta], [TANGGAL]', { textAlign: 'center' }),
      signature()
    )
  },
  {
    code: 'BA', name: 'Berita Acara Kegiatan', description: 'Berita acara dengan uraian, hasil pembahasan (rich text), dan dua penandatangan.',
    content: doc(
      p([t('BERITA ACARA', bold)], center),
      p([t('[PERIHAL]', bold)], center),
      p('Nomor: [NOMOR_SURAT]', center),
      p(''),
      p('Pada hari ini tanggal [TANGGAL_KEGIATAN], bertempat di [LOKASI], telah dilaksanakan kegiatan dengan agenda [AGENDA].', justify),
      p('[URAIAN_KEGIATAN|textarea]', justify),
      p('Hasil pembahasan:'),
      p('[HASIL_PEMBAHASAN|richtext]'),
      p(''),
      p('Demikian berita acara ini dibuat dengan sebenarnya untuk dipergunakan sebagaimana mestinya.', justify),
      p(''),
      table([[
        cell([p('[JABATAN_PEJABAT],', center), p(''), p(''), p(''), p([t('[NAMA_PEJABAT]', [{ type: 'bold' }, { type: 'underline' }])], center)], 293),
        cell([p('[JABATAN_PIHAK_KEDUA],', center), p(''), p(''), p(''), p([t('[NAMA_PIHAK_KEDUA]', [{ type: 'bold' }, { type: 'underline' }])], center)], 293)
      ]], true)
    )
  },
  {
    code: 'SP', name: 'Surat Pengantar', description: 'Surat pengantar dokumen dengan tabel lampiran.',
    content: doc(
      p('[LOKASI_SURAT|default=Jakarta], [TANGGAL]', { textAlign: 'right' }),
      info([['Nomor', '[NOMOR_SURAT]'], ['Lampiran', '[?LAMPIRAN|default=1 (satu) berkas]'], ['Hal', 'Pengantar [PERIHAL]']]),
      p(''),
      p('Yth.'),
      p('[TUJUAN_SURAT]'),
      p('di tempat'),
      p(''),
      p('Dengan hormat, bersama ini kami sampaikan [ISI_PENGANTAR|textarea] dengan rincian sebagai berikut:', justify),
      table([
        [cell('No', 30, true), cell('Uraian', 406, true), cell('Jumlah', 150, true)],
        [cell('1', 30), cell('[URAIAN_LAMPIRAN]', 406), cell('[JUMLAH_LAMPIRAN|number]', 150)]
      ], false),
      p(''),
      p(CLOSING, justify),
      p(''),
      signature()
    )
  },
  {
    code: 'DOK', name: 'Dokumen Kosong', description: 'Halaman kosong untuk surat bebas.', content: doc(p(''))
  }
];

/** Mengisi kategori & template contoh sekali saja (ditandai pada tabel settings). */
export function seedDefaults(db: DB) {
  if (getRawSetting(db, 'seeded_v1') === 'true') return;
  const ts = new Date().toISOString();
  db.transaction(() => {
    const ins = db.prepare('INSERT OR IGNORE INTO categories (id, name, code, sort_order, is_default, created_at, updated_at) VALUES (?,?,?,?,1,?,?)');
    DEFAULT_CATEGORIES.forEach((c, i) => ins.run(randomUUID(), c.name, c.code, i, ts, ts));
    const cats = listCategories(db);
    const layout = layoutFromSettings(DEFAULT_SETTINGS);
    for (const s of SAMPLES) {
      saveTemplate(db, {
        category_id: cats.find((c) => c.code === s.code)?.id ?? null, name: s.name, description: s.description,
        content: s.content, header_text: '', footer_text: '', layout, is_active: true, fields: []
      });
    }
    setSettings(db, { seeded_v1: 'true' });
  })();
}
