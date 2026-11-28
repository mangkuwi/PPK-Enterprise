import { describe, expect, it } from 'vitest';
import { clientInfo, loginBlocked, loginFailed, loginSucceeded, safeFileName, sameOrigin } from '../electron/main/webGuard';

describe('pengaman mode web', () => {
  it('memblokir IP setelah 20 login gagal selama 15 menit, IP lain tidak terpengaruh', () => {
    const t = 1_000_000;
    for (let i = 0; i < 19; i++) loginFailed('10.0.0.9', t);
    expect(loginBlocked('10.0.0.9', t)).toBe(false);
    loginFailed('10.0.0.9', t);
    expect(loginBlocked('10.0.0.9', t + 60_000)).toBe(true);
    expect(loginBlocked('10.0.0.8', t)).toBe(false);
    expect(loginBlocked('10.0.0.9', t + 15 * 60_000)).toBe(false);
    loginFailed('10.0.0.7', t); loginSucceeded('10.0.0.7');
    expect(loginBlocked('10.0.0.7', t)).toBe(false);
  });

  it('header X-Forwarded hanya dipercaya dari proxy di komputer yang sama', () => {
    const h = { 'x-forwarded-for': '203.0.113.5, 10.0.0.1', 'x-forwarded-proto': 'https' };
    expect(clientInfo('127.0.0.1', h)).toEqual({ ip: '203.0.113.5', https: true });
    expect(clientInfo('198.51.100.7', h)).toEqual({ ip: '198.51.100.7', https: false });
    expect(clientInfo('::1', {})).toEqual({ ip: '::1', https: false });
  });

  it('menolak Origin situs lain', () => {
    expect(sameOrigin(undefined, 'ppk.kantor.go.id')).toBe(true);
    expect(sameOrigin('https://ppk.kantor.go.id', 'ppk.kantor.go.id')).toBe(true);
    expect(sameOrigin('https://jahat.example', 'ppk.kantor.go.id')).toBe(false);
    expect(sameOrigin('null', 'ppk.kantor.go.id')).toBe(false);
  });

  it('nama berkas unggahan tanpa folder dan karakter berbahaya', () => {
    expect(safeFileName('..\\..\\Windows\\evil.xlsx')).toBe('evil.xlsx');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('Undangan Rapat – Ñ (1).pdf')).toBe('Undangan Rapat _ Ñ (1).pdf');
    expect(safeFileName('...')).toBe('berkas');
  });
});
