import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { createUser, setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { setPpkRole } from '../electron/main/ppk/access';
import { agendaConflicts, agendaHistory, createAgenda, deleteAgenda, getAgenda, listAgendas, restoreAgenda, setAgendaArchived, setAgendaStatus, setAssignment, updateAgenda } from '../electron/main/ppk/agenda';
import { agendaHome } from '../electron/main/ppk/agendaHome';
import { agendaReports, fileContent, fileKind, getInvitation, invitationFiles, markInvitation, uploadInvitation, uploadReport } from '../electron/main/ppk/inbox';
import { invitationCounts, listInvitations } from '../electron/main/ppk/agendaHome';
import { overlaps, type AgendaInput } from '@shared/ppk/agenda';
import type { Actor } from '@shared/numbering';

const D = '2026-12-07';
const base: AgendaInput = { title: 'Rapat', letter_number: '', source_document_id: null, agenda_date: D, start_time: '', end_time: '', location: '',
  meeting_url: '', organizer: '', agenda_text: '', notes: '', pic_user_id: null, support_user_ids: [] };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
let db: DB; let s: PpkStore; let admin: Actor; let budi: Actor; let citra: Actor;

beforeEach(async () => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
  setPin(db, admin, admin.id, '123456');
  budi = createUser(db, admin, { name: 'Budi', role: 'operator', pin: '2222' }) as Actor; await setPpkRole(s, admin, budi.id, 'staf');
  citra = createUser(db, admin, { name: 'Citra', role: 'operator', pin: '3333' }) as Actor; await setPpkRole(s, admin, citra.id, 'pembaca');
});

describe('cari dan filter agenda', () => {
  it('kata kunci, penyelenggara, staf, program, status', async () => {
    const prog = (db.prepare('SELECT id FROM ppk_programs LIMIT 1').get() as { id: string } | undefined)?.id
      ?? (db.prepare("INSERT INTO ppk_programs (id, code, name, is_active, created_at, updated_at) VALUES ('p1','01','Program Uji',1,'t','t') RETURNING id").get() as { id: string }).id;
    const a = await createAgenda(s, admin, { ...base, title: 'Rapat Pengadaan Server', organizer: 'Biro Umum', pic_user_id: budi.id, program_id: prog, letter_date: '2026-12-01', participants: 'Kepala Bagian' });
    await createAgenda(s, admin, { ...base, title: 'Sosialisasi E-Katalog', organizer: 'LKPP', letter_number: 'UND-77' });
    const c = await createAgenda(s, admin, { ...base, title: 'Rapat Batal' }); await setAgendaStatus(s, admin, c.id, 'dibatalkan', 'Ditunda');
    const t = (f: Parameters<typeof listAgendas>[2]) => listAgendas(s, admin, f).then((r) => r.map((x) => x.title));
    expect(await t({ q: 'pengadaan' })).toEqual(['Rapat Pengadaan Server']);
    expect(await t({ q: 'und-77' })).toEqual(['Sosialisasi E-Katalog']);
    expect(await t({ organizer: 'lkpp' })).toEqual(['Sosialisasi E-Katalog']);
    expect(await t({ user_id: budi.id })).toEqual(['Rapat Pengadaan Server']);
    expect(await t({ program_id: prog })).toEqual(['Rapat Pengadaan Server']);
    expect(await t({ status: 'belum_ditugaskan' })).toEqual(['Sosialisasi E-Katalog']);
    expect(await t({ status: 'ditugaskan' })).toEqual(['Rapat Pengadaan Server']);
    expect(await t({ status: 'dibatalkan' })).toEqual(['Rapat Batal']);
    expect((await t({ status: 'semua' })).length).toBe(3);
    const got = await getAgenda(s, admin, a.id);
    expect([got.letter_date, got.program_id, got.participants]).toEqual(['2026-12-01', prog, 'Kepala Bagian']);
  });
});

