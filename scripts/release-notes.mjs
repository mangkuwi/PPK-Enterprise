// Catatan rilis: bagian versi dari CHANGELOG.md + hasil uji jalan per platform (berkas smoke-*.json / cross-*.json dari CI).
// Pakai: node scripts/release-notes.mjs v1.2.0 <folder-hasil-uji>
import fs from 'node:fs';
import path from 'node:path';

const [tag = '', dir = '.'] = process.argv.slice(2);
const version = tag.replace(/^v/, '');
const log = fs.existsSync('CHANGELOG.md') ? fs.readFileSync('CHANGELOG.md', 'utf8') : '';
const section = log.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`) || s.startsWith(`[${version}]`));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const reports = fs.existsSync(dir) ? walk(dir).filter((f) => /(smoke|cross)-.*\.json$/.test(f)).sort() : [];

const out = [`# PPK Management ${tag}`, '', section ? section.slice(section.indexOf('\n') + 1).trim() : '_Belum ada catatan perubahan untuk versi ini di CHANGELOG.md._', '',
  '## Hasil uji jalan otomatis', '', '| Uji | Platform | Lulus | Gagal |', '| --- | --- | --- | --- |'];
for (const f of reports) {
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const failed = r.results.filter((x) => !x.ok);
  out.push(`| ${path.basename(f, '.json')} | ${r.platform} ${r.arch} (${r.release}) | ${r.results.length - failed.length} | ${failed.length ? failed.map((x) => x.name).join(', ') : 0} |`);
}
if (!reports.length) out.push('| — | Tidak ada hasil uji | — | — |');
out.push('', 'Belum diuji otomatis: Windows 10, macOS 13 Ventura, keyboard/trackpad/Retina (uji manual: docs/TEST-CHECKLIST.md).',
  'Tanda tangan: lihat docs/RELEASE.md. Rilis ini hanya "dinotarisasi" bila langkah stapler di CI lulus.', '', 'Checksum SHA-256: SHA256SUMS.txt');
console.log(out.join('\n'));
