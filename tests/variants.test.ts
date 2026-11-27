import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type DB } from '../electron/main/db';
import { LATEST_SCHEMA, currentVersion, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import * as repo from '../electron/main/repo';
import * as svc from '../electron/main/importer-service';
import { Zip, sha256 } from '../electron/main/ooxml/zip';
import { scanPart } from '../electron/main/ooxml/scan';
import { analyzeDocx } from '../electron/main/ooxml/analyze';
import { detectVariants, projectVariants, segmentBody, selectionFromValues, splitBody, verifyProjection } from '../electron/main/ooxml/variants';

const FX = path.join(__dirname, 'fixtures');
const read = (f: string) => fs.readFileSync(path.join(FX, f));
let db: DB;
beforeEach(() => { db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); });
afterEach(() => db.close());

const bodyText = (z: Zip) => scanPart('word/document.xml', z.text('word/document.xml') as string).paras.map((p) => p.text);
const vals = (templateId: string, over: Record<string, string> = {}) => {
  const t = repo.getTemplate(db, templateId)!;
  const v: Record<string, string> = {};
  for (const f of t.fields) v[f.key] = f.default_value || (f.required ? 'x' : '');
  return { ...v, ...over };
};
/** Impor → (konfirmasi mapping ragu) → simpan sebagai template. */
function importSave(file: string) {
  const id = svc.importDocx(db, read(file), file);
  const rv = svc.getReview(db, id);
  const mappings = rv.analysis.mappings.map((m) => (m.status === 'confirm' ? { ...m, status: 'confirmed' as const } : m));
  const groups = rv.analysis.groups.map((g) => ({ ...g, status: 'confirmed' as const }));
  svc.saveReview(db, { id, mappings, groups, name: 'Nota Dinas', description: '', category_id: rv.summary.category_id, protected_keys: [] });
  return { id, templateId: svc.saveAsTemplate(db, id), rv };
}
const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe('migrasi v4', () => {
  it('tabel template_variants ada', () => {
    expect(currentVersion(db)).toBe(LATEST_SCHEMA);
    expect(LATEST_SCHEMA).toBeGreaterThanOrEqual(4);
    expect(!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='template_variants'").get()).toBe(true);
    expect((db.prepare('PRAGMA table_info(template_versions)').all() as any[]).map((c) => c.name)).toContain('variants_json');
  });
});

describe('segmentasi & deteksi varian', () => {
  it('memecah badan dokumen dan halaman menurut pemisah eksplisit', () => {
    const xml = Zip.read(read('12_varian_paraf.docx')).text('word/document.xml') as string;
    const blocks = splitBody(xml)!;
    expect(blocks.filter((b) => b.kind === 'sect').length).toBe(1);
    const { segs } = segmentBody(xml, blocks);
    expect(segs.length).toBe(2);
    expect(segs[0].trail).toBe('brPara');
    expect(segs[1].trail).toBe('none');
  });
  it('dua halaman Nota Dinas dengan kolom paraf berbeda → satu kelompok, dua varian', () => {
    const z = Zip.read(read('12_varian_paraf.docx'));
    const det = detectVariants(z, analyzeDocx(z, 'x').mappings);
    expect(det.groups.length).toBe(1);
    const g = det.groups[0];
    expect(g.status).toBe('auto');
    expect(g.kind).toBe('PARAF');
    expect(g.field_key).toBe('VARIANT_PARAF');
    expect(g.variants.map((v) => v.letter)).toEqual(['A', 'B']);
    expect(g.variants[1].diffs.some((d) => d.kind === 'table_structure' && !d.shared)).toBe(true);
    expect(g.variants[1].align.length).toBeGreaterThan(8);
  });
  it('lampiran yang berbeda isi BUKAN varian; dokumen satu halaman tanpa kelompok', () => {
    for (const f of ['14_dua_halaman_beda.docx', '01_surat_satu_halaman.docx', '02_surat_beberapa_halaman.docx', '10_landscape_multisection.docx']) {
      const z = Zip.read(read(f));
      expect(detectVariants(z, analyzeDocx(z, 'x').mappings).groups.length).toBe(0);
    }
  });
  it('perbedaan nilai contoh (nomor/tanggal) dikenali sebagai isian bersama, bukan wilayah khusus', () => {
    const z = Zip.read(read('13_varian_nilai_beda.docx'));
    const g = detectVariants(z, analyzeDocx(z, 'x').mappings).groups[0];
    const shared = g.variants[1].diffs.filter((d) => d.shared);
    expect(shared.length).toBe(2);
    expect(g.variants[1].diffs.filter((d) => !d.shared).length).toBe(1);
  });
});

describe('uji penerimaan: 1 master, 1 kategori, 2 varian, 1 konfigurasi bersama', () => {
  it('registrasi tunggal tanpa duplikasi', () => {
    const cats0 = count('SELECT COUNT(*) n FROM categories');
    const { id, templateId, rv } = importSave('12_varian_paraf.docx');
    expect(rv.variant_groups.length).toBe(1);
    expect(rv.variant_groups[0].variants.length).toBe(2);
    const reg = svc.variantRegistry(db, id);
    expect(reg.master_templates).toBe(1);
    expect(reg.template_variants).toBe(2);
    expect(reg.shared_placeholder_configurations).toBe(1);
    expect(reg.duplicated_in_variants).toBe(0);
    expect(count("SELECT COUNT(*) n FROM templates WHERE kind='docx'")).toBe(1);
    expect(count('SELECT COUNT(*) n FROM imported_templates')).toBe(1);
    expect(count('SELECT COUNT(*) n FROM categories')).toBe(cats0); // tidak ada kategori baru
    expect(count('SELECT COUNT(*) n FROM template_variants')).toBe(2);
    // konfigurasi bersama: tiap placeholder hanya sekali; pemilih varian ada
    const keys = repo.getTemplate(db, templateId)!.fields.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('VARIANT_PARAF');
    expect(keys.filter((k) => /_2$/.test(k)).length).toBe(0);
    const info = svc.getDocxTemplateInfo(db, templateId)!;
    expect(info.variants.length).toBe(1);
    expect(info.variants[0].options.map((o) => o.label)).toEqual(['Kolom Paraf Format A', 'Kolom Paraf Format B']);
  });

  it('memilih varian A atau B tanpa kategori baru; hanya kolom paraf yang berbeda', () => {
    const { templateId } = importSave('12_varian_paraf.docx');
    const a = svc.generateFromTemplate(db, templateId, vals(templateId, { NOMOR_SURAT: 'ND-777/DS/XI/2026' }));
    const b = svc.generateFromTemplate(db, templateId, vals(templateId, { NOMOR_SURAT: 'ND-777/DS/XI/2026', VARIANT_PARAF: 'Kolom Paraf Format B' }));
    for (const r of [a, b]) {
      expect(r.report.ok).toBe(true);
      const t = bodyText(r.zip);
      expect(t.filter((x) => x === 'NOTA DINAS').length).toBe(1); // satu halaman saja
      expect(t.join('\n')).toContain('ND-777/DS/XI/2026');
      expect((r.zip.text('word/document.xml') as string).includes('w:type="page"')).toBe(false); // tak ada halaman kosong
      expect(r.report.checks.find((c) => c.id === 'variant')!.status).toBe('pass');
    }
    expect(bodyText(a.zip).join('|')).toContain('Kepala Subbagian');
    expect(bodyText(a.zip).join('|')).not.toContain('Paraf 4');
    expect(bodyText(b.zip).join('|')).toContain('Paraf 4');
    expect(bodyText(b.zip).join('|')).not.toContain('Kepala Subbagian');
    // lebar kolom paraf mengikuti varian (struktur tabel asli tidak diubah)
    expect((a.zip.text('word/document.xml') as string).match(/<w:gridCol /g)!.length).not.toBe((b.zip.text('word/document.xml') as string).match(/<w:gridCol /g)!.length);
  });

  it('master & sumber asli tidak berubah setelah generate', () => {
    const { id, templateId } = importSave('12_varian_paraf.docx');
    const snap = () => db.prepare('SELECT original_sha256, adapted_blob FROM imported_templates WHERE id=?').get(id) as any;
    const before = snap();
    svc.generateFromTemplate(db, templateId, vals(templateId, { VARIANT_PARAF: 'Kolom Paraf Format B' }));
    svc.generateFromTemplate(db, templateId, vals(templateId));
    const after = snap();
    expect(after.original_sha256).toBe(before.original_sha256);
    expect(sha256(Buffer.from(after.adapted_blob))).toBe(sha256(Buffer.from(before.adapted_blob)));
    expect(Zip.read(Buffer.from(after.adapted_blob)).text('word/document.xml')!.includes('w:type="page"')).toBe(true); // kedua halaman tetap ada di master
  });

  it('nilai contoh berbeda di halaman varian tetap satu konfigurasi (tanpa NOMOR_SURAT_2)', () => {
    const { id, templateId } = importSave('13_varian_nilai_beda.docx');
    const keys = repo.getTemplate(db, templateId)!.fields.map((f) => f.key);
    expect(keys.filter((k) => k.startsWith('NOMOR_SURAT')).length).toBe(1);
    expect(keys.filter((k) => k.startsWith('TANGGAL')).length).toBeLessThan(3);
    const b = svc.generateFromTemplate(db, templateId, vals(templateId, { VARIANT_PARAF: 'Kolom Paraf Format B', NOMOR_SURAT: 'ND-555/DS/XI/2026' }));
    expect(b.report.ok).toBe(true);
    expect(bodyText(b.zip).join('\n')).toContain('ND-555/DS/XI/2026'); // pewarisan: token juga ada di halaman varian B
    expect(bodyText(b.zip).join('\n')).not.toContain('ND-014/DS/XI/2026');
    expect(svc.variantRegistry(db, id).duplicated_in_variants).toBe(0);
  });

  it('dokumen tersimpan membawa pilihan varian dan lolos validasi ekspor', () => {
    const { templateId } = importSave('12_varian_paraf.docx');
    const doc = svc.createDocxDocument(db, { template_id: templateId, title: 'ND B', values: vals(templateId, { VARIANT_PARAF: 'Kolom Paraf Format B' }), category_id: null, template_name: 'T', doc_date: '', letter_number: '', recipient: '', subject: '' });
    expect(doc.form_values.VARIANT_PARAF).toBe('Kolom Paraf Format B');
    expect(svc.verifyForExport(db, doc.id).ok).toBe(true);
    const re = svc.regenerateDocxDocument(db, doc.id, { ...doc.form_values, VARIANT_PARAF: 'Kolom Paraf Format A' });
    const z = Zip.read(svc.getDocumentDocx(db, re.id).buf as Buffer);
    expect(bodyText(z).join('|')).toContain('Kepala Subbagian');
    // pembanding visual memakai sumber asli pada varian yang SAMA dengan dokumen
    const vi = svc.getVisualInputs(db, doc.id);
    expect(vi.original.length).toBeGreaterThan(1000);
  });

  it('nama varian tidak dikenal ditolak dengan pesan jelas', () => {
    const { templateId } = importSave('12_varian_paraf.docx');
    expect(() => svc.generateFromTemplate(db, templateId, vals(templateId, { VARIANT_PARAF: 'Format Z' }))).toThrow(/tidak ditemukan/);
  });

  it('mengganti nama varian disimpan, harus unik dan tidak kosong', () => {
    const { id } = importSave('12_varian_paraf.docx');
    const rv = svc.getReview(db, id);
    const g = rv.variant_groups[0];
    const input = { id, mappings: rv.analysis.mappings, groups: rv.analysis.groups, name: 'N', description: '', category_id: null, protected_keys: [] as string[] };
    expect(() => svc.saveReview(db, { ...input, variant_edits: [{ group_no: 1, labels: { [g.variants[0].id]: 'Sama', [g.variants[1].id]: 'Sama' } }] })).toThrow(/unik/);
    expect(() => svc.saveReview(db, { ...input, variant_edits: [{ group_no: 1, labels: { [g.variants[0].id]: ' ' } }] })).toThrow(/kosong/);
    svc.saveReview(db, { ...input, variant_edits: [{ group_no: 1, labels: { [g.variants[0].id]: 'Paraf Tiga Kolom', [g.variants[1].id]: 'Paraf Empat Kolom' } }] });
    svc.saveAsTemplate(db, id);
    expect(svc.getReview(db, id).variant_groups[0].variants.map((v) => v.label)).toEqual(['Paraf Tiga Kolom', 'Paraf Empat Kolom']);
  });
});

describe('klasifikasi kurang pasti', () => {
  it('meminta konfirmasi; template tidak bisa disimpan sebelum diputuskan', () => {
    const id = svc.importDocx(db, read('15_varian_ragu.docx'), '15.docx');
    const rv = svc.getReview(db, id);
    expect(rv.variant_groups[0].status).toBe('confirm');
    expect(rv.inherited_count).toBe(0); // belum ada pewarisan
    const mappings = rv.analysis.mappings.map((m) => ({ ...m, status: m.status === 'confirm' ? ('confirmed' as const) : m.status }));
    svc.saveReview(db, { id, mappings, groups: [], name: 'N', description: '', category_id: null, protected_keys: [] });
    expect(() => svc.saveAsTemplate(db, id)).toThrow(/menunggu keputusan/);
  });
  it('konfirmasi → pemetaan duplikat di halaman varian digantikan pewarisan', () => {
    const id = svc.importDocx(db, read('15_varian_ragu.docx'), '15.docx');
    const before = svc.getReview(db, id).analysis.mappings.length;
    svc.decideVariants(db, id, 1, 'confirm');
    const rv = svc.getReview(db, id);
    expect(rv.variant_groups[0].status).toBe('confirmed');
    expect(rv.analysis.mappings.length).toBeLessThan(before);
    expect(rv.inherited_count).toBeGreaterThan(3);
    const tid = (() => {
      const mappings = rv.analysis.mappings.map((m) => ({ ...m, status: m.status === 'confirm' ? ('confirmed' as const) : m.status }));
      svc.saveReview(db, { id, mappings, groups: [], name: 'N', description: '', category_id: null, protected_keys: [] });
      return svc.saveAsTemplate(db, id);
    })();
    expect(repo.getTemplate(db, tid)!.fields.map((f) => f.key)).toContain('VARIANT_PARAF');
  });
  it('tolak → satu template utuh dengan kedua halaman, tanpa halaman dibuang atau digabung', () => {
    const id = svc.importDocx(db, read('15_varian_ragu.docx'), '15.docx');
    svc.decideVariants(db, id, 1, 'reject');
    expect(count('SELECT COUNT(*) n FROM template_variants')).toBe(0);
    const rv = svc.getReview(db, id);
    const mappings = rv.analysis.mappings.map((m) => ({ ...m, status: m.status === 'confirm' ? ('confirmed' as const) : m.status }));
    svc.saveReview(db, { id, mappings, groups: rv.analysis.groups.map((g) => ({ ...g, status: 'confirmed' as const })), name: 'N', description: '', category_id: null, protected_keys: [] });
    const tid = svc.saveAsTemplate(db, id);
    expect(repo.getTemplate(db, tid)!.fields.map((f) => f.key)).not.toContain('VARIANT_PARAF');
    const r = svc.generateFromTemplate(db, tid, vals(tid));
    expect(bodyText(r.zip).filter((x) => x === 'NOTA DINAS').length).toBe(2);
    // analisis ulang tidak menghidupkan kembali varian yang ditolak
    svc.reanalyze(db, id);
    expect(count('SELECT COUNT(*) n FROM template_variants')).toBe(0);
  });
});

describe('jenis pemisah halaman lain', () => {
  const variantXml = (mut: (xml: string) => string) => {
    const z = Zip.read(read('12_varian_paraf.docx')).clone();
    z.set('word/document.xml', mut(z.text('word/document.xml') as string));
    return Zip.read(z.toBuffer());
  };
  const BRP = /<w:p>(?:<w:pPr>[\s\S]*?<\/w:pPr>)?<w:r><w:br w:type="page"\/><\/w:r><\/w:p>/;
  const pick = (z: Zip, label: string) => {
    const det = detectVariants(z, analyzeDocx(z, 'x').mappings);
    expect(det.groups.length).toBe(1);
    const g = det.groups[0];
    return { g, sel: selectionFromValues([{ ...g, status: 'auto' }], { VARIANT_PARAF: label }) };
  };
  it('page break di akhir paragraf (brRun)', () => {
    const z = variantXml((x) => { expect(BRP.test(x)).toBe(true); return x.replace(BRP, '<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:br w:type="page"/></w:r></w:p>'); });
    const { g, sel } = pick(z, 'Kolom Paraf Format A');
    expect(g.variants.length).toBe(2);
    const out = projectVariants(z, sel);
    expect((out.text('word/document.xml') as string).includes('w:type="page"')).toBe(false);
    expect(verifyProjection(z, out, sel).ok).toBe(true);
    const outB = projectVariants(z, pick(z, 'Kolom Paraf Format B').sel);
    expect(verifyProjection(z, outB, pick(z, 'Kolom Paraf Format B').sel).ok).toBe(true);
    expect(bodyText(outB).join('|')).toContain('Paraf 4');
  });
  it('pageBreakBefore pada paragraf pertama halaman berikutnya', () => {
    const z = variantXml((x) => {
      const y = x.replace(BRP, '');
      const at = y.indexOf('NOTA DINAS', y.indexOf('NOTA DINAS') + 1);
      const pStart = y.lastIndexOf('<w:p>', at); const pPr = y.indexOf('<w:pPr>', pStart);
      return y.slice(0, pPr + 7) + '<w:pageBreakBefore/>' + y.slice(pPr + 7);
    });
    const xml = z.text('word/document.xml') as string;
    const { segs } = segmentBody(xml, splitBody(xml)!);
    expect(segs.length).toBe(2);
    expect(segs[1].lead).toBe('pbb');
    for (const label of ['Kolom Paraf Format A', 'Kolom Paraf Format B']) {
      const { sel } = pick(z, label);
      const out = projectVariants(z, sel);
      expect(verifyProjection(z, out, sel).ok).toBe(true);
    }
  });
  it('pemisah section: varian hanya dilaporkan, tidak bisa dipilih otomatis', () => {
    const z = variantXml((x) => x.replace(BRP, '<w:p><w:pPr><w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:pPr></w:p>'));
    const det = detectVariants(z, analyzeDocx(z, 'x').mappings);
    expect(det.groups.length).toBe(1);
    expect(det.groups[0].selectable).toBe(false);
    expect(det.groups[0].status).toBe('confirm');
    const id = svc.importDocx(db, z.toBuffer(), 's.docx');
    expect(() => svc.decideVariants(db, id, 1, 'confirm')).toThrow(/tidak dapat dipilih otomatis/);
  });
  it('struktur halaman berubah sejak didaftarkan → proyeksi ditolak', () => {
    const z = Zip.read(read('12_varian_paraf.docx'));
    const g = detectVariants(z, analyzeDocx(z, 'x').mappings).groups[0];
    g.variants[1].block_first += 1;
    expect(() => projectVariants(z, [{ group: g, variantId: g.variants[0].id }])).toThrow(/Struktur halaman template berubah/);
  });
});

describe('dokumen lama tetap bekerja', () => {
  it('template tanpa varian tidak mendapat isian pemilih', () => {
    const { templateId } = importSave('04_surat_tabel.docx');
    expect(repo.getTemplate(db, templateId)!.fields.map((f) => f.key).some((k) => k.startsWith('VARIANT_'))).toBe(false);
    expect(svc.getDocxTemplateInfo(db, templateId)!.variants.length).toBe(0);
  });
});