describe('jadwal bentrok', () => {
  it('jam beririsan di hari yang sama, dengan staf yang sama disebut', async () => {
    expect(overlaps({ agenda_date: D, start_time: '09:00', end_time: '10:00' }, { agenda_date: D, start_time: '10:00', end_time: '11:00' })).toBe(false);
    expect(overlaps({ agenda_date: D, start_time: '09:00', end_time: '' }, { agenda_date: D, start_time: '09:30', end_time: '' })).toBe(true);
    expect(overlaps({ agenda_date: D, start_time: '', end_time: '' }, { agenda_date: D, start_time: '09:30', end_time: '' })).toBe(false);
    const x = await createAgenda(s, admin, { ...base, title: 'A', start_time: '09:00', end_time: '11:00', pic_user_id: budi.id });
    await createAgenda(s, admin, { ...base, title: 'B', start_time: '13:00', end_time: '14:00' });
    const c = await agendaConflicts(s, admin, { agenda_date: D, start_time: '10:30', end_time: '12:00', user_ids: [budi.id] });
    expect(c.map((r) => [r.title, r.shared_staff])).toEqual([['A', ['Budi']]]);
    expect(await agendaConflicts(s, admin, { agenda_date: D, start_time: '09:00', end_time: '10:00', exclude_id: x.id })).toEqual([]);
  });
});

describe('arsip dan riwayat', () => {
  it('arsip menyembunyikan agenda, riwayat mencatat setiap perubahan, pembaca tidak bisa mengarsipkan', async () => {
    const a = await createAgenda(s, admin, { ...base, title: 'Rapat X' });
    await updateAgenda(s, admin, a.id, a.version, { ...base, title: 'Rapat X (revisi)' });
    await expect(setAgendaArchived(s, citra, a.id, true)).rejects.toThrow(/tidak mengizinkan/);
    await setAgendaArchived(s, admin, a.id, true);
    expect(await listAgendas(s, admin, {})).toEqual([]);
    expect((await listAgendas(s, admin, { status: 'diarsipkan' })).map((r) => r.title)).toEqual(['Rapat X (revisi)']);
    await setAgendaArchived(s, admin, a.id, false);
    expect((await agendaHistory(s, citra, a.id)).map((h) => h.action)).toEqual(['agenda.create', 'agenda.update', 'agenda.archive', 'agenda.unarchive']);
  });
});

describe('unggah undangan manual', () => {
  it('jenis file dari isinya, bukan nama', () => {
    expect(fileKind(PDF, 'a.pdf')).toBe('application/pdf');
    expect(fileKind(Buffer.from('89504e470d0a1a0a00', 'hex'), 'x.png')).toBe('image/png');
    expect(fileKind(Buffer.from('ffd8ffe000', 'hex'), 'x.jpeg')).toBe('image/jpeg');
    expect(fileKind(Buffer.from('504b030414', 'hex'), 'u.docx')).toMatch(/wordprocessingml/);
    expect(fileKind(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'u.doc')).toBe('application/msword');
    expect(() => fileKind(Buffer.from('MZ\x90\x00'), 'virus.pdf')).toThrow(/tidak didukung/);
    expect(() => fileKind(Buffer.from('504b030414', 'hex'), 'arsip.zip')).toThrow(/tidak didukung/);
  });

  it('file asli tersimpan utuh, duplikat ditandai, agenda dari undangan = verifikasi', async () => {
    await expect(uploadInvitation(s, citra, { filename: 'u.pdf', content: PDF })).rejects.toThrow(/tidak mengizinkan/);
    await expect(uploadInvitation(s, budi, { filename: 'u.pdf', content: Buffer.alloc(0) })).rejects.toThrow(/kosong/);
    const u = await uploadInvitation(s, budi, { filename: 'Undangan Rapat.pdf', content: PDF, note: 'dari grup koordinasi' });
    expect(u.duplicate_of).toBe(null);
    expect((await uploadInvitation(s, budi, { filename: 'sama.pdf', content: PDF })).duplicate_of).toBe(u.id);
    const [f] = await invitationFiles(s, citra, u.id);
    expect(f).toMatchObject({ filename: 'Undangan Rapat.pdf', mime_type: 'application/pdf', size_bytes: PDF.length });
    expect((await fileContent(s, citra, f.id)).content.equals(PDF)).toBe(true);
    const inv = (await listInvitations(s, admin)).find((i) => i.id === u.id)!;
    expect([inv.status, inv.file_count, inv.source]).toEqual(['menunggu_verifikasi', 1, 'unggah']);

    const a = await createAgenda(s, budi, { ...base, title: 'Dari undangan', invitation_id: u.id });
    const got = await getAgenda(s, admin, a.id);
    expect([got.invitation_id, got.verified_by]).toEqual([u.id, 'Budi']);
    expect((await listInvitations(s, admin, { status: 'dikonversi' })).map((i) => i.id)).toEqual([u.id]);
    await expect(createAgenda(s, budi, { ...base, invitation_id: 'tidak-ada' })).rejects.toThrow(/tidak ditemukan/);
    expect(await listAgendas(s, admin, {})).toHaveLength(1); // gagal = tidak ada agenda setengah jadi
  });
});

