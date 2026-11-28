import { dialog, shell } from 'electron';
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import { handle, handlers, type Result } from './handle';
import * as S from './schemas';
import { getDb } from '../main/database';
import { getRawSetting, setSettings } from '../main/repo';
import { currentActor, needsSetup } from '../main/numbering/session';
import { AsyncLocalStorage } from 'node:async_hooks';
import { webStore, webCtx, type WebCtx } from '../main/webContext';
import { clientInfo, loginBlocked, loginFailed, loginSucceeded, LOGIN_BLOCKED_MSG, safeFileName, sameOrigin } from '../main/webGuard';
import { log } from '../main/logger';

/*
 * Mode web: komputer ini membuka alamat http://<IP>:<port> agar HP/laptop lain di jaringan kantor
 * memakai aplikasi lewat browser. Halaman = hasil build renderer yang sama; setiap panggilan
 * diteruskan ke handler IPC yang sama, dengan sesi login per browser (webContext).
 * Berkas: browser mengunggah berkas bersama perintahnya (/api/invoke-file) dan dialog "pilih berkas" di server
 * mengembalikan berkas itu; dialog "simpan" menulis ke folder sementara lalu browser mengunduhnya (/api/download).
 * HTTPS: dipasang di depan oleh reverse proxy (Caddy/Nginx) di komputer yang sama; lihat webGuard.clientInfo.
 */

const DEFAULT_PORT = 8080;
const IDLE_MS = 12 * 3600_000; // sesi browser kedaluwarsa setelah 12 jam tidak dipakai
const MAX_BODY = 2 * 1024 * 1024;
const MAX_UPLOAD = 50 * 1024 * 1024; // sama dengan batas terbesar handler (impor DOCX/template)
const DOWNLOAD_MS = 10 * 60_000;
const LOGIN_CHANNELS = new Set(['numbering:login', 'ppk:server:login']);

/** Channel yang tidak boleh dipanggil dari browser: pengaturan komputer server, backup/restore, dan dialog berkas. */
export const WEB_DENIED = new Set([
  'backup:create', 'backup:restore', 'settings:set', 'settings:chooseDir', 'settings:setAiKey', 'ai:run', 'export:print', 'app:showInFolder',
  'ppk:server:test', 'ppk:server:configure', 'ppk:server:setup', 'ppk:server:useLocal', 'ppk:server:backup', 'ppk:server:restore',
  'ppk:gateway:configure', 'web:status', 'web:set'
]);

