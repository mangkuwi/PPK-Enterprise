// Gateway WhatsApp: bagian murni selalu diuji; alur webhook → antrean → tarik ke desktop butuh PostgreSQL (PPK_TEST_PG).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import type { AddressInfo } from 'node:net';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { parseWebhook, validSignature, verifyChallenge } from '../gateway/src/webhook.ts';
import { migrate, pullMessages } from '../gateway/src/db.ts';
import { createServer } from '../gateway/src/server.ts';
import { runOnce } from '../gateway/src/worker.ts';
import { openDatabase } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { sqliteStore } from '../electron/main/ppk/store';
import { gatewayBase, pullGateway } from '../electron/main/ppk/gateway';

const SECRET = 'rahasia-app'; const KEY = 'k'.repeat(40);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const wa = (messages: unknown[]) => ({ object: 'whatsapp_business_account', entry: [{ id: '1', changes: [{ field: 'messages', value: {
  messaging_product: 'whatsapp', contacts: [{ wa_id: '6281234', profile: { name: 'Staf A' } }], messages } }] }] });
const docMsg = (id: string, sha = '') => ({ id, from: '6281234', timestamp: '1795000000', type: 'document',
  document: { id: `media-${id}`, filename: 'Undangan Rapat.pdf', mime_type: 'application/pdf', sha256: sha, caption: 'Mohon dihadiri' } });

describe('webhook murni', () => {
  it('tanda tangan Meta dan verifikasi token', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
    expect(validSignature(raw, sig, SECRET)).toBe(true);
    expect(validSignature(Buffer.from('{"a":2}'), sig, SECRET)).toBe(false);
    expect(validSignature(raw, undefined, SECRET)).toBe(false);
    expect(validSignature(raw, 'sha256=zz', SECRET)).toBe(false);
    expect(verifyChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=t1&hub.challenge=42'), 't1')).toBe('42');
    expect(verifyChallenge(new URLSearchParams('hub.mode=subscribe&hub.verify_token=salah&hub.challenge=42'), 't1')).toBeNull();
  });
  it('membaca teks, dokumen, foto; status dan jenis lain tidak membuat lampiran', () => {
    const m = parseWebhook(wa([
      { id: 'w1', from: '6281234', timestamp: '1795000000', type: 'text', text: { body: 'Undangan rapat besok 09.00' } },
      docMsg('w2'),
      { id: 'w3', from: '6281234', timestamp: '1795000000', type: 'image', image: { id: 'img', mime_type: 'image/jpeg' } },
      { id: 'w4', from: '6281234', timestamp: '1795000000', type: 'audio', audio: { id: 'aud' } }
    ]));
    expect(m.map((x) => [x.wa_message_id, x.sender_name, !!x.media])).toEqual([['w1', 'Staf A', false], ['w2', 'Staf A', true], ['w3', 'Staf A', true], ['w4', 'Staf A', false]]);
    expect(m[0].text).toContain('09.00');
    expect(m[1].media?.filename).toBe('Undangan Rapat.pdf');
    expect(m[2].media?.filename).toMatch(/^lampiran-.*\.jpg$/);
    expect(m[3].text).toContain('tidak didukung');
    expect(m[0].received_at).toBe(new Date(1795000000 * 1000).toISOString());
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhook({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'x' }] } }] }] })).toEqual([]);
  });
  it('alamat Gateway wajib https kecuali localhost', () => {
    expect(gatewayBase('https://gw.kantor.go.id/abc')).toBe('https://gw.kantor.go.id');
    expect(gatewayBase('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(() => gatewayBase('http://gw.kantor.go.id')).toThrow(/https/);
  });
});

