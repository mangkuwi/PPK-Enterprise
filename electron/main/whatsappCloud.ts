/**
 * Adapter WhatsApp Business Cloud API (Meta Graph API). Nonaktif sampai administrator mengisi Phone Number ID + token dan
 * menyalakannya. PDF diunggah sebagai media (bukan URL publik); pesan dokumen dikirim dengan media id.
 * Status "submitted" = API menerima permintaan; sent/delivered/read hanya dari webhook status.
 */
import type { DB } from './db';
import type { Actor } from '@shared/numbering';
import { logDelivery, type DeliveryStatus } from './invitations';

export interface CloudConfig { phone_number_id: string; api_version: string; token: string }
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string | FormData }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const graph = (c: CloudConfig, path: string) => `https://graph.facebook.com/${c.api_version}/${c.phone_number_id}/${path}`;

async function call<T>(f: Fetch, url: string, c: CloudConfig, body: string | FormData): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${c.token}` };
  if (typeof body === 'string') headers['Content-Type'] = 'application/json';
  const res = await f(url, { method: 'POST', headers, body });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!res.ok || json.error) throw new Error(`WhatsApp API menolak (${json.error?.code ?? res.status}): ${json.error?.message ?? 'tanpa keterangan'}`);
  return json;
}

/**
 * Kirim satu dokumen PDF. Unggah media boleh diulang (aman); kirim pesan tidak diulang otomatis agar penerima tidak menerima dua kali.
 * Catatan kebijakan: di luar jendela 24 jam sejak pesan terakhir penerima, Meta mewajibkan template pesan yang disetujui.
 */
export async function cloudSendDocument(c: CloudConfig, f: Fetch, i: { to: string; pdf: Buffer; filename: string; caption: string }): Promise<{ message_id: string }> {
  let media: { id: string } | null = null; let lastErr: unknown;
  for (let attempt = 1; attempt <= 3 && !media; attempt++) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'application/pdf');
    form.append('file', new Blob([new Uint8Array(i.pdf)], { type: 'application/pdf' }), i.filename);
    try { media = await call<{ id: string }>(f, graph(c, 'media'), c, form); } catch (e) { lastErr = e; }
  }
  if (!media) throw lastErr;
  const r = await call<{ messages?: Array<{ id: string }> }>(f, graph(c, 'messages'), c, JSON.stringify({
    messaging_product: 'whatsapp', to: i.to, type: 'document', document: { id: media.id, filename: i.filename, caption: i.caption.slice(0, 1024) }
  }));
  const id = r.messages?.[0]?.id;
  if (!id) throw new Error('WhatsApp API tidak mengembalikan message ID.');
  return { message_id: id };
}

/** Status dari payload webhook Meta (entry[].changes[].value.statuses[]). */
export function webhookStatuses(payload: unknown): Array<{ message_id: string; status: DeliveryStatus; error: string | null }> {
  const out: Array<{ message_id: string; status: DeliveryStatus; error: string | null }> = [];
  const p = payload as { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id?: string; status?: string; errors?: Array<{ title?: string; message?: string }> }> } }> }> };
  for (const e of p?.entry ?? []) for (const ch of e.changes ?? []) for (const s of ch.value?.statuses ?? []) {
    if (!s.id || !['sent', 'delivered', 'read', 'failed'].includes(s.status ?? '')) continue;
    out.push({ message_id: s.id, status: s.status as DeliveryStatus, error: s.errors?.[0] ? (s.errors[0].message ?? s.errors[0].title ?? 'Gagal') : null });
  }
  return out;
}

/**
 * Terapkan webhook ke riwayat: satu baris baru per status, hanya untuk message ID yang dikirim aplikasi ini.
 * shortcut: aplikasi desktop tidak membuka port publik, jadi webhook belum diterima langsung; fungsi ini dipakai saat ada relay/server yang meneruskan payload.
 */
export function applyWebhook(db: DB, payload: unknown): number {
  let n = 0;
  for (const s of webhookStatuses(payload)) {
    const base = db.prepare("SELECT document_id, recipient_name, phone, pdf_sha256 FROM invitation_delivery_logs WHERE provider_message_id = ? AND method = 'cloud_api' ORDER BY created_at LIMIT 1")
      .get(s.message_id) as { document_id: string; recipient_name: string; phone: string; pdf_sha256: string | null } | undefined;
    if (!base) continue;
    if (db.prepare('SELECT 1 FROM invitation_delivery_logs WHERE provider_message_id = ? AND status = ?').get(s.message_id, s.status)) continue; // webhook bisa dikirim ulang
    logDelivery(db, { id: 'whatsapp-webhook', name: 'WhatsApp API', role: 'operator' } as Actor, { ...base, method: 'cloud_api', status: s.status, provider_message_id: s.message_id, error: s.error });
    n++;
  }
  return n;
}
