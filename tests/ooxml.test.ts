import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Zip } from '../electron/main/ooxml/zip';
import { scanPart } from '../electron/main/ooxml/scan';
import { fillXml, fillZip, listTokens } from '../electron/main/ooxml/fill';
import { analyzeDocx } from '../electron/main/ooxml/analyze';
import { adaptDocx } from '../electron/main/ooxml/adapt';
import { compareZips, paragraphDiff, structureSignature } from '../electron/main/ooxml/inspect';
import { validateGenerated, xmlWellFormed } from '../electron/main/ooxml/validate';
import { parseIndoDate, snakeName } from '@shared/importer';

const FX = path.join(__dirname, 'fixtures');
const files = fs.readdirSync(FX).filter((f) => f.endsWith('.docx')).sort();
const load = (f: string) => Zip.read(fs.readFileSync(path.join(FX, f)));

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const body = (inner: string) => `<?xml version="1.0"?><w:document ${W}><w:body>${inner}<w:sectPr/></w:body></w:document>`;
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const texts = (xml: string) => scanPart('word/document.xml', xml).paras.map((x) => x.text);

describe('helper importer', () => {
  it('parseIndoDate', () => {
    expect(parseIndoDate('23 November 2026')).toBe('2026-11-23');
    expect(parseIndoDate('5 Agu 2026')).toBe('2026-08-05');
    expect(parseIndoDate('besok')).toBeNull();
  });
  it('snakeName', () => {
    expect(snakeName('Hari / Tanggal')).toBe('HARI_TANGGAL');
    expect(snakeName('123 abc').startsWith('F_')).toBe(true);
  });
});

describe('fillXml', () => {
  it('mengganti token dan meloloskan karakter XML', () => {
    const r = fillXml('word/document.xml', body(p('Hal: {{PERIHAL}}')), { values: { PERIHAL: 'A & B <C>' } });
    expect(texts(r.xml)).toEqual(['Hal: A & B <C>']);
    expect(r.unresolved).toEqual([]);
  });
  it('token tak terisi dilaporkan dan dibiarkan', () => {
    const r = fillXml('word/document.xml', body(p('{{X}}')), { values: {} });
    expect(r.unresolved).toContain('X');
  });
  it('opsional kosong pada paragraf utuh menghapus paragraf', () => {
    const r = fillXml('word/document.xml', body(p('a') + p('{{?LAMPIRAN}}') + p('b')), { values: { LAMPIRAN: '' }, optionalKeys: new Set(['LAMPIRAN']) });
    expect(texts(r.xml)).toEqual(['a', 'b']);
  });
  it('opsional kosong di tengah kalimat hanya dikosongkan', () => {
    const r = fillXml('word/document.xml', body(p('Lampiran: {{?LAMPIRAN}}')), { values: {}, optionalKeys: new Set(['LAMPIRAN']) });
    expect(texts(r.xml)).toEqual(['Lampiran: ']);
  });
  it('nilai multi-baris pada paragraf utuh menggandakan paragraf', () => {
    const r = fillXml('word/document.xml', body(p('{{AGENDA}}') + p('x')), { values: { AGENDA: 'satu\ndua\ntiga' } });
    expect(texts(r.xml)).toEqual(['satu', 'dua', 'tiga', 'x']);
  });
  it('nilai multi-baris di dalam kalimat memakai <w:br/>', () => {
    const r = fillXml('word/document.xml', body(p('Alamat: {{ALAMAT}}')), { values: { ALAMAT: 'Jl. A\nJakarta' } });
    expect(r.xml).toContain('<w:br/>');
    expect(texts(r.xml)[0]).toBe('Alamat: Jl. A\nJakarta');
  });
  it('baris tabel berulang dengan nomor otomatis', () => {
    const tr = (a: string, b: string) => `<w:tr><w:tc>${p(a)}</w:tc><w:tc>${p(b)}</w:tc></w:tr>`;
    const xml = body(`<w:tbl>${tr('No', 'Nama')}${tr('{{PEG.NO}}', '{{PEG.NAMA}}')}</w:tbl>`);
    const r = fillXml('word/document.xml', xml, { values: { '@PEG': JSON.stringify([{ NAMA: 'Ani' }, { NAMA: 'Budi' }, { NAMA: 'Cici' }]) } });
    expect(texts(r.xml)).toEqual(['No', 'Nama', '1', 'Ani', '2', 'Budi', '3', 'Cici']);
  });
  it('grup kosong menghapus baris contoh tetapi header tetap', () => {
    const tr = (a: string) => `<w:tr><w:tc>${p(a)}</w:tc></w:tr>`;
    const r = fillXml('word/document.xml', body(`<w:tbl>${tr('H')}${tr('{{G.A}}')}</w:tbl>`), { values: { '@G': '[]' } });
    expect(texts(r.xml)).toEqual(['H']);
  });
  it('baris contoh tunggal tidak pernah dihapus (tabel tetap valid)', () => {
    const tr = (a: string) => `<w:tr><w:tc>${p(a)}</w:tc></w:tr>`;
    const r = fillXml('word/document.xml', body(`<w:tbl>${tr('{{G.A}}')}</w:tbl>`), { values: { '@G': '[]' } });
    expect(scanPart('word/document.xml', r.xml).rows.length).toBe(1);
  });
  it('paragraf opsional di sel tabel tidak dihapus', () => {
    const xml = body(`<w:tbl><w:tr><w:tc>${p('{{?A}}')}</w:tc></w:tr></w:tbl>`);
    const r = fillXml('word/document.xml', xml, { values: {}, optionalKeys: new Set(['A']) });
    expect(r.xml).toContain('<w:tc>');
    expect(scanPart('word/document.xml', r.xml).paras.length).toBe(1);
  });
});

