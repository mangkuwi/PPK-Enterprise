/** Kunci sementara setelah salah kata sandi berulang (per pengguna, di memori proses utama). */
const MAX = 5; const LOCK_MS = 5 * 60_000;
const fails = new Map<string, { n: number; until: number }>();

/** Sisa menit terkunci, 0 bila boleh mencoba. */
export function lockedMinutes(key: string, now = Date.now()): number {
  const f = fails.get(key);
  return f && f.until > now ? Math.ceil((f.until - now) / 60_000) : 0;
}
export function recordFail(key: string, now = Date.now()) {
  const f = fails.get(key) ?? { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= MAX) { f.n = 0; f.until = now + LOCK_MS; }
  fails.set(key, f);
}
export const clearFails = (key: string) => { fails.delete(key); };
export const lockMessage = (min: number) => `Terlalu banyak percobaan salah. Coba lagi dalam ${min} menit.`;
