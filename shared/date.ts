const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

/** '2026-11-23' -> '23 November 2026'. Nilai lain dikembalikan apa adanya. */
export function formatDateID(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return value;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return value;
  return `${Number(m[3])} ${MONTHS[month - 1]} ${m[1]}`;
}

export function todayISO(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Tanggal hari ini (YYYY-MM-DD) di Asia/Jakarta, apa pun zona waktu komputer. */
export const jakartaToday = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

/** Tambah n hari ke tanggal YYYY-MM-DD (kalender, tanpa zona waktu). */
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** Nomor minggu ISO-8601 dari tanggal 'YYYY-MM-DD' (Senin awal minggu). */
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // Kamis di minggu yang sama menentukan tahunnya
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
