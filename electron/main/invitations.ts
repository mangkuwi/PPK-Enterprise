import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { normalizeWaPhone, type DeliveryLog, type Recipient } from '@shared/whatsapp';
export type { DeliveryLog, DeliveryMethod, DeliveryStatus, Recipient } from '@shared/whatsapp';
import type { DB } from './db';
import { audit } from './numbering/audit';

const now = () => new Date().toISOString();

export function listRecipients(db: DB, documentId: string): Recipient[] {
  return db.prepare('SELECT id, name, organization, phone FROM invitation_recipients WHERE document_id = ? ORDER BY sort_order, name').all(documentId) as Recipient[];
}

/** Daftar penerima diganti utuh. Nomor dinormalkan; nomor tidak valid atau ganda ditolak. */
export function saveRecipients(db: DB, actor: Actor | null, documentId: string, rows: Array<{ name: string; organization: string; phone: string }>): Recipient[] {
  if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(documentId)) throw new Error('Simpan dokumen dulu sebelum menambah penerima.');
  const seen = new Set<string>();
  const clean = rows.filter((r) => r.name.trim() || r.phone.trim()).map((r) => {
    const phone = normalizeWaPhone(r.phone);
    if (!phone) throw new Error(`Nomor WhatsApp "${r.phone}"${r.name ? ` (${r.name})` : ''} tidak valid. Contoh: 0812-3456-7890.`);
    if (seen.has(phone)) throw new Error(`Nomor ${r.phone} tercantum lebih dari sekali.`);
    seen.add(phone);
    return { name: r.name.trim().slice(0, 200), organization: r.organization.trim().slice(0, 200), phone };
  });
  db.transaction(() => {
    const before = listRecipients(db, documentId);
    db.prepare('DELETE FROM invitation_recipients WHERE document_id = ?').run(documentId);
    const ins = db.prepare('INSERT INTO invitation_recipients (id, document_id, name, organization, phone, sort_order, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)');
    clean.forEach((r, i) => ins.run(randomUUID(), documentId, r.name, r.organization, r.phone, i, actor?.name ?? 'Sistem', now()));
    audit(db, actor, 'invitation.recipients', 'documents', documentId, { before: before.map(({ name, phone }) => ({ name, phone })), after: clean.map(({ name, phone }) => ({ name, phone })) });
  })();
  return listRecipients(db, documentId);
}

/** Tambah baris riwayat (append-only). Status sent/delivered/read hanya dari konfirmasi WhatsApp Business API. */
export function logDelivery(db: DB, actor: Actor | null, e: Omit<DeliveryLog, 'id' | 'actor_name' | 'created_at'>): DeliveryLog {
  if (e.method !== 'cloud_api' && e.status !== 'whatsapp_opened' && e.status !== 'failed')
    throw new Error('Click-to-chat tidak dapat memastikan pesan terkirim; status yang boleh dicatat hanya "WhatsApp dibuka".');
  const row: DeliveryLog = { ...e, id: randomUUID(), actor_name: actor?.name ?? 'Sistem', created_at: now() };
  db.prepare(`INSERT INTO invitation_delivery_logs (id, document_id, recipient_name, phone, method, status, pdf_sha256, provider_message_id, error, actor_id, actor_name, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.id, row.document_id, row.recipient_name, row.phone, row.method, row.status, row.pdf_sha256, row.provider_message_id, row.error,
    actor?.id ?? null, row.actor_name, row.created_at);
  return row;
}

export function deliveryHistory(db: DB, documentId: string): DeliveryLog[] {
  return db.prepare('SELECT * FROM invitation_delivery_logs WHERE document_id = ? ORDER BY created_at DESC, rowid DESC').all(documentId) as DeliveryLog[];
}

/** Sudah pernah dibuka/dikirim ke nomor ini untuk dokumen ini (pencegah kirim ganda; pengguna tetap boleh mengulang setelah konfirmasi). */
export function alreadyDelivered(db: DB, documentId: string, phone: string): boolean {
  return !!db.prepare("SELECT 1 FROM invitation_delivery_logs WHERE document_id = ? AND phone = ? AND status <> 'failed' LIMIT 1").get(documentId, phone);
}
