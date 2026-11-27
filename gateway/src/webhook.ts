/** Bagian murni webhook WhatsApp Cloud API: cek tanda tangan Meta dan baca pesan masuk. Tanpa DB, mudah diuji. */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type IncomingMedia = { media_id: string; mime_type: string; filename: string; sha256: string };
export type IncomingMessage = {
  wa_message_id: string; from_phone: string; sender_name: string; type: string;
  text: string; received_at: string; media: IncomingMedia | null;
};

/** Header X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, body mentah). */
export function validSignature(raw: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=') || !appSecret) return false;
  const want = createHmac('sha256', appSecret).update(raw).digest();
  const got = Buffer.from(header.slice(7), 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Sama panjang dan isi, waktu tetap (untuk token dan kunci API). */
export function sameSecret(a: string | undefined, b: string): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** GET verifikasi Meta: kembalikan challenge bila token cocok, selain itu null. */
export function verifyChallenge(q: URLSearchParams, verifyToken: string): string | null {
  return q.get('hub.mode') === 'subscribe' && sameSecret(q.get('hub.verify_token') ?? undefined, verifyToken) ? q.get('hub.challenge') : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
// eslint-disable-next-line no-control-regex -- buang karakter kendali dari nama file kiriman
const safeName = (n: string) => n.replace(/[\\/:*?"<>|\0-\x1f]/g, '_').slice(0, 200);
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
  'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };

/** Ambil pesan dari payload webhook. Status terkirim/dibaca dan jenis lain diabaikan (tetap tercatat di log mentah). */
export function parseWebhook(body: unknown): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  const entries = (body as { object?: string; entry?: unknown[] })?.entry;
  if ((body as { object?: string })?.object !== 'whatsapp_business_account' || !Array.isArray(entries)) return out;
  for (const e of entries) for (const ch of (e as { changes?: unknown[] }).changes ?? []) {
    const v = (ch as { field?: string; value?: Record<string, unknown> }).field === 'messages' ? (ch as { value: Record<string, unknown> }).value : null;
    if (!v || !Array.isArray(v.messages)) continue;
    const names = new Map<string, string>();
    for (const c of (v.contacts as Array<{ wa_id?: string; profile?: { name?: string } }>) ?? []) if (c.wa_id) names.set(c.wa_id, str(c.profile?.name));
    for (const m of v.messages as Array<Record<string, any>>) {
      const id = str(m.id), from = str(m.from), type = str(m.type);
      if (!id || !from) continue;
      const ts = Number(m.timestamp);
      const doc = type === 'document' ? m.document : type === 'image' ? m.image : null;
      const media: IncomingMedia | null = doc?.id ? {
        media_id: str(doc.id), mime_type: str(doc.mime_type), sha256: str(doc.sha256),
        filename: safeName(str(doc.filename)) || `lampiran-${id.slice(-8)}.${EXT[str(doc.mime_type)] ?? 'bin'}`
      } : null;
      const text = type === 'text' ? str(m.text?.body) : doc ? str(doc.caption)
        : `[Pesan jenis "${type}" tidak didukung. Teruskan undangan sebagai teks, PDF, DOCX, atau foto.]`;
      out.push({ wa_message_id: id, from_phone: from, sender_name: names.get(from) ?? '', type, text: text.slice(0, 20000),
        received_at: new Date(Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now()).toISOString(), media });
    }
  }
  return out;
}
