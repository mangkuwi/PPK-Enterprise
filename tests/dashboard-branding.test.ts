import { describe, expect, it } from 'vitest';
import { dueState, taskStats } from '@shared/ppk/tasks';
import { joinButton, meetingMode } from '@shared/ppk/agenda';
import { activityItem, timeAgo } from '@shared/ppk/activity';
import { isoWeek } from '@shared/date';
import { monitoredPrograms } from '@shared/dashboard';

const T = '2026-11-28';
describe('Dashboard: tugas', () => {
  it('status tenggat dan angka kartu', () => {
    expect(dueState({ status: 'berjalan', due_date: '2026-11-27' }, T)).toBe('terlambat');
    expect(dueState({ status: 'berjalan', due_date: T }, T)).toBe('hari_ini');
    expect(dueState({ status: 'berjalan', due_date: '2026-12-01' }, T)).toBe('segera');
    expect(dueState({ status: 'berjalan', due_date: '2026-12-02' }, T)).toBeNull();
    expect(dueState({ status: 'selesai', due_date: '2026-11-01' }, T)).toBeNull();
    const list = [
      { status: 'berjalan' as const, due_date: '2026-11-20', created_at: '2026-11-27T01:00:00Z' },
      { status: 'berjalan' as const, due_date: null, created_at: '2026-11-01T01:00:00Z' },
      { status: 'selesai' as const, due_date: T, created_at: '2026-11-25T01:00:00Z' }];
    expect(taskStats(list, T)).toEqual({ total: 3, open: 2, done: 1, near: 1, late: 1, newThisWeek: 2 });
  });
});

describe('Dashboard: agenda', () => {
  it('tombol Join hanya untuk tautan valid', () => {
    expect(joinButton('https://us02web.zoom.us/j/123')).toBe('Join Zoom');
    expect(joinButton('https://meet.google.com/abc-defg-hij')).toBe('Join Google Meet');
    expect(joinButton('zoom.us/j/1')).toBeNull();
    expect(joinButton('javascript:alert(1)')).toBeNull();
    expect(joinButton('https://evilzoom.us.example.com/j/1')).toBe('Buka Tautan Rapat');
    expect(meetingMode({ meeting_url: 'https://zoom.us/j/1', location: 'R. Rapat 21' })).toBe('Hybrid');
    expect(meetingMode({ meeting_url: 'https://zoom.us/j/1', location: '' })).toBe('Online');
    expect(meetingMode({ meeting_url: '', location: 'R. Rapat 21' })).toBe('Offline');
  });
  it('minggu ISO', () => {
    expect(isoWeek('2026-11-27')).toBe(48);
    expect(isoWeek('2027-01-01')).toBe(53);
    expect(isoWeek('2026-01-01')).toBe(1);
  });
});

describe('Dashboard: aktivitas & monitoring', () => {
  it('label aktivitas dan waktu relatif', () => {
    expect(activityItem({ at: 'x', actor_name: 'Sari', action: 'ppk.invitation.upload', title: null, detail_json: '{"filename":"und.pdf"}' }).text).toBe('Dokumen undangan diunggah: und.pdf');
    expect(activityItem({ at: 'x', actor_name: 'Sari', action: 'ppk.contract.status', title: null, detail_json: '{"after":"selesai"}' }).text).toBe('Status kontrak diubah: selesai');
    const now = Date.parse('2026-11-28T10:00:00Z');
    expect(timeAgo('2026-11-28T09:50:00Z', now)).toBe('10 menit yang lalu');
    expect(timeAgo('2026-11-28T07:00:00Z', now)).toBe('3 jam yang lalu');
    expect(timeAgo('2026-11-26T10:00:00Z', now)).toBe('2 hari yang lalu');
  });
  it('program dipantau menggabungkan detail output yang cocok', () => {
    const p = (name: string, pagu: number, billed: number) => ({ name, pagu, billed, pct: 0 });
    const { rows, others } = monitoredPrograms([p('SATRIA-1 Sewa Kapasitas', 1000, 500), p('OM IP HUB', 300, 100), p('IP Hub', 700, 400), p('Sewa transponder', 50, 5)]);
    expect(rows.map((r) => [r.name, r.pagu, r.billed, r.pct])).toEqual([['SATRIA 1', 1000, 500, 50], ['IP HUB', 1000, 500, 50], ['IP Transit', 0, 0, 0], ['Akses Internet', 0, 0, 0]]);
    expect(rows[1].sources).toEqual(['OM IP HUB', 'IP Hub']);
    expect(others.map((o) => o.name)).toEqual(['Sewa transponder']);
  });
});