/** Berkas milik satu panggilan dari browser: unggahan yang dibawa, unduhan dan tautan yang dihasilkan. */
interface Call { upload: string | null; downloads: string[]; open: string | null }
const callStore = new AsyncLocalStorage<Call>();
const downloads = new Map<string, { file: string; name: string; session: string; exp: number }>();
const tmpRoot = () => path.join(os.tmpdir(), 'ppk-web');
function tmpDir(): string {
  const d = path.join(tmpRoot(), crypto.randomBytes(8).toString('hex'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const rmDirOf = (file: string) => fs.rmSync(path.dirname(file), { recursive: true, force: true });
function pruneDownloads(now = Date.now()) {
  for (const [k, v] of downloads) if (v.exp < now) { downloads.delete(k); rmDirOf(v.file); }
}

/** Mode server (tanpa jendela): port/host dari baris perintah, menyala tanpa melihat pengaturan web_enabled. */
let serverOpts: { port: number; host: string } | null = null;

const sessions = new Map<string, { ctx: WebCtx; seen: number }>();
let server: http.Server | null = null;
let lastError: string | null = null;

const staticDir = () => path.join(__dirname, '..', 'dist');
const port = () => serverOpts?.port || Number(getRawSetting(getDb(), 'web_port')) || DEFAULT_PORT;
const enabled = () => getRawSetting(getDb(), 'web_enabled') === 'true';

/** Alamat IPv4 komputer ini di jaringan (Wi-Fi/LAN), untuk ditunjukkan ke rekan kerja. */
export function lanUrls(p = port()): string[] {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${p}`);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.webmanifest': 'application/manifest+json'
};

function cookieToken(req: http.IncomingMessage): string | null {
  const m = /(?:^|;\s*)ppk_web=([a-f0-9]{64})/.exec(req.headers.cookie ?? '');
  return m ? m[1] : null;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const root = staticDir();
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const file = path.normalize(path.join(root, rel === '/' ? 'index.html' : rel));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(fs.existsSync(path.join(root, 'index.html')) ? 404 : 503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(fs.existsSync(path.join(root, 'index.html')) ? 'Tidak ditemukan.' : 'Tampilan aplikasi belum di-build. Jalankan "npm run build" di komputer server.');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'max-age=3600' });
  fs.createReadStream(file).pipe(res);
}

async function readJson(req: http.IncomingMessage): Promise<{ channel?: unknown; payload?: unknown }> {
  let size = 0; const parts: Buffer[] = [];
  for await (const c of req) { size += (c as Buffer).length; if (size > MAX_BODY) throw new Error('Data terlalu besar.'); parts.push(c as Buffer); }
  return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
}

type Invoked = { result: Result; token: string | null; download?: { url: string; name: string }; open?: string };

/** Satu panggilan dari browser: cari sesi, jalankan handler di dalam konteks sesi itu. */
export async function invokeFromWeb(token: string | null, channel: unknown, payload: unknown, ip = '', upload: string | null = null): Promise<Invoked> {
  if (typeof channel !== 'string' || !handlers.has(channel)) return { result: { ok: false, error: 'Perintah tidak dikenal.' }, token };
  if (channel === 'export:print') return { result: { ok: false, error: 'Cetak langsung hanya ada di aplikasi desktop. Dari browser: ekspor PDF, buka berkasnya, lalu cetak.' }, token };
  if (WEB_DENIED.has(channel)) return { result: { ok: false, error: 'Fitur ini hanya bisa dipakai di aplikasi desktop pada komputer server.' }, token };
  const login = LOGIN_CHANNELS.has(channel);
  if (login && loginBlocked(ip)) return { result: { ok: false, error: LOGIN_BLOCKED_MSG }, token };
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.seen > IDLE_MS) sessions.delete(k);
  pruneDownloads(now);
  const s = token ? sessions.get(token) : undefined;
  const ctx: WebCtx = s?.ctx ?? { actor: null, server: null };
  if (s) s.seen = now;
  const call: Call = { upload, downloads: [], open: null };
  const result = await webStore.run(ctx, () => callStore.run(call, () => handlers.get(channel)!(payload)));
  if (login) {
    if (result.ok) loginSucceeded(ip); else loginFailed(ip);
    log('info', `Login web ${channel} ${result.ok ? 'berhasil' : 'gagal'} dari ${ip || '?'}`);
  }
  // Sesi baru hanya disimpan setelah berhasil masuk, agar permintaan tanpa login tidak menumpuk sesi.
  if (!s && (ctx.actor || ctx.server)) { token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { ctx, seen: now }); }
  if (s && !ctx.actor && !ctx.server) { sessions.delete(token!); token = null; }
  const out: Invoked = { result, token };
  const file = call.downloads.find((f) => fs.existsSync(f));
  for (const f of call.downloads) if (f !== file) rmDirOf(f);
  if (file && token && result.ok) {
    const id = crypto.randomBytes(24).toString('hex');
    const name = path.basename(file);
    downloads.set(id, { file, name, session: token, exp: now + DOWNLOAD_MS });
    out.download = { url: `/api/download/${id}`, name };
    // Lokasi sementara di server tidak berguna bagi pengguna browser; tampilkan nama berkasnya saja.
    const d = result.data as { path?: unknown } | null;
    if (d && typeof d === 'object' && d.path === file) result.data = { ...d, path: name };
  } else if (file) rmDirOf(file);
  if (call.open && result.ok) out.open = call.open;
  return out;
}

async function saveUpload(req: http.IncomingMessage, name: string): Promise<string> {
  if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD) throw new Error('Berkas terlalu besar (maks. 50 MB).');
  const file = path.join(tmpDir(), safeFileName(name));
  const out = fs.createWriteStream(file);
  let size = 0;
  try {
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_UPLOAD) throw new Error('Berkas terlalu besar (maks. 50 MB).');
      if (!out.write(c)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    await new Promise<void>((r) => out.end(() => r()));
    return file;
  } catch (e) { out.destroy(); rmDirOf(file); throw e; }
}

function sendDownload(req: http.IncomingMessage, res: http.ServerResponse, id: string) {
  pruneDownloads();
  const d = downloads.get(id);
  if (!d || d.session !== cookieToken(req)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Unduhan sudah kedaluwarsa. Ulangi ekspor.'); return; }
  downloads.delete(id);
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${d.name.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(d.name)}`
  });
  fs.createReadStream(d.file).on('close', () => rmDirOf(d.file)).pipe(res);
}

const CSP = "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

async function onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const { ip, https } = clientInfo(req.socket.remoteAddress, req.headers);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  const url = (req.url ?? '').split('?')[0];
  if (url.startsWith('/api/download/') && req.method === 'GET') { sendDownload(req, res, url.slice('/api/download/'.length)); return; }
  if (url.startsWith('/api/')) {
    // Header khusus + cek Origin: halaman dari situs lain tidak bisa memanggil API ini (CSRF).
    const withFile = url === '/api/invoke-file';
    if (req.method !== 'POST' || (url !== '/api/invoke' && !withFile) || req.headers['x-ppk'] !== '1' || !sameOrigin(req.headers.origin, req.headers.host)) {
      res.writeHead(404); res.end(); return;
    }
    let upload: string | null = null;
    try {
      let body: { channel?: unknown; payload?: unknown };
      if (withFile) {
        body = { channel: req.headers['x-channel'], payload: JSON.parse(decodeURIComponent(String(req.headers['x-payload'] ?? '%7B%7D'))) };
        upload = await saveUpload(req, decodeURIComponent(String(req.headers['x-file-name'] ?? 'berkas')));
      } else body = await readJson(req);
      const { result, token, download, open } = await invokeFromWeb(cookieToken(req), body.channel, body.payload, ip, upload);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        ...(token ? { 'Set-Cookie': `ppk_web=${token}; HttpOnly; SameSite=Strict; Path=/${https ? '; Secure' : ''}` } : {}) });
      res.end(JSON.stringify({ ...result, download, open }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Permintaan tidak valid.' }));
    } finally { if (upload) rmDirOf(upload); }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  serveStatic(req, res);
}

function stop(): Promise<void> {
  sessions.clear();
  const s = server; server = null;
  return new Promise((r) => (s ? s.close(() => r()) : r()));
}

function start(): Promise<void> {
  lastError = null;
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => { onRequest(req, res).catch((e) => { log('error', 'Mode web', e); if (!res.headersSent) res.writeHead(500); res.end(); }); });
    s.once('error', (e: NodeJS.ErrnoException) => {
      lastError = e.code === 'EADDRINUSE' ? `Port ${port()} sedang dipakai program lain. Ganti nomor port.` : e.message;
      log('error', 'Mode web gagal dinyalakan', e); server = null; resolve();
    });
    s.listen(port(), serverOpts?.host ?? '0.0.0.0', () => { server = s; log('info', `Mode web aktif di port ${port()}`); resolve(); });
  });
}

