/** Basis data Gateway (PostgreSQL di VPS). Terpisah dari database PPK; aplikasi desktop menarik isinya lewat API. */
import type pg from 'pg';
import type { IncomingMessage } from './webhook.ts';

// Hanya menambah (IF NOT EXISTS); dijalankan setiap Gateway mulai.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS wa_webhook_log (
  id BIGSERIAL PRIMARY KEY, received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  signature_ok BOOLEAN NOT NULL, body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_messages (
  id BIGSERIAL PRIMARY KEY,
  wa_message_id TEXT NOT NULL UNIQUE,
  from_phone TEXT NOT NULL, sender_name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '', received_at TIMESTAMPTZ NOT NULL,
  media_id TEXT, media_mime TEXT, media_filename TEXT, media_sha256 TEXT,
  media_status TEXT NOT NULL CHECK (media_status IN ('tidak_ada','antre','selesai','gagal')),
  media_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wa_files (
  id BIGSERIAL PRIMARY KEY,
  message_id BIGINT NOT NULL UNIQUE REFERENCES wa_messages(id),
  filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64), content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS gw_jobs (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL, message_id BIGINT NOT NULL REFERENCES wa_messages(id),
  status TEXT NOT NULL DEFAULT 'antre' CHECK (status IN ('antre','jalan','selesai','gagal')),
  attempts INTEGER NOT NULL DEFAULT 0, run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gw_jobs_ready ON gw_jobs(status, run_after);
`;

export const migrate = (pool: pg.Pool) => pool.query(SCHEMA);

export const logWebhook = (pool: pg.Pool, ok: boolean, body: string) =>
  pool.query('INSERT INTO wa_webhook_log (signature_ok, body) VALUES ($1, $2)', [ok, body]);

/** Simpan pesan; id pesan WhatsApp yang sama (Meta mengirim ulang) diabaikan. Lampiran masuk antrean unduh. */
export async function saveMessages(pool: pg.Pool, msgs: IncomingMessage[]): Promise<number> {
  let added = 0;
  for (const m of msgs) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const r = await c.query<{ id: string }>(`INSERT INTO wa_messages (wa_message_id, from_phone, sender_name, type, text, received_at, media_id, media_mime, media_filename, media_sha256, media_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
      [m.wa_message_id, m.from_phone, m.sender_name, m.type, m.text, m.received_at, m.media?.media_id ?? null, m.media?.mime_type ?? null,
        m.media?.filename ?? null, m.media?.sha256 ?? null, m.media ? 'antre' : 'tidak_ada']);
      if (r.rows[0] && m.media) await c.query("INSERT INTO gw_jobs (kind, message_id) VALUES ('unduh_media', $1)", [r.rows[0].id]);
      await c.query('COMMIT');
      added += r.rowCount ?? 0;
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  return added;
}

export type PullFile = { id: string; filename: string; mime_type: string; size_bytes: number; sha256: string };
export type PullMessage = { id: string; wa_message_id: string; from_phone: string; sender_name: string; type: string; text: string;
  received_at: string; media_status: string; media_error: string; file: PullFile | null };

/** Pesan setelah kursor, urut id. Berhenti di pesan yang lampirannya masih diunduh, agar kursor desktop tidak melompatinya. */
export async function pullMessages(pool: pg.Pool, after: number, limit = 50): Promise<PullMessage[]> {
  const r = await pool.query(`SELECT m.id::text, m.wa_message_id, m.from_phone, m.sender_name, m.type, m.text, m.received_at, m.media_status, m.media_error,
      f.id::text AS file_id, f.filename, f.mime_type, f.size_bytes, f.sha256
    FROM wa_messages m LEFT JOIN wa_files f ON f.message_id = m.id WHERE m.id > $1 ORDER BY m.id LIMIT $2`, [after, limit]);
  const out: PullMessage[] = [];
  for (const x of r.rows) {
    if (x.media_status === 'antre') break;
    out.push({ id: x.id, wa_message_id: x.wa_message_id, from_phone: x.from_phone, sender_name: x.sender_name, type: x.type, text: x.text,
      received_at: new Date(x.received_at).toISOString(), media_status: x.media_status, media_error: x.media_error,
      file: x.file_id ? { id: x.file_id, filename: x.filename, mime_type: x.mime_type, size_bytes: x.size_bytes, sha256: x.sha256 } : null });
  }
  return out;
}

export async function fileById(pool: pg.Pool, id: string) {
  if (!/^\d{1,18}$/.test(id)) return null;
  return (await pool.query<{ filename: string; mime_type: string; content: Buffer }>('SELECT filename, mime_type, content FROM wa_files WHERE id = $1', [id])).rows[0] ?? null;
}

export async function stats(pool: pg.Pool) {
  const r = await pool.query(`SELECT (SELECT count(*) FROM wa_messages)::int AS messages, (SELECT max(received_at) FROM wa_webhook_log) AS last_webhook,
    (SELECT count(*) FROM gw_jobs WHERE status IN ('antre','jalan'))::int AS jobs_pending, (SELECT count(*) FROM gw_jobs WHERE status = 'gagal')::int AS jobs_failed`);
  return r.rows[0] as { messages: number; last_webhook: Date | null; jobs_pending: number; jobs_failed: number };
}
