import { structureSignature } from './inspect';
import { documentParts, scanPart } from './scan';
import { Zip, sha256 } from './zip';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface Check { id: string; label: string; status: CheckStatus; detail: string; components?: string[] }
export interface ValidationReport {
  ok: boolean; created_at: string; checks: Check[];
  /** SHA-256 komponen paket yang dilindungi pada template acuan. */
  protected_hashes: Record<string, string>;
  output_sha256: string;
}

const isBody = (n: string) => n === 'word/document.xml';
/** Komponen paket selain isi dokumen. Header/footer yang berisi token dianggap area editable. */
export function protectedParts(zip: Zip): string[] {
  return zip.names().filter((n) => !n.endsWith('/') && !isBody(n) && !((/^word\/(header|footer)\d*\.xml$/.test(n)) && (zip.text(n) ?? '').includes('{{')));
}
export function protectedHashes(zip: Zip): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of protectedParts(zip)) out[n] = sha256(zip.data(n) as Buffer);
  return out;
}

/** Pemeriksaan keseimbangan tag XML (tanpa parser DOM). Mengembalikan pesan galat atau null. */
export function xmlWellFormed(xml: string): string | null {
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  const stripped = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  for (const m of stripped.matchAll(re)) {
    if (m[4]) continue;
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return `Tag penutup </${m[2]}> tidak berpasangan`;
  }
  return stack.length ? `Tag <${stack[stack.length - 1]}> tidak ditutup` : null;
}

