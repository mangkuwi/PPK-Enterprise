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
  /** Tanggal surat (bukan tanggal acara), program terkait, peserta yang diundang, undangan asal. Boleh kosong. */
  letter_date?: string | null; program_id?: string | null; participants?: string; invitation_id?: string | null;
}
export interface Agenda extends Omit<AgendaInput, 'pic_user_id' | 'support_user_ids' | 'letter_date' | 'program_id' | 'participants' | 'invitation_id'> {
  id: string; status: AgendaStatus; cancel_reason: string; version: number;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
  invitation_id: string | null; letter_date: string | null; program_id: string | null; participants: string;
  verified_by: string | null; verified_at: string | null; archived_at: string | null;
  deleted_at?: string | null; deleted_by?: string | null; delete_reason?: string;
  pic: Assignee | null;
  support: Assignee[];
}
/** Status tugas per orang di satu agenda. Diubah oleh orang yang ditugaskan sendiri atau staf PPK. */
export type AssignStatus = 'ditugaskan' | 'diterima' | 'selesai';
export const ASSIGN_STATUS_LABEL: Record<AssignStatus, string> = { ditugaskan: 'Ditugaskan', diterima: 'Diterima', selesai: 'Selesai' };
export interface Assignee { id: string; name: string; duty?: string; status?: AssignStatus }

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
  gagal: 'Gagal diproses', ditolak: 'Selesai tanpa agenda', diarsipkan: 'Diarsipkan'
};
export interface InvitationRow {
  id: string; source: 'whatsapp' | 'unggah'; sender_phone: string; sender_name: string; received_at: string;
  message_text: string; status: InvitationStatus; error_message: string; file_count: number;
}

/** Ringkasan beranda Agenda PPK. Semua angka dari query, tidak ada yang disimpan. */
export interface AgendaHome {
  today: string;
  counts: { month_total: number; today_total: number; wa_incoming: number; pending_verification: number; pending_assignment: number };
  /** belum_* = belum diproses (baru/diproses/menunggu verifikasi) dengan lampiran PDF / tanpa lampiran; diproses_bulan_ini = jadi agenda atau selesai tanpa agenda. */
  inbox: { baru: number; menunggu_verifikasi: number; gagal: number; dikonversi_bulan_ini: number; belum_pdf: number; belum_teks: number; diproses_bulan_ini: number };
  today_agendas: Agenda[];
  upcoming: Agenda[];
  awaiting_verification: InvitationRow[];
  unassigned: Agenda[];
  needs_report: Agenda[];
}

