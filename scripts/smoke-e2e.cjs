// Uji jalan aplikasi yang sudah di-build (dist/ + dist-electron/) pada OS tempat skrip dijalankan.
// Pakai: node scripts/smoke-e2e.cjs [laporan.json]   (Linux tanpa layar: xvfb-run -a node ...)
// Mencakup: inisialisasi DB, semua halaman tanpa galat, dokumen + ekspor DOCX/PDF bernama Unicode,
// ekspor lalu impor XLSX, backup penuh lalu restore. Env: SMOKE_KEEP_BACKUP=<zip> menyimpan backup uji,
// SMOKE_FOREIGN_BACKUP=<zip> memulihkan backup buatan OS lain. Dialog sistem diganti stub (tidak ada klik manusia).
const { _electron } = require('playwright');
const electronPath = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROUTES = ['/', '/generator', '/templates', '/archive', '/importer', '/importer/history', '/bank-nomor', '/penomoran', '/register/surat-keluar',
  '/ppk/laporan', '/ppk/anggaran', '/ppk/kontrak', '/ppk/tagihan', '/ppk/rekonsiliasi', '/ppk/penyedia', '/ppk/impor', '/ppk/pengaturan', '/settings'];
const UNICODE = 'Surat Undangan – Rapat Ñ ä ẞ';

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nd smoke Ñ-'));
  const ud = path.join(root, 'Data Uji – é'); // macOS: tmpdir /var adalah symlink ke /private/var, jadi dibandingkan lewat realpath
  const out = path.join(root, 'Ekspor ü');
  fs.mkdirSync(out);
  const results = []; const errors = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${detail ? `  (${detail})` : ''}`); };

  // SMOKE_EXE = biner aplikasi terpasang (installer/DMG); tanpa itu, build pengembangan di folder ini.
  const exe = process.env.SMOKE_EXE;
  const app = await _electron.launch({ executablePath: exe || electronPath,
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(exe ? [] : ['.']), `--user-data-dir=${ud}`] });
  const w = await app.firstWindow();
  let here = 'start';
  w.on('pageerror', (e) => errors.push(`${here}: ${e.message}`));
  w.on('console', (m) => { if (m.type() === 'error') errors.push(`${here}: ${m.text().slice(0, 300)}`); });
  await w.waitForSelector('main', { timeout: 30000 });
  const call = async (ch, arg) => {
    const r = await w.evaluate(([c, a]) => window.api.invoke(c, a), [ch, arg]);
    if (!r.ok) throw new Error(`${ch}: ${r.error}`);
    return r.data;
  };
  const stubSave = (file) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }); }, file);
  const stubOpen = (file) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, file);

  const info = await call('app:info');
  check('Database dibuat di folder data OS', fs.existsSync(info.dbPath) && fs.realpathSync(info.dbPath).startsWith(fs.realpathSync(ud)), `${info.platform} ${process.arch}, ${info.dbPath}`);

  for (const r of ROUTES) {
    here = r; const before = errors.length;
    await w.evaluate((h) => { location.hash = `#${h}`; }, r); await w.waitForTimeout(800);
    const text = (await w.locator('main').innerText().catch(() => '')).trim();
    check(`Halaman ${r}`, text.length > 0 && errors.length === before, errors.slice(before).join(' | '));
  }
  here = 'dokumen';

  // Dokumen dari template bawaan, lalu ekspor DOCX dan PDF ke nama berkas Unicode.
  const tpl = (await call('templates:list', {}))[0];
  const full = await call('templates:get', { id: tpl.id });
  const doc = { title: UNICODE, category_code: 'UND', doc_date: '2026-11-26', content: full.content, layout: full.layout, header_text: '', footer_text: '', use_kop: false };
  const docInput = { template_id: null, template_name: tpl.name, category_id: null, title: UNICODE, letter_number: '', recipient: 'Kepala Dinas',
    subject: 'Uji lintas platform', doc_date: '2026-11-26', status: 'draft', content: full.content, layout: full.layout, header_text: '', footer_text: '', form_values: {}, use_kop: false };
  const saved = await call('documents:save', docInput).catch((e) => ({ error: String(e) }));
  check('Dokumen tersimpan', saved && saved.id, saved.error ?? '');
  const docx = path.join(out, `${UNICODE}.docx`); await stubSave(docx);
  await call('export:docx', { doc });
  check('Ekspor DOCX (nama Unicode)', fs.existsSync(docx) && fs.readFileSync(docx).subarray(0, 2).toString() === 'PK', `${fs.existsSync(docx) ? fs.statSync(docx).size : 0} byte`);
  const pdf = path.join(out, `${UNICODE}.pdf`); await stubSave(pdf);
  await call('export:pdf', { doc });
  check('Ekspor PDF (nama Unicode)', fs.existsSync(pdf) && fs.readFileSync(pdf).subarray(0, 4).toString() === '%PDF', `${fs.existsSync(pdf) ? fs.statSync(pdf).size : 0} byte`);

  // XLSX: ekspor register penomoran lalu baca kembali lewat pratinjau impor.
  here = 'xlsx';
  const reg = (await call('numbering:registers'))[0];
  const xlsx = path.join(out, `Register ${UNICODE}.xlsx`); await stubSave(xlsx);
  await call('numbering:exportXlsx', { register_id: reg.id });
  check('Ekspor XLSX', fs.existsSync(xlsx) && fs.readFileSync(xlsx).subarray(0, 2).toString() === 'PK');
  await stubOpen(xlsx);
  const pick = await call('numbering:importPick').catch((e) => ({ error: String(e) }));
  check('Impor XLSX (baca kembali)', pick && !pick.error && !pick.canceled, pick.error ?? `${(pick.preview?.sheets ?? []).length} lembar`);

  // Backup penuh, ubah data, restore, pastikan data kembali ke keadaan backup.
  here = 'backup';
  const bak = await call('backup:create', { type: 'full' });
  check('Backup penuh', fs.existsSync(bak.path), `${bak.size} byte`);
  const extra = await call('documents:save', { ...docInput, title: 'Sesudah backup' }).catch((e) => ({ error: String(e) }));
  const countBefore = (await call('documents:list', {})).length;
  await stubOpen(bak.path);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  const res = await call('backup:restore').catch((e) => ({ error: String(e) }));
  await w.waitForLoadState('domcontentloaded'); await w.waitForTimeout(1500);
  const after = await call('documents:list', {});
  check('Restore backup penuh', !res.error && after.length === countBefore - 1 && !after.some((d) => d.title === 'Sesudah backup'),
    res.error ?? `${countBefore} → ${after.length} dokumen${extra.error ? `, ${extra.error}` : ''}`);
  if (process.env.SMOKE_KEEP_BACKUP) fs.copyFileSync(bak.path, process.env.SMOKE_KEEP_BACKUP);

  // Backup dari OS lain (CI): harus bisa dipulihkan di sini dan memuat dokumen uji.
  const foreign = process.env.SMOKE_FOREIGN_BACKUP;
  if (foreign) {
    await stubOpen(path.resolve(foreign));
    const fr = await call('backup:restore').catch((e) => ({ error: String(e) }));
    await w.waitForLoadState('domcontentloaded'); await w.waitForTimeout(1500);
    const docs = await call('documents:list', {});
    check(`Restore backup dari OS lain (${path.basename(foreign)})`, !fr.error && docs.some((d) => d.title === UNICODE), fr.error ?? `${docs.length} dokumen`);
  }

  check('Tanpa galat konsol', errors.length === 0, errors.join(' | '));
  const electronVersion = await app.evaluate(() => process.versions.electron);
  await app.close();
  const report = { packaged: !!exe, platform: process.platform, arch: process.arch, release: os.release(), app: info.version, electron: electronVersion, results };
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(report, null, 2));
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