describe('Zip', () => {
  it('entri tak berubah identik byte-per-byte', () => {
    const src = load(files[0]);
    const out = src.clone(); out.set('word/document.xml', (src.text('word/document.xml') as string) + ' ');
    const back = Zip.read(out.toBuffer());
    for (const n of src.names()) if (n !== 'word/document.xml') expect(back.entry(n)?.crc).toBe(src.entry(n)?.crc);
    expect(src.text('word/document.xml')).not.toBe(back.text('word/document.xml'));
  });
});

describe('analyzer pada 15 fixture', () => {
  it('ada 15 fixture', () => expect(files.length).toBe(15));

  it('mendeteksi isian kunci pada surat satu halaman', () => {
    const r = analyzeDocx(load('01_surat_satu_halaman.docx'), '01.docx');
    const names = r.mappings.map((m) => m.placeholder_name);
    for (const k of ['NOMOR_SURAT', 'PERIHAL', 'TUJUAN_SURAT', 'TANGGAL_SURAT', 'NAMA_PEJABAT', 'NIP_PEJABAT']) expect(names).toContain(k);
    const tgl = r.mappings.find((m) => m.placeholder_name === 'TANGGAL_SURAT')!;
    expect(tgl.field_type).toBe('date');
    expect(tgl.default_value).toBe('2026-11-23');
  });
  it('paragraf panjang tidak dipetakan otomatis', () => {
    const r = analyzeDocx(load('01_surat_satu_halaman.docx'), '01.docx');
    const long = r.mappings.filter((m) => m.source_text.length > 90);
    expect(long.length).toBeGreaterThan(0);
    expect(long.every((m) => m.status === 'confirm')).toBe(true);
  });
  it('kalimat penutup baku tetap statis', () => {
    const r = analyzeDocx(load('01_surat_satu_halaman.docx'), '01.docx');
    expect(r.mappings.some((m) => /^demikian/i.test(m.source_text))).toBe(false);
  });
  it('tabel pegawai terdeteksi sebagai grup berulang (perlu konfirmasi)', () => {
    const r = analyzeDocx(load('04_surat_tabel.docx'), '04.docx');
    expect(r.groups.length).toBe(1);
    expect(r.groups[0].status).toBe('confirm');
    expect(r.groups[0].columns.map((c) => c.key)).toEqual(['NO', 'NAMA', 'NIP', 'JABATAN']);
    expect(r.mappings.some((m) => ['Nama', 'NIP', 'Jabatan'].includes(m.source_text))).toBe(false);
  });
  it('kop dengan logo terdeteksi dan tidak dipetakan', () => {
    const r = analyzeDocx(load('03_kop_logo.docx'), '03.docx');
    expect(r.doc.has_kop).toBe(true);
    expect(r.doc.images.length).toBeGreaterThan(0);
    expect(r.paras.some((x) => x.static_reason === 'Kop surat')).toBe(true);
  });
  it('teks terpecah antar-run tetap terdeteksi utuh', () => {
    const r = analyzeDocx(load('09_multi_run.docx'), '09.docx');
    expect(r.mappings.find((m) => m.placeholder_name === 'NOMOR_SURAT')?.source_text).toBe('B-055/DS/XI/2026');
  });
  it('field halaman (header/footer) tidak dipetakan', () => {
    const r = analyzeDocx(load('06_header_footer.docx'), '06.docx');
    expect(r.mappings.every((m) => m.part === 'word/document.xml')).toBe(true);
    expect(r.doc.fields).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`round-trip ${f}: adapt → isi nilai asli = dokumen sumber`, () => {
      const src = load(f);
      const before = src.toBuffer();
      const r = analyzeDocx(src, f);
      r.mappings.forEach((m) => { if (m.status === 'confirm') m.status = 'confirmed'; });
      r.groups.forEach((g) => { g.status = 'confirmed'; });
      const a = adaptDocx(src, r.mappings, r.groups);
      expect(a.skipped).toEqual([]);
      const values: Record<string, string> = {};
      for (const m of r.mappings) values[m.placeholder_name] ??= m.source_text;
      for (const g of a.groups) values[`@${g.name}`] = JSON.stringify(g.default_rows);
      const opt = new Set(listTokens(a.zip).filter((t) => t.optional).map((t) => t.key));
      const gen = fillZip(a.zip, { values, optionalKeys: opt });
      expect(gen.unresolved).toEqual([]);
      expect(paragraphDiff(src, gen.zip)).toEqual([]);
      const cmp = compareZips(src, gen.zip);
      expect(cmp.format_preserved).toBe(true);
      expect(cmp.parts.every((x) => x.signature_equal)).toBe(true);
      // sumber tidak pernah berubah
      expect(Buffer.compare(src.toBuffer(), before)).toBe(0);
    });
  }

  it('adapted hanya mengubah teks (struktur XML identik)', () => {
    const src = load('09_multi_run.docx');
    const r = analyzeDocx(src, 'x');
    const a = adaptDocx(src, r.mappings, r.groups);
    expect(structureSignature(a.zip.text('word/document.xml') as string)).toBe(structureSignature(src.text('word/document.xml') as string));
  });
  it('penanda eksplisit [KEY], «KEY», <<KEY>> dinormalkan ke {{KEY}}', () => {
    const z = load('01_surat_satu_halaman.docx').clone();
    z.set('word/document.xml', body(p('Nomor: [NOMOR_SURAT]') + p('Kepada «PENERIMA» dan &lt;&lt;TEMBUSAN&gt;&gt;')));
    const r = analyzeDocx(z, 'x.docx');
    const exp = r.mappings.filter((m) => m.confidence === 1);
    expect(exp.map((m) => m.placeholder_name).sort()).toEqual(['NOMOR_SURAT', 'PENERIMA', 'TEMBUSAN']);
    const a = adaptDocx(z, r.mappings, r.groups);
    expect(texts(a.zip.text('word/document.xml') as string)).toEqual(['Nomor: {{NOMOR_SURAT}}', 'Kepada {{PENERIMA}} dan {{TEMBUSAN}}']);
  });
});

