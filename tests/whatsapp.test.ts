import { describe, expect, it } from 'vitest';
import { formatWaPhone, inviteMessage, isWaLink, normalizeWaPhone, waLink } from '@shared/whatsapp';

describe('WhatsApp click-to-chat', () => {
  it('menormalkan nomor Indonesia dan menolak yang tidak valid', () => {
    for (const x of ['0812-3456-7890', '+62 812 3456 7890', '62812 3456 7890', '812 3456 7890', '006281234567890'])
      expect(normalizeWaPhone(x), x).toBe('6281234567890');
    expect(normalizeWaPhone('+1 (415) 555-0100')).toBe('14155550100');
    for (const bad of ['', '021-1234567', '0812', '08123abc456', '+62 0812 3456 7890', '62812345678901234']) expect(normalizeWaPhone(bad), bad).toBeNull();
    expect(formatWaPhone('6281234567890')).toBe('+62 812-3456-7890');
  });

  it('tautan memuat nomor dan pesan ter-encode, dan hanya bentuk resmi yang lolos', () => {
    const text = 'Yth. Bapak & Ibu\nRapat 10:00 #1';
    const web = waLink('6281234567890', text, 'web');
    expect(web).toBe(`https://wa.me/6281234567890?text=${encodeURIComponent(text)}`);
    expect(decodeURIComponent(new URL(web).searchParams.get('text')!)).toBe(text);
    expect(waLink('6281234567890', text, 'desktop')).toMatch(/^whatsapp:\/\/send\?phone=6281234567890&text=/);
    expect(isWaLink(web)).toBe(true);
    for (const bad of ['https://wa.me.evil.com/628?text=x', 'https://evil.com/?u=https://wa.me/6281234567890?text=', 'file:///C:/x', 'whatsapp://send?phone=62&text=x'])
      expect(isWaLink(bad), bad).toBe(false);
  });

  it('pesan pengantar memakai isian yang ada saja', () => {
    const m = inviteMessage({ recipient: 'Kepala Dinas', subject: 'Rapat Koordinasi', number: 'UND-01', date: 'Senin, 7 Desember 2026', place: '' });
    expect(m).toContain('Yth. Kepala Dinas,');
    expect(m).toContain('Rapat Koordinasi nomor UND-01');
    expect(m).toContain('Hari/Tanggal: Senin, 7 Desember 2026');
    expect(m).not.toContain('Tempat:');
  });
});
