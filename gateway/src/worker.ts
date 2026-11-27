/** Satu worker antrean (tabel gw_jobs, tanpa Redis): unduh lampiran WhatsApp dari Graph API lalu simpan utuh. */
import { createHash } from 'node:crypto';
import type pg from 'pg';

export const MAX_FILE = 20 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
export type WorkerConf = { accessToken: string; graphVersion: string; fetch?: typeof fetch };

/** Unduh satu media: GET /{media-id} memberi URL sementara, lalu GET URL itu dengan token yang sama. */
export async function downloadMedia(c: WorkerConf, mediaId: string): Promise<Buffer> {
  const f = c.fetch ?? fetch;
  const auth = { Authorization: `Bearer ${c.accessToken}` };
  const meta = await f(`https://graph.facebook.com/${c.graphVersion}/${encodeURIComponent(mediaId)}`, { headers: auth });
  if (!meta.ok) throw new Error(`Info media gagal (HTTP ${meta.status}).`);
  const info = await meta.json() as { url?: string; file_size?: number };
  if (!info.url) throw new Error('Info media tanpa URL.');
  if ((info.file_size ?? 0) > MAX_FILE) throw new Error('Lampiran lebih dari 20 MB.');
  const res = await f(info.url, { headers: auth });
  if (!res.ok) throw new Error(`Unduh media gagal (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('Lampiran kosong.');
  if (buf.length > MAX_FILE) throw new Error('Lampiran lebih dari 20 MB.');
  return buf;
}

/** Ambil dan jalankan satu pekerjaan. true = ada pekerjaan yang dijalankan. */
export async function runOnce(pool: pg.Pool, c: WorkerConf): Promise<boolean> {
  const job = (await pool.query<{ id: string; message_id: string; attempts: number }>(`UPDATE gw_jobs SET status = 'jalan', attempts = attempts + 1, updated_at = now()
    WHERE id = (SELECT id FROM gw_jobs WHERE status = 'antre' AND run_after <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, message_id, attempts`)).rows[0];
  if (!job) return false;
  const m = (await pool.query<{ media_id: string; media_mime: string; media_filename: string; media_sha256: string }>(
    'SELECT media_id, media_mime, media_filename, media_sha256 FROM wa_messages WHERE id = $1', [job.message_id])).rows[0];
  try {
    const buf = await downloadMedia(c, m.media_id);
    const sha = createHash('sha256').update(buf).digest('hex');
    // Meta mengirim sha256 dalam hex; bila ada dan tidak cocok, file rusak di jalan.
    if (m.media_sha256 && /^[0-9a-f]{64}$/i.test(m.media_sha256) && m.media_sha256.toLowerCase() !== sha) throw new Error('Checksum lampiran tidak cocok.');
    const cl = await pool.connect();
    try {
      await cl.query('BEGIN');
      await cl.query(`INSERT INTO wa_files (message_id, filename, mime_type, size_bytes, sha256, content) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (message_id) DO NOTHING`,
        [job.message_id, m.media_filename, m.media_mime || 'application/octet-stream', buf.length, sha, buf]);
      await cl.query("UPDATE wa_messages SET media_status = 'selesai', media_error = '' WHERE id = $1", [job.message_id]);
      await cl.query("UPDATE gw_jobs SET status = 'selesai', last_error = '', updated_at = now() WHERE id = $1", [job.id]);
      await cl.query('COMMIT');
    } catch (e) { await cl.query('ROLLBACK'); throw e; } finally { cl.release(); }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    if (job.attempts < MAX_ATTEMPTS) {
      await pool.query("UPDATE gw_jobs SET status = 'antre', last_error = $2, run_after = now() + ($3 || ' minutes')::interval, updated_at = now() WHERE id = $1",
        [job.id, msg, String(job.attempts)]);
    } else {
      await pool.query("UPDATE gw_jobs SET status = 'gagal', last_error = $2, updated_at = now() WHERE id = $1", [job.id, msg]);
      await pool.query("UPDATE wa_messages SET media_status = 'gagal', media_error = $2 WHERE id = $1", [job.message_id, msg]);
    }
  }
  return true;
}

/** Pekerjaan yang tertinggal berstatus 'jalan' (Gateway mati di tengah jalan) dikembalikan ke antrean. */
export const recoverJobs = (pool: pg.Pool) => pool.query("UPDATE gw_jobs SET status = 'antre', updated_at = now() WHERE status = 'jalan'");

export function startWorker(pool: pg.Pool, c: WorkerConf, log: (s: string) => void) {
  let stop = false;
  void (async () => {
    while (!stop) {
      try { if (await runOnce(pool, c)) continue; } catch (e) { log(`worker: ${e instanceof Error ? e.message : e}`); }
      await new Promise((r) => setTimeout(r, 2000));
    }
  })();
  return () => { stop = true; };
}