const all = (xml: string, re: RegExp) => xml.match(re) ?? [];
const count = (xml: string, re: RegExp) => all(xml, re).length;
const fieldCount = (z: Zip) => documentParts(z.names()).reduce((a, p) => { const x = z.text(p) ?? ''; return a + count(x, /<w:fldChar\s[^>]*w:fldCharType="begin"/g) + count(x, /<w:fldSimple\b/g); }, 0);
const fieldCodes = (z: Zip) => documentParts(z.names()).flatMap((p) => all(z.text(p) ?? '', /<w:instrText[^>]*>[^<]*<\/w:instrText>|<w:fldSimple\s[^>]*w:instr="[^"]*"/g)).join('|');

export function validateGenerated(ref: Zip, gen: Zip, ctx: { unresolved: string[]; output: Buffer; extra?: Check[] }): ValidationReport {
  const checks: Check[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string, components?: string[]) => checks.push({ id, label, status, detail, components });

  // 1. integritas paket
  const missing = ref.names().filter((n) => !gen.has(n)); const extra = gen.names().filter((n) => !ref.has(n));
  const needed = ['[Content_Types].xml', 'word/document.xml'].filter((n) => !gen.has(n));
  const pkgBad = [...missing, ...extra, ...needed];
  add('package', 'Integritas paket DOCX', pkgBad.length ? 'fail' : 'pass', pkgBad.length ? `Komponen hilang/bertambah: ${pkgBad.join(', ')}` : `${gen.names().length} komponen paket lengkap`, pkgBad);

  // 2. hash komponen terlindungi
  const hashes = protectedHashes(ref);
  const changed = Object.entries(hashes).filter(([n, h]) => !gen.has(n) || sha256(gen.data(n) as Buffer) !== h).map(([n]) => n);
  add('protected', 'Komponen terlindungi (SHA-256)', changed.length ? 'fail' : 'pass',
    changed.length ? `Berubah tidak terduga: ${changed.join(', ')}` : `${Object.keys(hashes).length} komponen identik dengan template`, changed);

  // 3. header/footer
  const hf = gen.names().filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));
  const hfBad = hf.filter((n) => xmlWellFormed(gen.text(n) ?? '') !== null || structureSignature(gen.text(n) ?? '') !== structureSignature(ref.text(n) ?? ''));
  add('headerfooter', 'XML header & footer', hfBad.length ? 'fail' : 'pass', hf.length ? (hfBad.length ? `Struktur berubah/rusak: ${hfBad.join(', ')}` : `${hf.length} bagian utuh`) : 'Tidak ada header/footer', hfBad);

  // 4. relasi
  const relNames = gen.names().filter((n) => n.endsWith('.rels'));
  const relBad: string[] = [];
  for (const rn of relNames) {
    if (gen.text(rn) !== ref.text(rn)) relBad.push(rn);
    const base = rn.replace(/_rels\/[^/]*\.rels$/, '');
    for (const m of (gen.text(rn) ?? '').matchAll(/<Relationship\s[^>]*>/g)) {
      if (/TargetMode="External"/.test(m[0])) continue;
      const t = /Target="([^"]+)"/.exec(m[0])?.[1]; if (!t) continue;
      const path = t.startsWith('/') ? t.slice(1) : (base + t).split('/').reduce<string[]>((a, s) => (s === '..' ? (a.pop(), a) : s === '.' ? a : (a.push(s), a)), []).join('/');
      if (!gen.has(path)) relBad.push(`${rn} → ${t}`);
    }
  }
  add('relationships', 'Relasi header/footer/gambar', relBad.length ? 'fail' : 'pass', relBad.length ? `Bermasalah: ${[...new Set(relBad)].join(', ')}` : `${relNames.length} berkas relasi utuh, semua target ada`, relBad);

  // 5. logo & gambar
  const media = ref.names().filter((n) => n.startsWith('word/media/'));
  const mediaBad = media.filter((n) => !gen.has(n) || sha256(gen.data(n) as Buffer) !== sha256(ref.data(n) as Buffer));
  const drawRef = documentParts(ref.names()).reduce((a, p) => a + count(ref.text(p) ?? '', /<w:drawing\b|<w:pict\b/g), 0);
  const drawGen = documentParts(gen.names()).reduce((a, p) => a + count(gen.text(p) ?? '', /<w:drawing\b|<w:pict\b/g), 0);
  const imgFail = mediaBad.length > 0 || drawRef !== drawGen;
  add('images', 'Logo & gambar', imgFail ? 'fail' : 'pass', imgFail ? `Gambar berubah (${mediaBad.join(', ') || `objek ${drawRef} → ${drawGen}`})` : `${media.length} berkas gambar, ${drawRef} objek gambar utuh`, mediaBad);

  // 6. section & halaman
  const refDoc = ref.text('word/document.xml') ?? ''; const genDoc = gen.text('word/document.xml') ?? '';
  const sect = (x: string) => all(x, /<w:sectPr[\s\S]*?<\/w:sectPr>|<w:sectPr\s*\/>/g).join('\n');
  const sectOk = sect(refDoc) === sect(genDoc);
  const pg = (x: string) => all(x, /<w:pgSz\s[^>]*>|<w:pgMar\s[^>]*>/g).join('|');
  add('sections', 'Properti section, ukuran & margin halaman', sectOk && pg(refDoc) === pg(genDoc) ? 'pass' : 'fail',
    sectOk ? `${count(genDoc, /<w:sectPr[\s>]/g)} section, ukuran & margin identik` : 'sectPr berubah');

  // 7. tabel
  const refS = scanPart('word/document.xml', refDoc); const genS = scanPart('word/document.xml', genDoc);
  const grid = (x: string) => all(x, /<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g);
  const gridBad = JSON.stringify(grid(refDoc)) !== JSON.stringify(grid(genDoc)) || refS.tables !== genS.tables;
  add('tables', 'Struktur tabel', gridBad ? 'fail' : (refS.rows.length !== genS.rows.length ? 'warn' : 'pass'),
    gridBad ? `Tabel/kisi kolom berubah (${refS.tables} → ${genS.tables})` : refS.rows.length !== genS.rows.length ? `Jumlah baris ${refS.rows.length} → ${genS.rows.length} (baris berulang)` : `${genS.tables} tabel, lebar kolom identik`);

  // 8. paragraf terlindungi (tanpa token): teks + format identik dan berurutan
  const sigOf = (xml: string, p: { xmlStart: number; xmlEnd: number; text: string }) => `${p.text}\u0001${structureSignature(xml.slice(p.xmlStart, p.xmlEnd))}`;
  const protectedParas = refS.paras.filter((p) => !p.text.includes('{{') && p.text.trim()).map((p) => sigOf(refDoc, p));
  const genSigs = genS.paras.map((p) => sigOf(genDoc, p));
  let gi = 0; const lost: string[] = [];
  for (const s of protectedParas) {
    let k = gi; while (k < genSigs.length && genSigs[k] !== s) k++;
    if (k === genSigs.length) lost.push(s.split('\u0001')[0].slice(0, 50)); else gi = k + 1;
  }
  add('protectedParas', 'Teks & format paragraf terlindungi', lost.length ? 'fail' : 'pass', lost.length ? `Berubah/hilang: ${lost.slice(0, 5).map((x) => `"${x}"`).join(', ')}` : `${protectedParas.length} paragraf tetap identik`, lost.slice(0, 5));

  // 9. field & nomor halaman
  const fOk = fieldCount(ref) === fieldCount(gen) && fieldCodes(ref) === fieldCodes(gen);
  add('fields', 'Field Word & nomor halaman', fOk ? 'pass' : 'fail', fOk ? `${fieldCount(gen)} field utuh` : 'Field berubah');

  // 10. kelengkapan placeholder
  const leftover = [...new Set(documentParts(gen.names()).flatMap((p) => scanPart(p, gen.text(p) ?? '').paras.flatMap((q) => [...q.text.matchAll(/\{\{[^}]*\}\}/g)].map((m) => m[0]))))];
  add('placeholders', 'Kelengkapan placeholder', leftover.length || ctx.unresolved.length ? 'fail' : 'pass',
    leftover.length || ctx.unresolved.length ? `Belum terisi: ${[...new Set([...leftover, ...ctx.unresolved.map((u) => `{{${u}}}`)])].join(', ')}` : 'Semua placeholder terisi');

  // 11. XML terbentuk baik
  const bad = documentParts(gen.names()).map((p) => [p, xmlWellFormed(gen.text(p) ?? '')] as const).filter(([, e]) => e);
  add('wellformed', 'XML isi dokumen', bad.length ? 'fail' : 'pass', bad.length ? bad.map(([p, e]) => `${p}: ${e}`).join('; ') : 'Terbentuk dengan baik', bad.map(([p]) => p));

  checks.push(...(ctx.extra ?? []));
  return { ok: !checks.some((c) => c.status === 'fail'), created_at: new Date().toISOString(), checks, protected_hashes: hashes, output_sha256: sha256(ctx.output) };
}
