import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { MIGRATIONS, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { createUser, setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { setPpkRole } from '../electron/main/ppk/access';
import { createAgenda, listAgendas, setAgendaStatus } from '../electron/main/ppk/agenda';
import { agendaHome, listInvitations } from '../electron/main/ppk/agendaHome';
import { addDays, jakartaToday } from '@shared/date';
import type { AgendaInput } from '@shared/ppk/agenda';
import type { Actor } from '@shared/numbering';

const TODAY = '2026-11-27';
const base: AgendaInput = { title: 'Rapat', letter_number: '', source_document_id: null, agenda_date: TODAY, start_time: '', end_time: '', location: '',
  meeting_url: '', organizer: '', agenda_text: '', notes: '', pic_user_id: null, support_user_ids: [] };
let db: DB; let s: PpkStore; let admin: Actor;
const invite = (id: string, status: string, extra: Partial<{ source: string; verified_at: string; wa: string }> = {}) =>
  db.prepare(`INSERT INTO ppk_invitations (id, source, wa_message_id, received_at, status, verified_at, created_by, created_at, updated_by, updated_at)
    VALUES (?,?,?,?,?,?, 'uji', '2026-11-27T01:00:00Z', 'uji', '2026-11-27T01:00:00Z')`).run(id, extra.source ?? 'whatsapp', extra.wa ?? null, `2026-11-27T0${id.length % 9}:00:00Z`, status, extra.verified_at ?? null);

beforeEach(() => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
  setPin(db, admin, admin.id, '123456');
});

describe('migrasi v14', () => {
  it('menambah tabel Agenda Center dari v13 tanpa mengubah agenda lama', async () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 13)) old.exec(m.sql);
    old.pragma('user_version = 13');
    old.prepare("INSERT INTO ppk_agendas (id, title, agenda_date, created_by, created_at, updated_by, updated_at) VALUES ('a1','Lama','2026-11-01','x','t','x','t')").run();
    expect(runMigrations(old)).toBe(14);
    expect(old.prepare('SELECT title, participants, archived_at, invitation_id FROM ppk_agendas').get()).toEqual({ title: 'Lama', participants: '', archived_at: null, invitation_id: null });
    for (const t of ['ppk_invitations', 'ppk_files', 'ppk_invitation_extractions', 'ppk_user_phones', 'ppk_notifications'])
      expect(old.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toEqual({ n: 0 });
    old.close();
  });

  it('pesan WhatsApp unik, file dan ekstraksi tidak bisa diubah, undangan tidak bisa dihapus', () => {
    invite('i1', 'baru', { wa: 'wamid.1' });
    expect(() => invite('i2', 'baru', { wa: 'wamid.1' })).toThrow(/UNIQUE/);
    invite('i3', 'baru', { source: 'unggah' }); invite('i4', 'baru', { source: 'unggah' }); // unggah tanpa wa_message_id boleh banyak
    expect(() => db.prepare("UPDATE ppk_invitations SET status = 'aneh' WHERE id = 'i1'").run()).toThrow(/CHECK/);
    expect(() => db.prepare("DELETE FROM ppk_invitations WHERE id = 'i1'").run()).toThrow(/arsipkan/);
    db.prepare("INSERT INTO ppk_files (id, owner_type, owner_id, filename, mime_type, size_bytes, sha256, content, created_by, created_at) VALUES ('f1','undangan','i1','u.pdf','application/pdf',3,?,?,'uji','t')")
      .run('a'.repeat(64), Buffer.from('pdf'));
    expect(() => db.prepare("UPDATE ppk_files SET filename = 'x'").run()).toThrow(/tidak boleh diubah/);
    expect(() => db.prepare('DELETE FROM ppk_files').run()).toThrow(/tidak boleh dihapus/);
    db.prepare("INSERT INTO ppk_invitation_extractions (id, invitation_id, attempt, confidence, created_at) VALUES ('e1','i1',1,80,'t')").run();
    expect(() => db.prepare("INSERT INTO ppk_invitation_extractions (id, invitation_id, attempt, created_at) VALUES ('e2','i1',1,'t')").run()).toThrow(/UNIQUE/);
    expect(() => db.prepare('UPDATE ppk_invitation_extractions SET confidence = 1').run()).toThrow(/append-only/);
  });
});