/**
 * Dialog dan shell di server tidak boleh muncul karena permintaan dari browser. Untuk panggilan dari browser:
 * "pilih berkas" = berkas yang diunggah bersama perintah, "simpan" = folder sementara lalu diunduh browser,
 * "buka berkas" = diunduh, tautan luar (WhatsApp) = dibuka di browser itu.
 */
function webDialogs() {
  const deny = () => { throw new Error('Fitur ini hanya bisa dipakai di aplikasi desktop pada komputer server.'); };
  const call = () => callStore.getStore() ?? deny();
  const web: Record<string, (...a: never[]) => unknown> = {
    showOpenDialog: async () => {
      const f = call().upload;
      if (!f) throw new Error('Pilih berkas lewat tombol di halaman ini.');
      return { canceled: false, filePaths: [f] };
    },
    showSaveDialog: async (_w: unknown, o?: { defaultPath?: string }) => {
      const f = path.join(tmpDir(), safeFileName(path.basename(o?.defaultPath ?? 'unduhan')));
      call().downloads.push(f);
      return { canceled: false, filePath: f };
    },
    openPath: async (p: string) => {
      const f = path.join(tmpDir(), path.basename(p));
      fs.copyFileSync(p, f);
      call().downloads.push(f);
      return '';
    },
    openExternal: async (url: string) => { call().open = url; },
    showMessageBox: deny,
    showItemInFolder: deny
  };
  const d = dialog as unknown as Record<string, (...a: unknown[]) => unknown>;
  const sh = shell as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const [obj, keys] of [[d, ['showOpenDialog', 'showSaveDialog', 'showMessageBox']], [sh, ['openPath', 'openExternal', 'showItemInFolder']]] as const) {
    for (const k of keys) { const orig = obj[k]; obj[k] = (...a: unknown[]) => (webCtx() ? (web[k] as (...x: unknown[]) => unknown)(...a) : orig.apply(obj === d ? dialog : shell, a)); }
  }
}

function status() {
  return { enabled: enabled(), running: !!server, port: port(), urls: server ? lanUrls() : [], error: lastError, sessions: sessions.size, needs_password: needsSetup(getDb()) };
}

function requireAdmin() {
  if (currentActor(getDb()).role !== 'admin') throw new Error('Hanya administrator yang dapat mengatur akses web.');
}

/** Mode server (`--server`): tanpa jendela, akses web selalu menyala. Mengembalikan alamat yang bisa dibuka. */
export async function startServerMode(opts: { port: number; host: string }): Promise<string[]> {
  if (needsSetup(getDb())) throw new Error('Kata sandi administrator belum dibuat. Buka aplikasi desktop sekali (npm start), buat kata sandi, tutup, lalu jalankan server lagi.');
  serverOpts = opts;
  await stop();
  await start();
  if (!server) throw new Error(lastError ?? 'Server web gagal dinyalakan.');
  return [`http://localhost:${opts.port}`, ...(opts.host === '0.0.0.0' ? lanUrls(opts.port) : [])];
}

export function registerWebHandlers() {
  fs.rmSync(tmpRoot(), { recursive: true, force: true }); // sisa unggahan/unduhan dari jalan sebelumnya
  webDialogs();
  handle('web:status', S.empty, () => status());
  handle('web:set', z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535) }), async (i) => {
    requireAdmin();
    if (i.enabled && needsSetup(getDb())) throw new Error('Buat kata sandi administrator dulu sebelum menyalakan akses web.');
    setSettings(getDb(), { web_enabled: String(i.enabled), web_port: String(i.port) });
    await stop();
    if (i.enabled) await start();
    return status();
  });
  if (enabled() && !needsSetup(getDb()) && !process.argv.includes('--server')) void start();
}
