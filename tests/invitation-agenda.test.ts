import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { LATEST_SCHEMA, MIGRATIONS, runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { saveDocument } from '../electron/main/repo';
import { createUser, setPin } from '../electron/main/numbering/users';
import { sqliteStore, type PpkStore } from '../electron/main/ppk/store';
import { setPpkRole } from '../electron/main/ppk/access';
import { createAgenda, getAgenda, listAgendas, setAgendaStatus, updateAgenda, agendaPeople } from '../electron/main/ppk/agenda';
import { alreadyDelivered, deliveryHistory, listRecipients, logDelivery, saveRecipients } from '../electron/main/invitations';
import { applyWebhook, cloudSendDocument, webhookStatuses } from '../electron/main/whatsappCloud';
import { agendaFromInvitation, dayName, parseTimes, type AgendaInput } from '@shared/ppk/agenda';
import type { Actor } from '@shared/numbering';

let db: DB; let s: PpkStore; let admin: Actor; let docId: string;
beforeEach(() => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); s = sqliteStore(db);
  admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
  setPin(db, admin, admin.id, '123456');
  const tpl = db.prepare('SELECT id, name, content_json, layout_json FROM templates LIMIT 1').get() as { id: string; name: string; content_json: string; layout_json: string };
  docId = saveDocument(db, { template_id: null, template_name: tpl.name, category_id: null, title: 'Undangan Rapat', letter_number: 'UND-1', recipient: 'Kepala Dinas',
    subject: 'Rapat', doc_date: '2026-11-26', status: 'draft', content: JSON.parse(tpl.content_json), layout: JSON.parse(tpl.layout_json), header_text: '', footer_text: '',
    form_values: {}, use_kop: false }).id;
});

describe('migrasi v12–v13', () => {
  it('menambah tabel undangan dan agenda dari v11 tanpa mengubah data lama', () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 11)) old.exec(m.sql);
    old.pragma('user_version = 11');
    const before = (old.prepare('SELECT COUNT(*) n FROM ppk_funding_sources').get() as { n: number }).n;
    expect(runMigrations(old)).toBe(LATEST_SCHEMA);
    expect(LATEST_SCHEMA).toBe(13);
    for (const t of ['invitation_recipients', 'invitation_delivery_logs', 'ppk_agendas', 'ppk_agenda_assignees'])
      expect(old.prepare(`SELECT COUNT(*) n FROM ${t}`).get(), t).toEqual({ n: 0 });
    expect(old.prepare('SELECT COUNT(*) n FROM ppk_funding_sources').get()).toEqual({ n: before });
    old.close();
  });
});

