/*
 * Pengaman mode web bila dibuka dari luar komputer server (internet/VPS): alamat IP klien,
 * batas percobaan login per IP, dan cek Origin. Murni (tanpa Electron) agar bisa diuji.
 */

const LOGIN_MAX = 20; // gagal per IP dalam satu jendela waktu; kunci per akun (5x) tetap berlaku terpisah
const LOGIN_WINDOW_MS = 15 * 60_000;
const fails = new Map<string, { n: number; since: number }>();

export function loginBlocked(ip: string, now = Date.now()): boolean {
  const f = fails.get(ip);
  return !!f && now - f.since < LOGIN_WINDOW_MS && f.n >= LOGIN_MAX;
}

export function loginFailed(ip: string, now = Date.now()) {
  for (const [k, v] of fails) if (now - v.since >= LOGIN_WINDOW_MS) fails.delete(k);
  const f = fails.get(ip) ?? { n: 0, since: now };
  f.n += 1;
  fails.set(ip, f);
}

export const loginSucceeded = (ip: string) => { fails.delete(ip); };
export const LOGIN_BLOCKED_MSG = 'Terlalu banyak percobaan masuk dari perangkat/jaringan ini. Coba lagi dalam 15 menit.';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * IP klien dan apakah sambungannya HTTPS. Header X-Forwarded-* hanya dipercaya bila datang dari
 * reverse proxy di komputer yang sama (loopback), agar klien dari luar tidak bisa memalsukan IP.
 */
export function clientInfo(remote: string | undefined, headers: Record<string, string | string[] | undefined>): { ip: string; https: boolean } {
  const ip = remote ?? '';
  const fwd = headers['x-forwarded-for'];
  if (!LOOPBACK.has(ip) || typeof fwd !== 'string' || !fwd) return { ip, https: false };
  return { ip: fwd.split(',')[0].trim(), https: headers['x-forwarded-proto'] === 'https' };
}

/** Permintaan API dari halaman situs lain ditolak (CSRF). Tanpa header Origin = bukan dari browser lintas situs. */
export function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

/** Nama berkas aman untuk disimpan sementara di server (tanpa folder, tanpa karakter aneh). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop()!.replace(/[^\p{L}\p{N}._\- ()]+/gu, '_').replace(/^\.+/, '').slice(0, 150);
  return base || 'berkas';
}
