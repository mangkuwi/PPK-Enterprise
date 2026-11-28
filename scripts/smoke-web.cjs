// Uji mode server (`npm run server`) lewat browser sungguhan: login, semua halaman tanpa galat konsol/CSP,
// unggah berkas, unduh ekspor, buka lampiran, tolak permintaan situs lain, dan batas percobaan login per IP.
// Pakai (setelah `npm run build`): node scripts/smoke-web.cjs   (Linux tanpa layar: xvfb-run -a node scripts/smoke-web.cjs)
const { _electron, chromium } = require('playwright');
const electronPath = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 18080; const BASE = `http://localhost:${PORT}`; const PASS = 'smoke-sandi-1';
const ROUTES = ['/', '/archive', '/bank-nomor', '/ppk/laporan', '/ppk/anggaran', '/ppk/kontrak', '/ppk/tagihan', '/ppk/penyedia', '/ppk/agenda', '/ppk/kotak-masuk'];
const linux = process.platform === 'linux' ? ['--no-sandbox'] : [];

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppk web smoke-'));
  const ud = path.join(root, 'data');
  const results = [];
  const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${detail ? `  (${detail})` : ''}`); };

  // 1. Data baru: kata sandi administrator dibuat sekali lewat aplikasi desktop (server menolak jalan tanpanya).
  const desk = await _electron.launch({ executablePath: electronPath, args: [...linux, '.', `--user-data-dir=${ud}`] });
  const dw = await desk.firstWindow();
  await dw.waitForSelector('main, form', { timeout: 30000 });
  const who = (await dw.evaluate(() => window.api.invoke('numbering:whoami'))).data;
  await dw.evaluate(([id, pin]) => window.api.invoke('numbering:setPin', { id, pin }), [who.actor.id, PASS]);
  await desk.close();

  // 2. Server tanpa jendela.
  const srv = spawn(electronPath, [...linux, '.', '--server', `--port=${PORT}`, `--user-data-dir=${ud}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; srv.stdout.on('data', (d) => { out += d; }); srv.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 60 && !out.includes(BASE); i++) await new Promise((r) => setTimeout(r, 500));
  check('Server menyala tanpa jendela', out.includes(BASE), out.trim().split('\n').slice(-3).join(' / '));

  try {
    const browser = await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = []; let here = 'login';
    page.on('pageerror', (e) => errors.push(`${here}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${here}: ${m.text().slice(0, 200)}`); });
    const call = async (ch, arg) => {
      const r = await page.evaluate(([c, a]) => window.api.invoke(c, a), [ch, arg]);
      if (!r.ok) throw new Error(`${ch}: ${r.error}`);
      return r.data;
    };
    await page.goto(BASE);
    await page.waitForSelector('form', { timeout: 30000 });
    const w = await call('numbering:whoami').catch(() => null);
    const users = await call('numbering:users').catch(() => []);
    const admin = users.find((u) => u.role === 'admin') ?? w?.actor;
    await call('numbering:login', { user_id: admin.id, pin: PASS });
    await page.reload(); await page.waitForSelector('main', { timeout: 30000 });
    check('Login dari browser', true);

    for (const r of ROUTES) {
      here = r; const before = errors.length;
      await page.evaluate((h) => { location.hash = `#${h}`; }, r); await page.waitForTimeout(700);
      const text = (await page.locator('main').innerText().catch(() => '')).trim();
      check(`Halaman ${r}`, text.length > 0 && errors.length === before, errors.slice(before).join(' | '));
    }

    // Ekspor: browser menerima berkas unduhan; lokasi di server tidak ditampilkan.
    here = 'unduh';
    const reg = (await call('numbering:registers'))[0];
    const [dl, xr] = await Promise.all([page.waitForEvent('download'), call('numbering:exportXlsx', { register_id: reg.id })]);
    const xlsx = path.join(root, dl.suggestedFilename()); await dl.saveAs(xlsx);
    check('Ekspor Excel diunduh browser', fs.readFileSync(xlsx).subarray(0, 2).toString() === 'PK' && !String(xr.path).includes(path.sep), `${dl.suggestedFilename()}, path=${xr.path}`);
    const quiet = errors.length; // 404 di bawah memang disengaja
    const again = await page.evaluate(async (u) => (await fetch(u)).status, new URL(dl.url()).pathname);
    check('Tautan unduhan hanya sekali pakai', again === 404);
    errors.length = quiet;

    // Unggah: pemilih berkas browser → perintah impor di server.
    here = 'unggah';
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => { window.__pick = window.api.invoke('numbering:importPick'); })]);
    await fc.setFiles(xlsx);
    const pick = await page.evaluate(() => window.__pick);
    check('Unggah Excel untuk impor', pick.ok && !pick.data.canceled, pick.ok ? pick.data.file_name : pick.error);

    // PDF undangan: unggah lalu buka lampiran (diunduh).
    const tpl = (await call('templates:list', {}))[0]; const full = await call('templates:get', { id: tpl.id });
    const doc = { title: 'Undangan Rapat Ñ', category_code: 'UND', doc_date: '2026-11-28', content: full.content, layout: full.layout, header_text: '', footer_text: '', use_kop: false };
    const [pdl] = await Promise.all([page.waitForEvent('download'), call('export:pdf', { doc })]);
    const pdf = path.join(root, pdl.suggestedFilename()); await pdl.saveAs(pdf);
    check('Ekspor PDF diunduh browser', fs.readFileSync(pdf).subarray(0, 4).toString() === '%PDF', pdl.suggestedFilename());
    const [fc2] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => { window.__up = window.api.invoke('ppk:invitations:upload', { note: 'uji web' }); })]);
    await fc2.setFiles(pdf);
    const up = await page.evaluate(() => window.__up);
    check('Unggah PDF undangan', up.ok && up.data && up.data.id, up.ok ? '' : up.error);
    if (up.ok && up.data) {
      const files = await call('ppk:invitations:files', { id: up.data.id });
      const [odl] = await Promise.all([page.waitForEvent('download'), call('ppk:files:open', { id: files[0].id })]);
      check('Buka lampiran = unduh', odl.suggestedFilename().endsWith('.pdf'), odl.suggestedFilename());
    }
    check('Tanpa galat konsol/CSP', errors.length === 0, errors.join(' | '));

    // Keamanan: header, permintaan dari situs lain, batas login per IP.
    here = 'keamanan';
    const head = await fetch(BASE);
    check('Header CSP dan X-Frame-Options', !!head.headers.get('content-security-policy') && head.headers.get('x-frame-options') === 'DENY');
    const evil = await fetch(`${BASE}/api/invoke`, { method: 'POST', headers: { 'X-PPK': '1', 'Content-Type': 'application/json', Origin: 'https://jahat.example' }, body: JSON.stringify({ channel: 'numbering:whoami' }) });
    check('Permintaan dari situs lain ditolak', evil.status === 404);
    const viaProxy = await fetch(`${BASE}/api/invoke`, { method: 'POST', headers: { 'X-PPK': '1', 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https' }, body: JSON.stringify({ channel: 'numbering:login', payload: { user_id: admin.id, pin: PASS } }) });
    const cookie = viaProxy.headers.get('set-cookie') ?? '';
    check('Di belakang HTTPS: cookie Secure + HSTS', /Secure/.test(cookie) && !!viaProxy.headers.get('strict-transport-security'), cookie.replace(/=[a-f0-9]+/, '=…'));
    let last = '';
    for (let i = 0; i < 21; i++) {
      const r = await fetch(`${BASE}/api/invoke`, { method: 'POST', headers: { 'X-PPK': '1', 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' }, body: JSON.stringify({ channel: 'numbering:login', payload: { user_id: 'x'.repeat(8), pin: 'salah' } }) });
      last = (await r.json()).error;
    }
    check('IP dikunci setelah 20 login gagal', /Terlalu banyak percobaan masuk/.test(last), last);
    await browser.close();
  } finally {
    srv.kill();
    await new Promise((r) => setTimeout(r, 1000));
    fs.rmSync(root, { recursive: true, force: true });
  }
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