const URL_ = process.env.PPK_TEST_PG;
describe.skipIf(!URL_)('Gateway di PostgreSQL', () => {
  let root: pg.Client; let pool: pg.Pool; let server: ReturnType<typeof createServer>; let base = ''; const name = `gw_test_${randomBytes(4).toString('hex')}`;
  beforeAll(async () => {
    root = new pg.Client({ connectionString: URL_ }); await root.connect(); await root.query(`CREATE DATABASE ${name}`);
    const u = new URL(URL_!); u.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: u.toString() }); await migrate(pool); await migrate(pool); // dua kali: idempoten
    server = createServer(pool, { verifyToken: 'vt', appSecret: SECRET, apiKey: KEY, log: () => undefined });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => { server?.close(); await pool?.end(); await root?.query(`DROP DATABASE IF EXISTS ${name}`); await root?.end(); });

  const post = (body: unknown, secret = SECRET) => {
    const raw = JSON.stringify(body);
    return fetch(`${base}/webhook`, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json',
      'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}` } });
  };
  // Graph API palsu: info media lalu isinya. fail = jumlah respons gagal sebelum berhasil.
  const graph = (content: Buffer, fail = 0) => {
    let n = 0;
    return (async (u: string) => {
      if (n++ < fail) return new Response('x', { status: 500 });
      return u.includes('graph.facebook.com') ? Response.json({ url: 'https://lookaside.example/f', file_size: content.length }) : new Response(content);
    }) as unknown as typeof fetch;
  };
  const conf = (f: typeof fetch) => ({ accessToken: 't', graphVersion: 'v21.0', fetch: f });

  it('webhook → antrean unduh → API tarik → Kotak Masuk desktop, tanpa duplikat', async () => {
    expect(await (await fetch(`${base}/webhook?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=123`)).text()).toBe('123');
    expect((await post(wa([docMsg('d1')]), 'salah')).status).toBe(401);
    const sha = createHash('sha256').update(PDF).digest('hex');
    expect((await post(wa([docMsg('d1', sha), { id: 't1', from: '6281234', timestamp: '1795000100', type: 'text', text: { body: 'Rapat Jumat' } }]))).status).toBe(200);
    expect((await post(wa([docMsg('d1', sha)]))).status).toBe(200); // Meta mengirim ulang
    expect((await pool.query('SELECT count(*)::int AS n FROM wa_messages')).rows[0].n).toBe(2);
    expect((await pool.query('SELECT count(*)::int AS n FROM wa_webhook_log')).rows[0].n).toBe(3);

    expect(await pullMessages(pool, 0)).toEqual([]); // lampiran belum diunduh: pesan berikutnya ikut ditahan
    expect(await runOnce(pool, conf(graph(PDF)))).toBe(true);
    expect(await runOnce(pool, conf(graph(PDF)))).toBe(false);

    expect((await fetch(`${base}/api/messages`)).status).toBe(401);
    const db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); const s = sqliteStore(db);
    const r = await pullGateway(s, { url: base, apiKey: KEY }, 0);
    expect(r.added).toBe(2);
    const inv = db.prepare('SELECT * FROM ppk_invitations ORDER BY received_at').all() as Array<Record<string, any>>;
    expect(inv.map((i) => [i.source, i.status, i.sender_name, i.message_text])).toEqual([['whatsapp', 'baru', 'Staf A', 'Mohon dihadiri'], ['whatsapp', 'baru', 'Staf A', 'Rapat Jumat']]);
    const f = db.prepare('SELECT filename, mime_type, sha256, content FROM ppk_files').get() as Record<string, any>;
    expect([f.filename, f.mime_type, f.sha256]).toEqual(['Undangan Rapat.pdf', 'application/pdf', sha]);
    expect(Buffer.compare(f.content, PDF)).toBe(0);
    expect((await pullGateway(s, { url: base, apiKey: KEY }, 0)).added).toBe(0); // kursor diulang dari awal: tetap tidak ganda
    expect((await pullGateway(s, { url: base, apiKey: 'x'.repeat(40) }, 0).catch((e) => e.message))).toMatch(/ditolak/);
  });

  it('unduhan gagal dicoba ulang, lalu undangan masuk berstatus gagal', async () => {
    await post(wa([docMsg('d9')]));
    const retry = () => pool.query("UPDATE gw_jobs SET run_after = now() WHERE status = 'antre'"); // lewati jeda tunggu
    const g = graph(PDF, 99);
    for (let i = 0; i < 3; i++) { await runOnce(pool, conf(g)); await retry(); }
    expect((await pool.query("SELECT status, attempts FROM gw_jobs ORDER BY id DESC LIMIT 1")).rows[0]).toEqual({ status: 'gagal', attempts: 3 });
    const db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db);
    await pullGateway(sqliteStore(db), { url: base, apiKey: KEY }, 2);
    const inv = db.prepare("SELECT status, error_message FROM ppk_invitations").get() as Record<string, string>;
    expect(inv.status).toBe('gagal');
    expect(inv.error_message).toMatch(/gagal diunduh/);
  });
});
