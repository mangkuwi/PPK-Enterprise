import { parseIdDate } from './import';

export type AgendaStatus = 'terjadwal' | 'selesai' | 'dibatalkan';
export const AGENDA_STATUS_LABEL: Record<AgendaStatus, string> = { terjadwal: 'Terjadwal', selesai: 'Selesai', dibatalkan: 'Dibatalkan' };

export interface AgendaInput {
  title: string; letter_number: string; source_document_id: string | null;
  agenda_date: string; start_time: string; end_time: string;
  location: string; meeting_url: string; organizer: string; agenda_text: string; notes: string;
  /** Penanggung jawab utama (pengguna aplikasi), boleh kosong. */
  pic_user_id: string | null;
  support_user_ids: string[];
}
export interface Agenda extends Omit<AgendaInput, 'pic_user_id' | 'support_user_ids'> {
  id: string; status: AgendaStatus; cancel_reason: string; version: number;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
  pic: { id: string; name: string } | null;
  support: Array<{ id: string; name: string }>;
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
/** Nama hari dari tanggal YYYY-MM-DD (kalender, tanpa zona waktu). */
export const dayName = (iso: string) => HARI[new Date(`${iso}T00:00:00Z`).getUTCDay()];

const MEET = /https?:\/\/[^\s]*(zoom\.us|teams\.microsoft\.com|teams\.live\.com|meet\.google\.com)[^\s]*/i;
const pad = (h: string) => h.padStart(2, '0');

/** "09.00 - 12.00 WIB", "09:00 s.d. selesai", "pukul 9.30" → jam mulai/selesai HH:MM (kosong bila tidak terbaca). */
export function parseTimes(v: string): { start: string; end: string } {
  const t = [...(v ?? '').matchAll(/(\d{1,2})[.:](\d{2})/g)].map((m) => `${pad(m[1])}:${m[2]}`).filter((x) => x <= '23:59');
  return { start: t[0] ?? '', end: t[1] ?? '' };
}

/** Isian formulir surat undangan → usulan agenda. Pengguna tetap memeriksa sebelum menyimpan. */
export function agendaFromInvitation(d: { id?: string | null; title: string; letter_number: string; subject: string; doc_date: string; form_values: Record<string, string> }, organizer: string): AgendaInput {
  const f = d.form_values;
  const place = (f.LOKASI ?? '').trim();
  const url = MEET.exec(place)?.[0] ?? '';
  const { start, end } = parseTimes(f.WAKTU ?? '');
  return {
    title: (f.PERIHAL || d.subject || d.title).trim(), letter_number: (f.NOMOR_SURAT || d.letter_number).trim(), source_document_id: d.id ?? null,
    agenda_date: parseIdDate(f.TANGGAL_ACARA ?? '') ?? '', start_time: start, end_time: end,
    location: url ? place.replace(url, '').replace(/[\s,;-]+$/, '').trim() : place, meeting_url: url,
    organizer, agenda_text: (f.AGENDA ?? '').trim(), notes: '', pic_user_id: null, support_user_ids: []
  };
}