describe('validation engine', () => {
  const prep = (f: string) => {
    const src = load(f);
    const r = analyzeDocx(src, f);
    r.mappings.forEach((m) => { if (m.status === 'confirm') m.status = 'confirmed'; });
    const a = adaptDocx(src, r.mappings, []);
    const values: Record<string, string> = {};
    for (const m of r.mappings) values[m.placeholder_name] ??= m.source_text;
    const g = fillZip(a.zip, { values, optionalKeys: new Set() });
    return { adapted: a.zip, gen: g.zip, unresolved: g.unresolved };
  };
  const run = (adapted: Zip, gen: Zip, unresolved: string[] = []) => validateGenerated(adapted, gen, { unresolved, output: gen.toBuffer() });
  const failing = (r: ReturnType<typeof run>) => r.checks.filter((c) => c.status === 'fail').map((c) => c.id);

  for (const f of files) {
    it(`hasil normal lolos validasi: ${f}`, () => {
      const { adapted, gen, unresolved } = prep(f);
      const r = run(adapted, gen, unresolved);
      expect(failing(r)).toEqual([]);
      expect(r.ok).toBe(true);
      expect(Object.keys(r.protected_hashes).length).toBeGreaterThan(3);
    });
  }
  it('header yang diubah → gagal dan menyebut komponen', () => {
    const { adapted, gen } = prep('06_header_footer.docx');
    const name = gen.names().find((n) => /^word\/header\d*\.xml$/.test(n))!;
    gen.set(name, (gen.text(name) as string).replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/, '<w:t>DIUBAH</w:t>').replace('<w:p>', '<w:p><w:r><w:t>x</w:t></w:r></w:p><w:p>'));
    const r = run(adapted, gen);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'protected')?.components).toContain(name);
  });
  it('logo yang dihapus/diganti → gagal', () => {
    const { adapted, gen } = prep('03_kop_logo.docx');
    const img = gen.names().find((n) => n.startsWith('word/media/'))!;
    gen.set(img, Buffer.from('bukan gambar'));
    const r = run(adapted, gen);
    expect(failing(r)).toContain('images');
    gen.remove(img);
    expect(failing(run(adapted, gen))).toContain('package');
  });
  it('margin/section berubah → gagal', () => {
    const { adapted, gen } = prep('01_surat_satu_halaman.docx');
    gen.set('word/document.xml', (gen.text('word/document.xml') as string).replace(/w:left="\d+"/, 'w:left="100"'));
    expect(failing(run(adapted, gen))).toContain('sections');
  });
  it('paragraf terlindungi dihapus → gagal', () => {
    const { adapted, gen } = prep('01_surat_satu_halaman.docx');
    const x = gen.text('word/document.xml') as string;
    const sc = scanPart('word/document.xml', x);
    const p = sc.paras.find((q) => /^Demikian/.test(q.text))!;
    gen.set('word/document.xml', x.slice(0, p.xmlStart) + x.slice(p.xmlEnd));
    expect(failing(run(adapted, gen))).toContain('protectedParas');
  });
  it('placeholder tersisa → gagal', () => {
    const { adapted, gen } = prep('01_surat_satu_halaman.docx');
    expect(failing(run(adapted, adapted, ['PERIHAL']))).toContain('placeholders');
    void gen;
  });
  it('XML rusak terdeteksi', () => {
    expect(xmlWellFormed('<a><b></a>')).toBeTruthy();
    expect(xmlWellFormed('<a><b/><c x="1">t</c></a>')).toBeNull();
  });
});
