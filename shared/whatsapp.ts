/**
 * WhatsApp click-to-chat (wa.me / whatsapp://send). Hanya membuka chat dengan pesan terisi: lampiran PDF tidak bisa
 * ikut lewat tautan, dan pengguna sendiri yang menekan Kirim. Jadi status tertinggi yang boleh dicatat = "WhatsApp dibuka".
 */

/** Nomor Indonesia/internasional → digit E.164 tanpa '+' (mis. 6281234567890), atau null bila tidak valid. */
export function normalizeWaPhone(input: string): string | null {
  const raw = input.trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return null;
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) { /* sudah berkode negara */ }
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  if (d.startsWith('62')) return /^628\d{7,11}$/.test(d) ? d : null; // seluler Indonesia: 08xx, 10–13 digit
  return /^[1-9]\d{7,14}$/.test(d) ? d : null;
}

export const formatWaPhone = (e164: string) => (e164.startsWith('62') ? `+62 ${e164.slice(2).replace(/(\d{3})(\d{4})(\d+)/, '$1-$2-$3')}` : `+${e164}`);

export type WaTarget = 'desktop' | 'web';

/** Tautan resmi: whatsapp://send untuk aplikasi Desktop, https://wa.me untuk browser (WhatsApp Web). */
export function waLink(e164: string, text: string, target: WaTarget): string {
  const t = encodeURIComponent(text);
  return target === 'desktop' ? `whatsapp://send?phone=${e164}&text=${t}` : `https://wa.me/${e164}?text=${t}`;
}

/** Hanya dua bentuk tautan di atas yang boleh dibuka main process. */
export const isWaLink = (url: string) => /^(whatsapp:\/\/send\?phone=\d{8,15}&text=|https:\/\/wa\.me\/\d{8,15}\?text=)[^\s]*$/.test(url);

/** Pesan pengantar dari isian formulir surat undangan; kosong dilewati. Pengguna dapat mengubahnya sebelum dibuka. */
export function inviteMessage(v: { recipient?: string; subject?: string; number?: string; date?: string; time?: string; place?: string; agenda?: string }): string {
  const line = (label: string, x?: string) => (x?.trim() ? `${label}: ${x.trim()}` : null);
  return [
    `Yth. ${v.recipient?.trim() || 'Bapak/Ibu'},`,
    '',
    `Dengan hormat, bersama ini kami sampaikan surat undangan${v.subject?.trim() ? ` ${v.subject.trim()}` : ''}${v.number?.trim() ? ` nomor ${v.number.trim()}` : ''}.`,
    ...[line('Hari/Tanggal', v.date), line('Waktu', v.time), line('Tempat', v.place), line('Agenda', v.agenda)].filter((x): x is string => !!x),
    '',
    'Surat undangan terlampir dalam bentuk PDF. Atas perhatian dan kehadiran Bapak/Ibu, kami ucapkan terima kasih.'
  ].join('\n');
}

/** Status pengiriman tersimpan. Draf/Siap dikirim hanya tampilan (penerima tanpa riwayat). */
export type DeliveryMethod = 'wa_desktop' | 'wa_web' | 'cloud_api';
export type DeliveryStatus = 'whatsapp_opened' | 'submitted' | 'sent' | 'delivered' | 'read' | 'failed';
export interface Recipient { id: string; name: string; organization: string; phone: string }
export interface DeliveryLog {
  id: string; document_id: string; recipient_name: string; phone: string; method: DeliveryMethod; status: DeliveryStatus;
  pdf_sha256: string | null; provider_message_id: string | null; error: string | null; actor_name: string; created_at: string;
}

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  whatsapp_opened: 'WhatsApp dibuka', submitted: 'Diterima API', sent: 'Terkirim', delivered: 'Sampai', read: 'Dibaca', failed: 'Gagal'
};
