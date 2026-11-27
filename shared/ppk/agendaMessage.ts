/**
 * Pembaca pesan berformat "AGENDA PPK" (tanpa AI): label tetap, regex, dan validasi pasti.
 * Nilai yang tidak lolos validasi dikosongkan dan dilaporkan, tidak pernah ditebak.
 */
import { parseIdDate } from './import';

export type AgendaMessageField = 'kegiatan' | 'tanggal' | 'waktu' | 'lokasi' | 'penyelenggara' | 'link' | 'program';
export const AGENDA_MESSAGE_LABEL: Record<AgendaMessageField, string> = {
  kegiatan: 'Kegiatan', tanggal: 'Tanggal', waktu: 'Waktu', lokasi: 'Lokasi', penyelenggara: 'Penyelenggara', link: 'Link', program: 'Program'
};
const FIELDS = Object.keys(AGENDA_MESSAGE_LABEL) as AgendaMessageField[];

export interface AgendaMessage {
  title: string; agenda_date: string; start_time: string; end_time: string;
  location: string; organizer: string; meeting_url: string; program: string;
  /** Teks asli per label, apa adanya dari pesan. */
  raw: Partial<Record<AgendaMessageField, string>>;
  /** Label yang tidak ada di pesan. */
  missing: AgendaMessageField[];
  /** Label yang ada tapi nilainya ditolak, beserta alasannya. */
  invalid: Array<{ field: AgendaMessageField; reason: string }>;
}

const two = (n: number) => String(n).padStart(2, '0');

/** "04-12-2026", "4/12/2026", "04.12.2026", "4 Desember 2026" → "2026-12-04". Tanggal yang tidak ada (31-02) ditolak. */
export function strictDate(v: string): string | null {
  const t = v.trim();
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  if (m) {
    const [d, mo, y] = [+m[1], +m[2], +m[3]];
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${y}-${two(mo)}-${two(d)}` : null;
  }
  let clamped = false;
  const r = /^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(t) ? parseIdDate(t, () => { clamped = true; }) : null;
  return clamped ? null : r;
}

/** "09.00-11.00", "09:00 - 11:00 WIB", "09.00 - selesai", "13.30" → jam mulai/selesai. */
export function strictTimes(v: string): { start: string; end: string } | { error: string } {
  const m = /^(\d{1,2})[.:](\d{2})(?:\s*(?:-|–|s\.?d\.?|sampai)\s*(?:(\d{1,2})[.:](\d{2})|selesai))?(?:\s*WIB)?$/i.exec(v.trim());
  if (!m) return { error: 'Format jam tidak dikenali. Contoh: 09.00-11.00' };
  const hm = (h: string, mi: string) => (+h <= 23 && +mi <= 59 ? `${two(+h)}:${mi}` : null);
  const start = hm(m[1], m[2]); const end = m[3] ? hm(m[3], m[4]) : '';
  if (!start || end === null) return { error: 'Jam di luar 00.00–23.59.' };
  if (end && end <= start) return { error: 'Jam selesai harus setelah jam mulai.' };
  return { start, end };
}

/** null bila pesan bukan format AGENDA PPK (perlu judul "AGENDA PPK" dan label Kegiatan). */
export function parseAgendaMessage(text: string): AgendaMessage | null {
  const lines = (text ?? '').split(/\r?\n/).map((l) => l.replace(/[*_~]/g, '').trim()); // WhatsApp: *tebal* _miring_
  if (!lines.some((l) => /^agenda\s+ppk\s*:?$/i.test(l))) return null;
  const raw: AgendaMessage['raw'] = {};
  for (const l of lines) {
    const m = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(l);
    const f = m && FIELDS.find((x) => x === m[1].toLowerCase());
    if (f && raw[f] === undefined) raw[f] = m[2].trim(); // label ganda: yang pertama dipakai
  }
  if (!raw.kegiatan) return null;
  const out: AgendaMessage = { title: raw.kegiatan, agenda_date: '', start_time: '', end_time: '', location: raw.lokasi ?? '', organizer: raw.penyelenggara ?? '',
    meeting_url: '', program: raw.program ?? '', raw, missing: FIELDS.filter((f) => !raw[f]), invalid: [] };
  if (raw.tanggal) {
    const d = strictDate(raw.tanggal);
    if (d) out.agenda_date = d; else out.invalid.push({ field: 'tanggal', reason: 'Tanggal tidak valid. Contoh: 04-12-2026' });
  }
  if (raw.waktu) {
    const t = strictTimes(raw.waktu);
    if ('error' in t) out.invalid.push({ field: 'waktu', reason: t.error }); else { out.start_time = t.start; out.end_time = t.end; }
  }
  if (raw.link) {
    if (/^https?:\/\/\S+$/i.test(raw.link)) out.meeting_url = raw.link; else out.invalid.push({ field: 'link', reason: 'Tautan harus diawali http:// atau https://' });
  }
  return out;
}

/** Cocokkan teks Program dengan master program (kode atau nama, tanpa beda huruf besar/kecil). Tidak cocok = null, staf memilih sendiri. */
export function matchProgram(text: string, programs: Array<{ id: string; code?: unknown; name?: unknown }>): string | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const hit = programs.filter((p) => [p.code, p.name].some((x) => String(x ?? '').trim().toLowerCase() === t));
  return hit.length === 1 ? hit[0].id : null;
}
