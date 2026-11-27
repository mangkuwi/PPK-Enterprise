/**
 * Tarik pesan WhatsApp dari Gateway (VPS) ke Kotak Masuk. Desktop yang memulai koneksi (tidak ada port terbuka di kantor).
 * Pesan yang sama tidak masuk dua kali (wa_message_id UNIQUE), jadi aman bila beberapa komputer menarik ke server PPK yang sama.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { PpkStore } from './store';
import { ppkAudit } from './access';
import { fileKind, MAX_FILE } from './inbox';
import { SYSTEM_ACTOR } from '../numbering/audit';

type GwFile = { id: string; filename: string; mime_type: string; size_bytes: number; sha256: string };
export type GwMessage = { id: string; wa_message_id: string; from_phone: string; sender_name: string; type: string; text: string;
  received_at: string; media_status: string; media_error: string; file: GwFile | null };
export type PullConf = { url: string; apiKey: string; fetch?: typeof fetch };

/** Alamat Gateway wajib HTTPS (kunci API dikirim di header), kecuali localhost untuk uji. */
export function gatewayBase(url: string): string {
  let u: URL;
  try { u = new URL(url.trim()); } catch { throw new Error('Alamat Gateway tidak valid. Contoh: https://gateway.kantor.go.id'); }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new Error('Alamat Gateway harus diawali https://');
  return u.origin;
}

async function get(c: PullConf, path: string): Promise<Response> {
  const res = await (c.fetch ?? fetch)(`${gatewayBase(c.url)}${path}`, { headers: { Authorization: `Bearer ${c.apiKey}` }, signal: AbortSignal.timeout(30000) });
  if (res.status === 401) throw new Error('Kunci API Gateway ditolak. Periksa kunci di Pengaturan PPK.');
  if (!res.ok) throw new Error(`Gateway membalas HTTP ${res.status}.`);
  return res;
}

export async function gatewayStatus(c: PullConf) {
  return (await get(c, '/api/status')).json() as Promise<{ messages: number; last_webhook: string | null; jobs_pending: number; jobs_failed: number }>;
}

/** Ambil lampiran dan periksa ukuran, checksum, dan jenisnya. Gagal = undangan tetap masuk dengan pesan galat. */
async function fetchFile(c: PullConf, f: GwFile): Promise<{ content: Buffer; mime: string; sha: string } | { error: string }> {
  try {
    const content = Buffer.from(await (await get(c, `/api/files/${encodeURIComponent(f.id)}`)).arrayBuffer());
    if (!content.length || content.length > MAX_FILE) return { error: 'Lampiran kosong atau lebih dari 20 MB.' };
    const sha = createHash('sha256').update(content).digest('hex');
    if (sha !== f.sha256) return { error: 'Lampiran rusak saat diunduh (checksum tidak cocok).' };
    return { content, mime: fileKind(content, f.filename), sha };
  } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

async function saveOne(s: PpkStore, c: PullConf, m: GwMessage): Promise<boolean> {
  if (await s.get('SELECT id FROM ppk_invitations WHERE wa_message_id = ?', [m.wa_message_id])) return false;
  const file = m.file ? await fetchFile(c, m.file) : null;
  const error = m.media_status === 'gagal' ? `Lampiran gagal diunduh dari WhatsApp: ${m.media_error}` : file && 'error' in file ? file.error : '';
  const id = randomUUID(); const ts = new Date().toISOString(); const who = SYSTEM_ACTOR.name;
  let added = false;
  await s.tx(async (t) => {
    if (await t.get('SELECT id FROM ppk_invitations WHERE wa_message_id = ?', [m.wa_message_id])) return; // ditarik komputer lain sementara itu
    const ok = file && 'content' in file ? file : null;
    const dup = ok ? (await t.get<{ owner_id: string }>("SELECT owner_id FROM ppk_files WHERE owner_type = 'undangan' AND sha256 = ? ORDER BY created_at LIMIT 1", [ok.sha]))?.owner_id ?? null : null;
    await t.run(`INSERT INTO ppk_invitations (id, source, wa_message_id, sender_phone, sender_name, received_at, message_text, status, error_message, duplicate_of, created_by, created_at, updated_by, updated_at)
      VALUES (?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, m.wa_message_id, m.from_phone, m.sender_name, m.received_at, m.text, error ? 'gagal' : 'baru', error, dup, who, ts, who, ts]);
    if (ok) await t.run(`INSERT INTO ppk_files (id, owner_type, owner_id, filename, mime_type, size_bytes, sha256, content, created_by, created_at)
      VALUES (?, 'undangan', ?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), id, m.file!.filename, ok.mime, ok.content.length, ok.sha, ok.content, who, ts]);
    await ppkAudit(t, SYSTEM_ACTOR, 'invitation.whatsapp', 'ppk_invitations', id, { wa_message_id: m.wa_message_id, from: m.from_phone, file: m.file?.filename ?? null, error, duplicate_of: dup });
    added = true;
  });
  return added;
}

/** Tarik semua pesan setelah kursor (maks. 10 halaman per putaran). Kembalikan kursor baru dan jumlah undangan baru. */
export async function pullGateway(s: PpkStore, c: PullConf, after: number): Promise<{ cursor: number; added: number }> {
  let cursor = after, added = 0;
  for (let page = 0; page < 10; page++) {
    const { messages } = await (await get(c, `/api/messages?after=${cursor}&limit=50`)).json() as { messages: GwMessage[] };
    if (!messages.length) break;
    for (const m of messages) { if (await saveOne(s, c, m)) added++; cursor = Number(m.id); }
  }
  return { cursor, added };
}