describe('penerima dan riwayat pengiriman', () => {
  it('menyimpan nomor ternormalisasi, menolak nomor salah dan ganda', () => {
    const r = saveRecipients(db, admin, docId, [{ name: 'Kadis', organization: 'Dinas A', phone: '0812-3456-7890' }, { name: '', organization: '', phone: '' }]);
    expect(r.map((x) => x.phone)).toEqual(['6281234567890']);
    expect(() => saveRecipients(db, admin, docId, [{ name: 'X', organization: '', phone: '021-555' }])).toThrow(/tidak valid/);
    expect(() => saveRecipients(db, admin, docId, [{ name: 'A', organization: '', phone: '08123456789' }, { name: 'B', organization: '', phone: '+62 812 3456 789' }])).toThrow(/lebih dari sekali/);
    expect(listRecipients(db, docId)).toHaveLength(1); // gagal = daftar lama utuh
    expect(() => saveRecipients(db, admin, 'tidak-ada', [])).toThrow(/Simpan dokumen/);
  });

  it('riwayat append-only, click-to-chat tidak bisa berstatus terkirim, pencegah kirim ganda', () => {
    const base = { document_id: docId, recipient_name: 'Kadis', phone: '6281234567890', pdf_sha256: null, provider_message_id: null, error: null };
    expect(alreadyDelivered(db, docId, '6281234567890')).toBe(false);
    logDelivery(db, admin, { ...base, method: 'wa_desktop', status: 'whatsapp_opened' });
    expect(() => logDelivery(db, admin, { ...base, method: 'wa_web', status: 'sent' })).toThrow(/WhatsApp dibuka/);
    expect(alreadyDelivered(db, docId, '6281234567890')).toBe(true);
    expect(() => db.prepare("UPDATE invitation_delivery_logs SET status = 'read'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM invitation_delivery_logs').run()).toThrow(/append-only/);
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId); // riwayat tetap ada walau dokumen dihapus
    expect(deliveryHistory(db, docId)).toHaveLength(1);
    expect(listRecipients(db, docId)).toHaveLength(0);
  });
});

describe('WhatsApp Business API', () => {
  const cfg = { phone_number_id: '123', api_version: 'v21.0', token: 'rahasia' };
  type Call = { url: string; body: unknown; auth: string };
  const fake = (responses: Array<{ ok: boolean; status: number; json: unknown }>) => {
    const calls: Call[] = [];
    const f = async (url: string, init: { headers: Record<string, string>; body: string | FormData }) => {
      calls.push({ url, body: init.body, auth: init.headers.Authorization });
      const r = responses.shift()!;
      return { ok: r.ok, status: r.status, json: async () => r.json };
    };
    return { f, calls };
  };

  it('mengunggah PDF sebagai media (bukan URL publik) lalu mengirim dokumen; unggah diulang, kirim tidak', async () => {
    const { f, calls } = fake([{ ok: false, status: 500, json: { error: { message: 'sementara' } } }, { ok: true, status: 200, json: { id: 'MEDIA1' } },
      { ok: true, status: 200, json: { messages: [{ id: 'wamid.1' }] } }]);
    const r = await cloudSendDocument(cfg, f, { to: '6281234567890', pdf: Buffer.from('%PDF-1.4'), filename: 'undangan.pdf', caption: 'Yth.' });
    expect(r.message_id).toBe('wamid.1');
    expect(calls.map((c) => c.url)).toEqual(['https://graph.facebook.com/v21.0/123/media', 'https://graph.facebook.com/v21.0/123/media', 'https://graph.facebook.com/v21.0/123/messages']);
    expect(calls.every((c) => c.auth === 'Bearer rahasia')).toBe(true);
    expect(JSON.parse(calls[2].body as string)).toMatchObject({ to: '6281234567890', type: 'document', document: { id: 'MEDIA1', filename: 'undangan.pdf' } });

    const bad = fake([{ ok: true, status: 200, json: { id: 'M' } }, { ok: false, status: 400, json: { error: { code: 131047, message: 'Re-engagement message' } } }]);
    await expect(cloudSendDocument(cfg, bad.f, { to: '628', pdf: Buffer.from('x'), filename: 'a.pdf', caption: '' })).rejects.toThrow(/131047/);
    expect(bad.calls).toHaveLength(2); // pesan gagal tidak dikirim ulang otomatis
  });

  it('webhook status menambah riwayat sekali per status, hanya untuk pesan aplikasi ini', () => {
    logDelivery(db, admin, { document_id: docId, recipient_name: 'Kadis', phone: '6281234567890', method: 'cloud_api', status: 'submitted', pdf_sha256: null, provider_message_id: 'wamid.1', error: null });
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered' }, { id: 'wamid.1', status: 'read' }, { id: 'lain', status: 'read' }, { id: 'wamid.1', status: 'aneh' }] } }] }] };
    expect(webhookStatuses(payload)).toHaveLength(3);
    expect(applyWebhook(db, payload)).toBe(2);
    expect(applyWebhook(db, payload)).toBe(0);
    expect(deliveryHistory(db, docId).map((h) => h.status)).toEqual(['read', 'delivered', 'submitted']);
  });
});

describe('agenda PPK', () => {
  const input = (o: Partial<AgendaInput> = {}): AgendaInput => ({ title: 'Rapat Koordinasi', letter_number: 'UND-1', source_document_id: docId, agenda_date: '2026-12-07',
    start_time: '09:00', end_time: '12:00', location: 'Ruang Rapat', meeting_url: '', organizer: 'PPK 6', agenda_text: 'Evaluasi', notes: '', pic_user_id: null, support_user_ids: [], ...o });

  it('mengisi agenda dari surat undangan: tanggal, hari, jam, tautan rapat', () => {
    const a = agendaFromInvitation({ id: docId, title: 'Undangan', letter_number: 'UND-1', subject: '', doc_date: '2026-11-26', form_values: {
      PERIHAL: 'Rapat Koordinasi', TANGGAL_ACARA: 'Senin, 7 Desember 2026', WAKTU: '09.00 - 12.00 WIB', LOKASI: 'Ruang Rapat Lt. 2, https://us02web.zoom.us/j/123?pwd=x', AGENDA: 'Evaluasi' } }, 'PPK 6');
    expect(a).toMatchObject({ title: 'Rapat Koordinasi', agenda_date: '2026-12-07', start_time: '09:00', end_time: '12:00', location: 'Ruang Rapat Lt. 2', meeting_url: 'https://us02web.zoom.us/j/123?pwd=x', organizer: 'PPK 6' });
    expect(dayName('2026-12-07')).toBe('Senin');
    expect(parseTimes('pukul 9.30 s.d. selesai')).toEqual({ start: '09:30', end: '' });
  });

  it('penanggung jawab utama + pendukung, kunci versi, batal wajib alasan, tidak bisa dihapus', async () => {
    const andi = createUser(db, admin, { name: 'Andi Pratama', role: 'operator', pin: '1111' });
    const budi = createUser(db, admin, { name: 'Budi Santoso', role: 'operator', pin: '2222' });
    await setPpkRole(s, admin, andi.id, 'ppk'); await setPpkRole(s, admin, budi.id, 'staf');
    expect((await agendaPeople(s, admin)).map((p) => p.name)).toEqual(['Administrator', 'Andi Pratama', 'Budi Santoso']);
    const a = await createAgenda(s, admin, input({ pic_user_id: andi.id, support_user_ids: [budi.id, andi.id] }));
    expect(a.pic?.name).toBe('Andi Pratama');
    expect(a.support.map((x) => x.name)).toEqual(['Budi Santoso']); // PIC tidak dobel sebagai pendukung
    await expect(createAgenda(s, admin, input({ end_time: '08:00' }))).rejects.toThrow(/Jam selesai/);
    await expect(createAgenda(s, admin, input({ meeting_url: 'zoom.us/j/1' }))).rejects.toThrow(/https/);
    const u = await updateAgenda(s, admin, a.id, a.version, input({ title: 'Rapat Evaluasi', pic_user_id: budi.id }));
    expect([u.title, u.pic?.name, u.support.length]).toEqual(['Rapat Evaluasi', 'Budi Santoso', 0]);
    await expect(updateAgenda(s, admin, a.id, a.version, input())).rejects.toThrow(/pengguna lain/);
    await expect(setAgendaStatus(s, admin, a.id, 'dibatalkan', '')).rejects.toThrow(/Alasan/);
    await setAgendaStatus(s, admin, a.id, 'dibatalkan', 'Ditunda');
    expect((await getAgenda(s, admin, a.id)).status).toBe('dibatalkan');
    expect(await listAgendas(s, admin, {})).toHaveLength(0);
    expect(await listAgendas(s, admin, { include_cancelled: true })).toHaveLength(1);
    expect(() => db.prepare('DELETE FROM ppk_agendas').run()).toThrow(/tidak boleh dihapus/);
    // Pembaca tidak boleh membuat agenda.
    const c = createUser(db, admin, { name: 'Citra', role: 'operator', pin: '3333' }); await setPpkRole(s, admin, c.id, 'pembaca');
    await expect(createAgenda(s, { id: c.id, name: c.name, role: 'operator' }, input())).rejects.toThrow(/Peran Anda/);
    expect(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action LIKE 'ppk.agenda.%'").get()).toEqual({ n: 3 });
  });
});