describe('detail pesan Kotak Masuk', () => {
  it('kategori, detail lengkap, tandai diproses wajib alasan, arsip, riwayat', async () => {
    const u1 = await uploadInvitation(s, budi, { filename: 'a.pdf', content: PDF, note: 'Undangan A' });
    const u2 = await uploadInvitation(s, budi, { filename: 'b.pdf', content: Buffer.concat([PDF, Buffer.from('b')]) });
    const u3 = await uploadInvitation(s, budi, { filename: 'c.pdf', content: Buffer.concat([PDF, Buffer.from('c')]) });
    const ids = async (category: 'belum' | 'sudah' | 'arsip') => (await listInvitations(s, citra, { category })).map((i) => i.id).sort();
    expect(await ids('belum')).toEqual([u1.id, u2.id, u3.id].sort());

    await expect(markInvitation(s, citra, u1.id, 'diproses', 'bukan undangan')).rejects.toThrow(/tidak mengizinkan/);
    await expect(markInvitation(s, budi, u1.id, 'diproses', ' ')).rejects.toThrow(/Alasan wajib/);
    await markInvitation(s, budi, u1.id, 'diproses', 'bukan undangan');
    await expect(markInvitation(s, budi, u1.id, 'diproses', 'lagi')).rejects.toThrow(/sudah diproses/);
    await expect(createAgenda(s, budi, { ...base, invitation_id: u1.id })).rejects.toThrow(/ditolak atau diarsipkan/);
    await createAgenda(s, budi, { ...base, title: 'Dari B', invitation_id: u2.id });
    await markInvitation(s, budi, u3.id, 'arsip', '');
    await expect(markInvitation(s, budi, u3.id, 'arsip', '')).rejects.toThrow(/sudah diarsipkan/);
    expect([await ids('belum'), await ids('sudah'), await ids('arsip')]).toEqual([[], [u1.id, u2.id].sort(), [u3.id]]);
    expect(await invitationCounts(s, citra)).toEqual({ ditolak: 1, dikonversi: 1, diarsipkan: 1 });

    const d1 = await getInvitation(s, citra, u1.id);
    expect([d1.status, d1.reject_reason, d1.message_text, d1.files.map((f) => f.filename), d1.agenda]).toEqual(['ditolak', 'bukan undangan', 'Undangan A', ['a.pdf'], null]);
    expect(d1.history.map((h) => h.action)).toEqual(['invitation.upload', 'invitation.processed']);
    expect((await getInvitation(s, citra, u2.id)).agenda?.title).toBe('Dari B');
    await expect(getInvitation(s, citra, 'tidak-ada')).rejects.toThrow(/tidak ditemukan/);
  });
});