describe('beranda Agenda PPK', () => {
  it('semua angka dari data, undangan belum terverifikasi tidak dihitung sebagai agenda', async () => {
    const empty = await agendaHome(s, admin, TODAY);
    expect(empty.counts).toEqual({ month_total: 0, today_total: 0, wa_incoming: 0, pending_verification: 0, pending_assignment: 0 });

    const budi = createUser(db, admin, { name: 'Budi', role: 'operator', pin: '2222' }); await setPpkRole(s, admin, budi.id, 'staf');
    await createAgenda(s, admin, { ...base, title: 'Siang', start_time: '13:00', pic_user_id: budi.id });
    await createAgenda(s, admin, { ...base, title: 'Pagi', start_time: '08:00' });
    await createAgenda(s, admin, { ...base, title: 'Besok', agenda_date: addDays(TODAY, 1) });
    await createAgenda(s, admin, { ...base, title: 'Minggu depan', agenda_date: addDays(TODAY, 7), pic_user_id: budi.id });
    await createAgenda(s, admin, { ...base, title: 'Lewat 8 hari', agenda_date: addDays(TODAY, 8) });
    const lalu = await createAgenda(s, admin, { ...base, title: 'Kemarin', agenda_date: addDays(TODAY, -1) });
    const batal = await createAgenda(s, admin, { ...base, title: 'Batal', agenda_date: '2026-11-30' });
    await setAgendaStatus(s, admin, batal.id, 'dibatalkan', 'Ditunda');
    await createAgenda(s, admin, { ...base, title: 'Bulan depan', agenda_date: '2026-12-01' }); // diarsipkan: tidak dihitung di mana pun
    db.prepare("UPDATE ppk_agendas SET archived_at = 't' WHERE title = 'Bulan depan'").run();

    invite('w1', 'baru'); invite('w22', 'diproses'); invite('u333', 'baru', { source: 'unggah' });
    invite('v4444', 'menunggu_verifikasi'); invite('g5', 'gagal');
    invite('k6', 'dikonversi', { verified_at: '2026-11-05T00:00:00Z' });
    invite('k7', 'dikonversi', { verified_at: '2026-10-31T16:59:00Z' }); // 31 Okt 23.59 WIB = bulan lalu
    invite('k8', 'dikonversi', { verified_at: '2026-10-31T17:00:00Z' }); // 1 Nov 00.00 WIB = bulan ini

    const h = await agendaHome(s, admin, TODAY);
    expect(h.counts).toEqual({ month_total: 4, today_total: 2, wa_incoming: 2, pending_verification: 1, pending_assignment: 3 });
    expect(h.inbox).toEqual({ baru: 2, menunggu_verifikasi: 1, gagal: 1, dikonversi_bulan_ini: 2 });
    expect(h.today_agendas.map((a) => a.title)).toEqual(['Pagi', 'Siang']); // urut jam mulai
    expect(h.upcoming.map((a) => a.title)).toEqual(['Besok', 'Minggu depan']);
    expect(h.awaiting_verification.map((i) => i.id)).toEqual(['v4444']);
    expect(h.unassigned.map((a) => a.title)).toEqual(['Pagi', 'Besok', 'Lewat 8 hari']);
    expect(h.needs_report.map((a) => a.id)).toEqual([lalu.id]);
    expect((await listAgendas(s, admin, {})).some((a) => a.title === 'Bulan depan')).toBe(false); // diarsipkan tidak tampil
  });

  it('pembaca boleh melihat, pengguna tanpa peran PPK ditolak', async () => {
    const c = createUser(db, admin, { name: 'Citra', role: 'operator', pin: '3333' });
    await expect(agendaHome(s, c as Actor, TODAY)).rejects.toThrow(/belum memiliki peran/);
    await expect(listInvitations(s, c as Actor)).rejects.toThrow(/belum memiliki peran/);
    await setPpkRole(s, admin, c.id, 'pembaca');
    expect((await agendaHome(s, c as Actor, TODAY)).counts.month_total).toBe(0);
  });

  it('tanggal hari ini memakai Asia/Jakarta', () => {
    expect(jakartaToday(new Date('2026-11-26T17:30:00Z'))).toBe('2026-11-27'); // 00.30 WIB
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('kalender', () => {
  it('bulan = minggu penuh Senin–Minggu, minggu dan hari, geser kursor', async () => {
    const { calendarDays, shiftCursor, agendaDisplay } = await import('@shared/ppk/agenda');
    const nov = calendarDays('bulan', '2026-11-27'); // 1 Nov 2026 = Minggu
    expect([nov[0], nov.at(-1), nov.length]).toEqual(['2026-10-26', '2026-12-06', 42]);
    expect(calendarDays('bulan', '2027-02-10').length % 7).toBe(0);
    expect(calendarDays('minggu', '2026-11-27')).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29']);
    expect(calendarDays('hari', '2026-11-27')).toEqual(['2026-11-27']);
    expect(shiftCursor('bulan', '2026-01-31', 1)).toBe('2026-02-01');
    expect(shiftCursor('bulan', '2026-01-15', -1)).toBe('2025-12-01');
    expect(shiftCursor('minggu', '2026-11-27', -1)).toBe('2026-11-20');
    expect(agendaDisplay({ status: 'terjadwal', archived_at: null, pic: null }).label).toBe('Belum ditugaskan');
    expect(agendaDisplay({ status: 'terjadwal', archived_at: null, pic: { id: 'x', name: 'B' } }).label).toBe('Ditugaskan');
  });
});

describe('rapat daring di beranda', () => {
  it('label tombol gabung dan status berlangsung/segera', async () => {
    const { joinLabel, liveState } = await import('@shared/ppk/agenda');
    expect(joinLabel('https://us02web.zoom.us/j/123')).toBe('Gabung Zoom');
    expect(joinLabel('https://teams.microsoft.com/l/meetup-join/x')).toBe('Gabung Teams');
    expect(joinLabel('https://meet.google.com/abc-defg-hij')).toBe('Gabung Google Meet');
    expect(joinLabel('https://webex.com/x')).toBe('Buka tautan rapat');
    const a = { agenda_date: TODAY, start_time: '09:00', end_time: '11:00', status: 'terjadwal' as const };
    expect(liveState(a, TODAY, '08:44')).toBe(null);
    expect(liveState(a, TODAY, '08:45')).toBe('segera');
    expect(liveState(a, TODAY, '09:00')).toBe('berlangsung');
    expect(liveState(a, TODAY, '10:59')).toBe('berlangsung');
    expect(liveState(a, TODAY, '11:00')).toBe(null);
    expect(liveState({ ...a, end_time: '' }, TODAY, '09:59')).toBe('berlangsung'); // tanpa jam selesai: dianggap 1 jam
    expect(liveState({ ...a, status: 'dibatalkan' }, TODAY, '09:30')).toBe(null);
    expect(liveState(a, addDays(TODAY, 1), '09:30')).toBe(null);
  });
});

describe('grid jam', () => {
  it('posisi dari jam mulai, lajur untuk jadwal beririsan, tanpa jam tidak masuk grid', async () => {
    const { layoutDay } = await import('@shared/ppk/agenda');
    const a = (start_time: string, end_time: string) => ({ agenda_date: TODAY, start_time, end_time });
    const r = layoutDay([a('10:00', '10:45'), a('09:00', '11:00'), a('', ''), a('13:00', ''), a('09:30', '09:40')], 7);
    expect(r.map((x) => [x.item.start_time, x.top, x.height, x.lane, x.lanes])).toEqual([
      ['09:00', 120, 120, 0, 2], ['09:30', 150, 30, 1, 2], ['10:00', 180, 45, 1, 2], ['13:00', 360, 60, 0, 1]]);
  });
});
