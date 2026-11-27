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
  invitation_id: string | null; letter_date: string | null; program_id: string | null; participants: string;
  verified_by: string | null; verified_at: string | null; archived_at: string | null;
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

export type InvitationStatus = 'baru' | 'diproses' | 'menunggu_verifikasi' | 'dikonversi' | 'gagal' | 'ditolak' | 'diarsipkan';
export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  baru: 'Undangan baru', diproses: 'Sedang diproses', menunggu_verifikasi: 'Menunggu verifikasi', dikonversi: 'Berhasil dikonversi',
  gagal: 'Gagal diproses', ditolak: 'Ditolak', diarsipkan: 'Diarsipkan'
};
export interface InvitationRow {
  id: string; source: 'whatsapp' | 'unggah'; sender_phone: string; sender_name: string; received_at: string;
  message_text: string; status: InvitationStatus; error_message: string; file_count: number;
}

/** Ringkasan beranda Agenda PPK. Semua angka dari query, tidak ada yang disimpan. */
export interface AgendaHome {
  today: string;
  counts: { month_total: number; today_total: number; wa_incoming: number; pending_verification: number; pending_assignment: number };
  inbox: { baru: number; menunggu_verifikasi: number; gagal: number; dikonversi_bulan_ini: number };
  today_agendas: Agenda[];
  upcoming: Agenda[];
  awaiting_verification: InvitationRow[];
  unassigned: Agenda[];
  needs_report: Agenda[];
}

/** Label status di layar: Ditugaskan/Belum ditugaskan dihitung dari penanggung jawab, tidak disimpan. */
export function agendaDisplay(a: Pick<Agenda, 'status' | 'archived_at' | 'pic'>): { label: string; tone: 'navy' | 'amber' | 'green' | 'red' | 'slate' } {
  if (a.archived_at) return { label: 'Diarsipkan', tone: 'slate' };
  if (a.status === 'selesai') return { label: 'Selesai', tone: 'green' };
  if (a.status === 'dibatalkan') return { label: 'Dibatalkan', tone: 'red' };
  return a.pic ? { label: 'Ditugaskan', tone: 'navy' } : { label: 'Belum ditugaskan', tone: 'amber' };
}

export type CalendarView = 'bulan' | 'minggu' | 'hari';
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plus = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 864e5));
const monday = (s: string) => plus(s, -((day(s).getUTCDay() + 6) % 7));

/** Hari yang tampil di kalender (minggu mulai Senin). Bulan = minggu penuh yang menutup bulan itu. */
export function calendarDays(view: CalendarView, cursor: string): string[] {
  if (view === 'hari') return [cursor];
  const start = monday(view === 'bulan' ? `${cursor.slice(0, 7)}-01` : cursor);
  if (view === 'minggu') return Array.from({ length: 7 }, (_, i) => plus(start, i));
  const d = day(`${cursor.slice(0, 7)}-01`); d.setUTCMonth(d.getUTCMonth() + 1);
  const end = plus(monday(plus(iso(d), -1)), 6);
  const out: string[] = [];
  for (let x = start; x <= end; x = plus(x, 1)) out.push(x);
  return out;
}

/** Geser kursor kalender satu bulan/minggu/hari. */
export function shiftCursor(view: CalendarView, cursor: string, dir: 1 | -1): string {
  if (view === 'hari') return plus(cursor, dir);
  if (view === 'minggu') return plus(cursor, 7 * dir);
  const d = day(`${cursor.slice(0, 7)}-01`); d.setUTCMonth(d.getUTCMonth() + dir);
  return iso(d);
}
