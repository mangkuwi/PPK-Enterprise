import { describe, expect, it } from 'vitest';
import { matchProgram, parseAgendaMessage, strictDate, strictTimes } from '../shared/ppk/agendaMessage';

const MSG = `AGENDA PPK
Kegiatan: Rapat Koordinasi IP Transit
Tanggal: 04-12-2026
Waktu: 09.00-11.00
Lokasi: Ruang Rapat Direktorat
Penyelenggara: Direktorat Infrastruktur
Link: https://zoom.us/j/123
Program: IP Transit`;

describe('pembaca format AGENDA PPK', () => {
  it('membaca semua label dari contoh format', () => {
    const r = parseAgendaMessage(MSG)!;
    expect([r.title, r.agenda_date, r.start_time, r.end_time, r.location, r.organizer, r.meeting_url, r.program]).toEqual(
      ['Rapat Koordinasi IP Transit', '2026-12-04', '09:00', '11:00', 'Ruang Rapat Direktorat', 'Direktorat Infrastruktur', 'https://zoom.us/j/123', 'IP Transit']);
    expect(r.missing).toEqual([]); expect(r.invalid).toEqual([]);
  });
  it('huruf besar/kecil, tanda tebal WhatsApp, dan CRLF tidak berpengaruh', () => {
    const r = parseAgendaMessage('*Agenda PPK*\r\nkegiatan : Rapat\r\nTANGGAL: 4/12/2026\r\nwaktu: 13:30 WIB')!;
    expect([r.title, r.agenda_date, r.start_time, r.end_time]).toEqual(['Rapat', '2026-12-04', '13:30', '']);
    expect(r.missing).toEqual(['lokasi', 'penyelenggara', 'link', 'program']);
  });
  it('bukan format AGENDA PPK = null, teks asli tetap dipakai staf', () => {
    expect(parseAgendaMessage('Undangan rapat besok 09.00')).toBeNull();
    expect(parseAgendaMessage('AGENDA PPK\nTanggal: 04-12-2026')).toBeNull(); // tanpa Kegiatan
    expect(parseAgendaMessage('')).toBeNull();
  });
  it('tanggal dan jam yang hilang atau salah tidak pernah ditebak', () => {
    const r = parseAgendaMessage('AGENDA PPK\nKegiatan: Rapat\nTanggal: 31-02-2026\nWaktu: besok pagi\nLink: zoom.us/j/1')!;
    expect([r.agenda_date, r.start_time, r.end_time, r.meeting_url]).toEqual(['', '', '', '']);
    expect(r.invalid.map((x) => x.field)).toEqual(['tanggal', 'waktu', 'link']);
    const k = parseAgendaMessage('AGENDA PPK\nKegiatan: Rapat')!;
    expect([k.agenda_date, k.start_time]).toEqual(['', '']);
    expect(k.missing).toContain('tanggal');
  });
  it('validasi tanggal dan jam', () => {
    expect(strictDate('04.12.2026')).toBe('2026-12-04');
    expect(strictDate('4 Desember 2026')).toBe('2026-12-04');
    expect(strictDate('29-02-2027')).toBeNull();
    expect(strictDate('31 Februari 2026')).toBeNull();
    expect(strictDate('2026')).toBeNull();
    expect(strictTimes('09.00 - selesai')).toEqual({ start: '09:00', end: '' });
    expect(strictTimes('9.00 s.d. 12.30 WIB')).toEqual({ start: '09:00', end: '12:30' });
    expect(strictTimes('11.00-09.00')).toHaveProperty('error');
    expect(strictTimes('25.00')).toHaveProperty('error');
  });
  it('program dicocokkan persis dengan kode atau nama, selain itu staf memilih', () => {
    const p = [{ id: 'a', code: 'IPT', name: 'IP Transit' }, { id: 'b', code: 'BB', name: 'Backbone' }];
    expect(matchProgram('ip transit', p)).toBe('a');
    expect(matchProgram('BB', p)).toBe('b');
    expect(matchProgram('IP', p)).toBeNull();
    expect(matchProgram('', p)).toBeNull();
  });
});
