/** HTTP Gateway: webhook Meta (publik, lewat Nginx HTTPS) dan API tarik untuk aplikasi desktop (kunci API). */
import http from 'node:http';
import type pg from 'pg';
import { fileById, logWebhook, pullMessages, saveMessages, stats } from './db.ts';
import { parseWebhook, sameSecret, validSignature, verifyChallenge } from './webhook.ts';

export type ServerConf = { verifyToken: string; appSecret: string; apiKey: string; log: (s: string) => void };
const MAX_BODY = 1024 * 1024; // payload webhook hanya berisi teks dan id media

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((ok, fail) => {
    const parts: Buffer[] = []; let n = 0;
    req.on('data', (c: Buffer) => { n += c.length; if (n > MAX_BODY) { fail(new Error('too_large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts))); req.on('error', fail);
  });
}
const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
};

export function createServer(pool: pg.Pool, c: ServerConf) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://gateway');
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true });

      if (url.pathname === '/webhook' && req.method === 'GET') {
        const ch = verifyChallenge(url.searchParams, c.verifyToken);
        return ch === null ? json(res, 403, { error: 'verifikasi ditolak' }) : res.writeHead(200, { 'Content-Type': 'text/plain' }).end(ch);
      }
      if (url.pathname === '/webhook' && req.method === 'POST') {
        const raw = await readBody(req);
        const ok = validSignature(raw, req.headers['x-hub-signature-256'] as string | undefined, c.appSecret);
        await logWebhook(pool, ok, raw.toString('utf8'));
        if (!ok) return json(res, 401, { error: 'tanda tangan tidak valid' });
        let body: unknown;
        try { body = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'JSON tidak valid' }); }
        const added = await saveMessages(pool, parseWebhook(body));
        if (added) c.log(`webhook: ${added} pesan baru`);
        return json(res, 200, { ok: true });
      }

      if (url.pathname.startsWith('/api/')) {
        const auth = req.headers.authorization;
        if (!sameSecret(auth?.startsWith('Bearer ') ? auth.slice(7) : undefined, c.apiKey)) return json(res, 401, { error: 'kunci API salah' });
        if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, await stats(pool));
        if (req.method === 'GET' && url.pathname === '/api/messages') {
          const after = Number(url.searchParams.get('after') ?? 0);
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
          if (!Number.isSafeInteger(after) || after < 0) return json(res, 400, { error: 'kursor tidak valid' });
          return json(res, 200, { messages: await pullMessages(pool, after, limit) });
        }
        const m = /^\/api\/files\/(\d{1,18})$/.exec(url.pathname);
        if (req.method === 'GET' && m) {
          const f = await fileById(pool, m[1]);
          if (!f) return json(res, 404, { error: 'file tidak ditemukan' });
          return res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': f.content.length, 'Cache-Control': 'no-store' }).end(f.content);
        }
      }
      json(res, 404, { error: 'tidak ditemukan' });
    } catch (e) {
      if (e instanceof Error && e.message === 'too_large') return json(res, 413, { error: 'payload terlalu besar' });
      c.log(`error ${req.method} ${url.pathname}: ${e instanceof Error ? e.message : e}`);
      // 500 membuat Meta mengirim ulang; pesan ganda tetap diabaikan lewat wa_message_id.
      if (!res.headersSent) json(res, 500, { error: 'galat server' });
    }
  });
}
