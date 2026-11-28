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
import { webStore, webCtx, type WebCtx } from '../main/webContext';
import { log } from '../main/logger';

/*
 * Mode web: komputer ini membuka alamat http://<IP>:<port> agar HP/laptop lain di jaringan kantor
 * memakai aplikasi lewat browser. Halaman = hasil build renderer yang sama; setiap panggilan
 * diteruskan ke handler IPC yang sama, dengan sesi login per browser (webContext).
 * shortcut: HTTP biasa tanpa TLS, hanya untuk LAN kantor/uji coba; pakai HTTPS (reverse proxy) bila dibuka ke internet.
 */

const DEFAULT_PORT = 8080;
const IDLE_MS = 12 * 3600_000; // sesi browser kedaluwarsa setelah 12 jam tidak dipakai
const MAX_BODY = 2 * 1024 * 1024;

/** Channel yang tidak boleh dipanggil dari browser: pengaturan komputer server, backup/restore, dan dialog berkas. */
export const WEB_DENIED = new Set([
  'backup:create', 'backup:restore', 'settings:set', 'settings:chooseDir', 'settings:setAiKey', 'ai:run', 'export:print', 'app:showInFolder',
  'ppk:server:test', 'ppk:server:configure', 'ppk:server:setup', 'ppk:server:useLocal', 'ppk:server:backup', 'ppk:server:restore',
  'ppk:gateway:configure', 'web:status', 'web:set'
]);

const sessions = new Map<string, { ctx: WebCtx; seen: number }>();
let server: http.Server | null = null;
let lastError: string | null = null;

const staticDir = () => path.join(__dirname, '..', 'dist');
const port = () => Number(getRawSetting(getDb(), 'web_port')) || DEFAULT_PORT;
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

/** Satu panggilan dari browser: cari sesi, jalankan handler di dalam konteks sesi itu. */
export async function invokeFromWeb(token: string | null, channel: unknown, payload: unknown): Promise<{ result: Result; token: string | null }> {
  if (typeof channel !== 'string' || !handlers.has(channel)) return { result: { ok: false, error: 'Perintah tidak dikenal.' }, token };
  if (WEB_DENIED.has(channel)) return { result: { ok: false, error: 'Fitur ini hanya bisa dipakai di aplikasi desktop pada komputer server.' }, token };
  const now = Date.now();
  for (const [k, v] of sessions) if (now - v.seen > IDLE_MS) sessions.delete(k);
  const s = token ? sessions.get(token) : undefined;
  const ctx: WebCtx = s?.ctx ?? { actor: null, server: null };
  if (s) s.seen = now;
  const result = await webStore.run(ctx, () => handlers.get(channel)!(payload));
  // Sesi baru hanya disimpan setelah berhasil masuk, agar permintaan tanpa login tidak menumpuk sesi.
  if (!s && (ctx.actor || ctx.server)) { token = crypto.randomBytes(32).toString('hex'); sessions.set(token, { ctx, seen: now }); }
  if (s && !ctx.actor && !ctx.server) { sessions.delete(token!); token = null; }
  return { result, token };
}

async function onRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.url?.startsWith('/api/')) {
    // Header khusus + JSON: halaman dari situs lain tidak bisa memanggil API ini (CSRF).
    if (req.method !== 'POST' || req.url !== '/api/invoke' || req.headers['x-ppk'] !== '1') { res.writeHead(404); res.end(); return; }
    try {
      const body = await readJson(req);
      const { result, token } = await invokeFromWeb(cookieToken(req), body.channel, body.payload);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        ...(token ? { 'Set-Cookie': `ppk_web=${token}; HttpOnly; SameSite=Strict; Path=/` } : {}) });
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : 'Permintaan tidak valid.' }));
    }
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
    s.listen(port(), '0.0.0.0', () => { server = s; log('info', `Mode web aktif di port ${port()}`); resolve(); });
  });
}

/** Desktop di dalam dialog/shell tidak boleh muncul karena permintaan dari browser orang lain. */
function blockDesktopUiFromWeb() {
  const deny = () => { throw new Error('Fitur ini (pilih/simpan/buka berkas) hanya bisa dipakai di aplikasi desktop pada komputer server.'); };
  const d = dialog as unknown as Record<string, (...a: unknown[]) => unknown>;
  const sh = shell as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const [obj, keys] of [[d, ['showOpenDialog', 'showSaveDialog', 'showMessageBox']], [sh, ['openPath', 'openExternal', 'showItemInFolder']]] as const) {
    for (const k of keys) { const orig = obj[k]; obj[k] = (...a: unknown[]) => (webCtx() ? deny() : orig.apply(obj === d ? dialog : shell, a)); }
  }
}

function status() {
  return { enabled: enabled(), running: !!server, port: port(), urls: server ? lanUrls() : [], error: lastError, sessions: sessions.size, needs_password: needsSetup(getDb()) };
}

function requireAdmin() {
  if (currentActor(getDb()).role !== 'admin') throw new Error('Hanya administrator yang dapat mengatur akses web.');
}

export function registerWebHandlers() {
  blockDesktopUiFromWeb();
  handle('web:status', S.empty, () => status());
  handle('web:set', z.object({ enabled: z.boolean(), port: z.number().int().min(1024).max(65535) }), async (i) => {
    requireAdmin();
    if (i.enabled && needsSetup(getDb())) throw new Error('Buat kata sandi administrator dulu sebelum menyalakan akses web.');
    setSettings(getDb(), { web_enabled: String(i.enabled), web_port: String(i.port) });
    await stop();
    if (i.enabled) await start();
    return status();
  });
  if (enabled() && !needsSetup(getDb())) void start();
}