/** Label status di layar: Ditugaskan/Belum ditugaskan dihitung dari penanggung jawab, tidak disimpan. */
export function agendaDisplay(a: Pick<Agenda, 'status' | 'archived_at' | 'pic' | 'deleted_at'>): { label: string; tone: 'navy' | 'amber' | 'green' | 'red' | 'slate' } {
  if (a.deleted_at) return { label: 'Terhapus', tone: 'red' };
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

/** Label tombol gabung rapat daring dari tautannya. */
export function joinLabel(url: string): string {
  if (/zoom\.us/i.test(url)) return 'Gabung Zoom';
  if (/teams\.(microsoft|live)\.com/i.test(url)) return 'Gabung Teams';
  if (/meet\.google\.com/i.test(url)) return 'Gabung Google Meet';
  return 'Buka tautan rapat';
}

const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
/** 'berlangsung' (jam mulai ≤ sekarang < jam selesai), 'segera' (mulai ≤ 15 menit lagi), atau null. Jam = WIB 'HH:MM'. */
export function liveState(a: Pick<Agenda, 'agenda_date' | 'start_time' | 'end_time' | 'status'>, today: string, now: string): 'berlangsung' | 'segera' | null {
  if (a.status !== 'terjadwal' || a.agenda_date !== today || !a.start_time) return null;
  const n = mins(now), s = mins(a.start_time), e = a.end_time ? mins(a.end_time) : s + 60;
  if (n >= s && n < e) return 'berlangsung';
  if (s - n > 0 && s - n <= 15) return 'segera';
  return null;
}

/** Filter daftar agenda. status = label layar (Belum ditugaskan/Ditugaskan dihitung dari penanggung jawab). */
export type AgendaFilterStatus = 'aktif' | 'belum_ditugaskan' | 'ditugaskan' | 'selesai' | 'dibatalkan' | 'diarsipkan' | 'terhapus' | 'semua';
export interface AgendaFilter { from?: string; to?: string; q?: string; program_id?: string; user_id?: string; organizer?: string; status?: AgendaFilterStatus }

/** Dua kegiatan di hari yang sama bentrok bila jamnya beririsan. Tanpa jam selesai = 1 jam; tanpa jam mulai = tidak dinilai. */
export function overlaps(a: Pick<Agenda, 'agenda_date' | 'start_time' | 'end_time'>, b: Pick<Agenda, 'agenda_date' | 'start_time' | 'end_time'>): boolean {
  if (a.agenda_date !== b.agenda_date || !a.start_time || !b.start_time) return false;
  const end = (x: typeof a) => (x.end_time ? mins(x.end_time) : mins(x.start_time) + 60);
  return mins(a.start_time) < end(b) && mins(b.start_time) < end(a);
}
export interface AgendaConflict { id: string; title: string; agenda_date: string; start_time: string; end_time: string; shared_staff: string[] }
export interface AgendaHistoryRow { at: string; actor_name: string; action: string; detail: Record<string, unknown> }
export interface InvitationFile { id: string; filename: string; mime_type: string; size_bytes: number; created_at: string }

/** Kategori Kotak Masuk dipetakan dari status undangan yang sudah ada (tanpa kolom baru). "Sudah diproses" tanpa agenda = status ditolak. */
export type InboxCategory = 'baru' | 'belum' | 'sudah' | 'arsip' | 'gagal';
export const INBOX_CATEGORY: Record<InboxCategory, { label: string; statuses: InvitationStatus[] }> = {
  baru: { label: 'Baru', statuses: ['baru'] },
  belum: { label: 'Belum diproses', statuses: ['baru', 'diproses', 'menunggu_verifikasi'] },
  sudah: { label: 'Sudah diproses', statuses: ['dikonversi', 'ditolak'] },
  arsip: { label: 'Diarsipkan', statuses: ['diarsipkan'] },
  gagal: { label: 'Gagal', statuses: ['gagal'] }
};
export interface InvitationDetail extends InvitationRow {
  reject_reason: string; verified_by: string | null; verified_at: string | null; duplicate_of: string | null;
  files: InvitationFile[]; agenda: { id: string; title: string; agenda_date: string } | null; history: AgendaHistoryRow[];
}

/** Posisi kartu di grid jam satu hari: menit dari awal grid, durasi, dan lajur bila jam beririsan. Agenda tanpa jam tidak masuk grid. */
export function layoutDay<T extends Pick<Agenda, 'agenda_date' | 'start_time' | 'end_time'>>(items: T[], startHour: number):
  Array<{ item: T; top: number; height: number; lane: number; lanes: number }> {
  const timed = items.filter((a) => a.start_time).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const out = timed.map((item) => {
    const s = mins(item.start_time); const e = item.end_time ? mins(item.end_time) : s + 60;
    return { item, top: s - startHour * 60, height: Math.max(e - s, 30), lane: 0, lanes: 1 };
  });
  // Kelompok = rangkaian kartu yang saling beririsan; tiap kelompok dibagi rata ke lajur.
  let group: typeof out = []; let groupEnd = -1;
  const close = () => { const n = Math.max(...group.map((g) => g.lane)) + 1; group.forEach((g) => { g.lanes = n; }); };
  for (const g of out) {
    if (group.length && g.top >= groupEnd) { close(); group = []; }
    const used = new Set(group.filter((x) => x.top + x.height > g.top).map((x) => x.lane));
    while (used.has(g.lane)) g.lane++;
    group.push(g); groupEnd = Math.max(groupEnd, g.top + g.height);
  }
  if (group.length) close();
  return out;
}

/**
 * Agenda sorotan beranda: yang sedang berlangsung, lalu yang berikutnya hari ini, lalu yang terdekat sesudahnya.
 * Agenda hari ini tanpa jam ikut bila belum ada yang berjam. rest = sisanya, urut waktu.
 */
export function focusAgenda(todayList: Agenda[], upcoming: Agenda[], today: string, now: string): { focus: Agenda | null; rest: Agenda[] } {
  const open = (a: Agenda) => a.status === 'terjadwal' && !a.archived_at;
  const todayLeft = todayList.filter((a) => open(a) && a.agenda_date === today && (!a.start_time || (a.end_time ? mins(a.end_time) : mins(a.start_time) + 60) > mins(now)));
  const all = [...todayLeft, ...upcoming.filter((a) => open(a) && a.agenda_date > today)]
    .sort((a, b) => a.agenda_date.localeCompare(b.agenda_date) || (a.start_time || '99').localeCompare(b.start_time || '99'));
  const focus = all.find((a) => liveState(a, today, now) === 'berlangsung') ?? all[0] ?? null;
  return { focus, rest: all.filter((a) => a !== focus) };
}

/** "dimulai 2 jam 5 menit lagi" / "dimulai 10 menit lalu" untuk agenda hari ini; null bila bukan hari ini atau tanpa jam. */
export function startsInText(a: Pick<Agenda, 'agenda_date' | 'start_time'>, today: string, now: string): string | null {
  if (a.agenda_date !== today || !a.start_time) return null;
  const d = mins(a.start_time) - mins(now);
  const t = (m: number) => [Math.floor(m / 60) && `${Math.floor(m / 60)} jam`, m % 60 && `${m % 60} menit`].filter(Boolean).join(' ') || 'kurang dari 1 menit';
  return d > 0 ? `dimulai ${t(d)} lagi` : d === 0 ? 'dimulai sekarang' : `dimulai ${t(-d)} lalu`;
}

/** Jenis rapat dari isian agenda: tautan + lokasi = hybrid, tautan saja = online, selain itu offline. */
export function meetingMode(a: Pick<Agenda, 'meeting_url' | 'location'>): 'Online' | 'Offline' | 'Hybrid' {
  return a.meeting_url.trim() ? (a.location.trim() ? 'Hybrid' : 'Online') : 'Offline';
}

/** Label tombol Join, hanya untuk tautan http(s) yang valid; null = tombol tidak ditampilkan. */
export function joinButton(url: string): string | null {
  let u: URL;
  try { u = new URL(url.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const h = u.hostname.toLowerCase();
  if (h === 'zoom.us' || h.endsWith('.zoom.us')) return 'Join Zoom';
  if (h === 'meet.google.com') return 'Join Google Meet';
  if (/^teams\.(microsoft|live)\.com$/.test(h)) return 'Join Teams';
  return 'Buka Tautan Rapat';
}