describe('penugasan dan laporan rapat', () => {
  it('tugas dan status per orang; orang sendiri boleh ubah statusnya; tetap ada saat agenda diubah', async () => {
    const a = await createAgenda(s, admin, { ...base, pic_user_id: budi.id, support_user_ids: [citra.id] });
    expect([a.pic?.status, a.support[0].status]).toEqual(['ditugaskan', 'ditugaskan']);
    await setAssignment(s, budi, a.id, budi.id, { duty: 'Siapkan paparan', status: 'diterima' });
    await setAssignment(s, citra, a.id, citra.id, { status: 'selesai' }); // pembaca: hanya status dirinya
    await expect(setAssignment(s, citra, a.id, budi.id, { status: 'selesai' })).rejects.toThrow(/tidak mengizinkan/);
    await expect(setAssignment(s, citra, a.id, citra.id, { duty: 'x', status: 'selesai' })).rejects.toThrow(/tidak mengizinkan/);
    await expect(setAssignment(s, budi, a.id, admin.id, { status: 'selesai' })).rejects.toThrow(/tidak ditugaskan/);
    const got = await getAgenda(s, admin, a.id);
    const u = await updateAgenda(s, admin, a.id, got.version, { ...base, title: 'Rapat diubah', pic_user_id: citra.id, support_user_ids: [budi.id] }); // tukar peran
    expect([u.pic, u.support]).toEqual([{ id: citra.id, name: 'Citra', duty: '', status: 'selesai' }, [{ id: budi.id, name: 'Budi', duty: 'Siapkan paparan', status: 'diterima' }]]);
    expect((await agendaHistory(s, admin, a.id)).filter((h) => h.action === 'agenda.assignment')).toHaveLength(2);
  });
  it('laporan rapat tersimpan utuh; agenda lewat tanpa laporan tampil di beranda', async () => {
    const a = await createAgenda(s, admin, { ...base, agenda_date: '2026-11-02' });
    await setAgendaStatus(s, admin, a.id, 'selesai', '');
    expect((await agendaHome(s, admin, '2026-11-05')).needs_report.map((x) => x.id)).toEqual([a.id]);
    await expect(uploadReport(s, citra, a.id, { filename: 'notulen.pdf', content: PDF })).rejects.toThrow(/tidak mengizinkan/);
    await uploadReport(s, budi, a.id, { filename: 'notulen.pdf', content: PDF });
    const [f] = await agendaReports(s, citra, a.id);
    expect((await fileContent(s, citra, f.id)).content.equals(PDF)).toBe(true);
    expect((await agendaHome(s, admin, '2026-11-05')).needs_report).toEqual([]);
    expect(() => db.prepare('DELETE FROM ppk_files').run()).toThrow();
  });
});

describe('hapus agenda (bisa dikembalikan)', () => {
  it('hilang dari daftar, beranda, dan cek bentrok; wajib alasan; hanya Admin/Pejabat PPK; bisa dikembalikan', async () => {
    const a = await createAgenda(s, admin, { ...base, title: 'Salah input', start_time: '09:00', end_time: '10:00' });
    await createAgenda(s, admin, { ...base, title: 'Rapat benar' });
    await expect(deleteAgenda(s, admin, a.id, '  ')).rejects.toThrow(/Alasan/);
    await expect(deleteAgenda(s, budi, a.id, 'dobel')).rejects.toThrow(/tidak mengizinkan/);
    const d = await deleteAgenda(s, admin, a.id, 'Dobel dengan undangan WA');
    expect([d.deleted_by, d.delete_reason]).toEqual([admin.name, 'Dobel dengan undangan WA']);
    const titles = async (f: Parameters<typeof listAgendas>[2]) => (await listAgendas(s, admin, f)).map((x) => x.title);
    expect(await titles({})).toEqual(['Rapat benar']);
    expect(await titles({ status: 'semua' })).toEqual(['Rapat benar']);
    expect(await titles({ status: 'terhapus' })).toEqual(['Salah input']);
    expect(await agendaConflicts(s, admin, { agenda_date: D, start_time: '09:30', end_time: '' })).toEqual([]);
    expect((await agendaHome(s, admin, D)).counts.today_total).toBe(1);
    await expect(updateAgenda(s, admin, a.id, d.version, { ...base, title: 'x' })).rejects.toThrow(/dihapus/);
    await expect(setAgendaStatus(s, admin, a.id, 'selesai', '')).rejects.toThrow(/dihapus/);
    expect(() => db.prepare('DELETE FROM ppk_agendas WHERE id = ?').run(a.id)).toThrow(); // baris tetap ada
    const r = await restoreAgenda(s, admin, a.id);
    expect(r.deleted_at).toBeNull();
    expect(await titles({})).toEqual(['Rapat benar', 'Salah input']);
    expect((await agendaHistory(s, admin, a.id)).map((h) => h.action)).toEqual(['agenda.create', 'agenda.delete', 'agenda.restore']);
  });
});
