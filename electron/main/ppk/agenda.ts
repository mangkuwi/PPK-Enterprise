import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { overlaps, type Agenda, type AgendaConflict, type AgendaFilter, type AgendaHistoryRow, type AgendaInput, type AgendaStatus } from '@shared/ppk/agenda';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { date, text } from './validate';

const now = () => new Date().toISOString();
const COLS = ['title', 'letter_number', 'source_document_id', 'agenda_date', 'start_time', 'end_time', 'location', 'meeting_url', 'organizer', 'agenda_text', 'notes', 'letter_date', 'program_id', 'participants'] as const;

function time(v: string, label: string): string {
  const t = (v ?? '').trim();
  if (t && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new PpkError('INVALID', `${label} harus berformat JJ:MM, mis. 09:00.`);
  return t;
}

function clean(i: AgendaInput) {
  const r = {
    title: text(i.title, 'Judul kegiatan', { required: true, max: 300 }), letter_number: text(i.letter_number, 'Nomor surat', { max: 200 }),
    source_document_id: i.source_document_id || null, agenda_date: date(i.agenda_date, 'Tanggal kegiatan')!,
    start_time: time(i.start_time, 'Jam mulai'), end_time: time(i.end_time, 'Jam selesai'),
    location: text(i.location, 'Lokasi', { max: 500 }), meeting_url: text(i.meeting_url, 'Tautan rapat daring', { max: 500 }),
    organizer: text(i.organizer, 'Penyelenggara', { max: 300 }), agenda_text: text(i.agenda_text, 'Agenda rapat', { max: 4000 }), notes: text(i.notes, 'Catatan', { max: 2000 }),
    letter_date: date(i.letter_date, 'Tanggal surat', false), program_id: i.program_id || null, participants: text(i.participants, 'Peserta', { max: 2000 })
  };
  if (r.start_time && r.end_time && r.end_time < r.start_time) throw new PpkError('INVALID', 'Jam selesai tidak boleh sebelum jam mulai.');
  if (r.meeting_url && !/^https:\/\/[^\s]+$/i.test(r.meeting_url)) throw new PpkError('INVALID', 'Tautan rapat daring harus diawali https://.');
  const support = [...new Set(i.support_user_ids ?? [])].filter((u) => u !== i.pic_user_id);
  return { r, pic: i.pic_user_id || null, support };
}

async function setAssignees(t: PpkStore, id: string, pic: string | null, support: string[]) {
  const ids = [...(pic ? [pic] : []), ...support];
  for (const u of ids) if (!(await t.get('SELECT 1 FROM app_users WHERE id = ? AND is_active = 1', [u]))) throw new PpkError('INVALID', 'Penanggung jawab atau staf pendukung tidak ditemukan atau nonaktif.');
  await t.run('DELETE FROM ppk_agenda_assignees WHERE agenda_id = ?', [id]);
  for (const u of ids) await t.run('INSERT INTO ppk_agenda_assignees (agenda_id, user_id, role) VALUES (?,?,?)', [id, u, u === pic ? 'utama' : 'pendukung']);
}

async function attach(s: PpkStore, rows: Array<Omit<Agenda, 'pic' | 'support'>>): Promise<Agenda[]> {
  if (!rows.length) return [];
  const a = await s.all<{ agenda_id: string; user_id: string; name: string; role: string }>(
    `SELECT x.agenda_id, x.user_id, u.name, x.role FROM ppk_agenda_assignees x JOIN app_users u ON u.id = x.user_id
      WHERE x.agenda_id IN (${rows.map(() => '?').join(',')}) ORDER BY u.name`, rows.map((r) => r.id));
  return rows.map((r) => {
    const mine = a.filter((x) => x.agenda_id === r.id);
    const p = mine.find((x) => x.role === 'utama');
    return { ...r, pic: p ? { id: p.user_id, name: p.name } : null, support: mine.filter((x) => x.role === 'pendukung').map((x) => ({ id: x.user_id, name: x.name })) };
  });
}

const PIC = "EXISTS (SELECT 1 FROM ppk_agenda_assignees x WHERE x.agenda_id = ppk_agendas.id AND x.role = 'utama')";
const STATUS_SQL: Record<string, string> = {
  aktif: "status <> 'dibatalkan' AND archived_at IS NULL",
  belum_ditugaskan: `status = 'terjadwal' AND archived_at IS NULL AND NOT ${PIC}`,
  ditugaskan: `status = 'terjadwal' AND archived_at IS NULL AND ${PIC}`,
  selesai: "status = 'selesai' AND archived_at IS NULL",
  dibatalkan: "status = 'dibatalkan' AND archived_at IS NULL",
  diarsipkan: 'archived_at IS NOT NULL'
};

/** Daftar agenda. Bawaan: tanpa yang dibatalkan dan diarsipkan (include_cancelled = semua). */
export async function listAgendas(s: PpkStore, actor: Actor, f: AgendaFilter & { include_cancelled?: boolean; ids?: string[] } = {}): Promise<Agenda[]> {
  await requirePpk(s, actor, 'read');
  const w: string[] = []; const p: string[] = [];
  if (f.from) { w.push('agenda_date >= ?'); p.push(f.from); }
  if (f.to) { w.push('agenda_date <= ?'); p.push(f.to); }
  if (f.ids) { if (!f.ids.length) return []; w.push(`id IN (${f.ids.map(() => '?').join(',')})`); p.push(...f.ids); }
  const status = f.status ?? (f.include_cancelled ? 'semua' : 'aktif');
  if (status !== 'semua') w.push(STATUS_SQL[status]);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().toLowerCase()}%`;
    w.push('(lower(title) LIKE ? OR lower(organizer) LIKE ? OR lower(letter_number) LIKE ? OR lower(location) LIKE ? OR lower(agenda_text) LIKE ?)'); p.push(like, like, like, like, like);
  }
  if (f.organizer?.trim()) { w.push('lower(organizer) LIKE ?'); p.push(`%${f.organizer.trim().toLowerCase()}%`); }
  if (f.program_id) { w.push('program_id = ?'); p.push(f.program_id); }
  if (f.user_id) { w.push('EXISTS (SELECT 1 FROM ppk_agenda_assignees y WHERE y.agenda_id = ppk_agendas.id AND y.user_id = ?)'); p.push(f.user_id); }
  return attach(s, await s.all(`SELECT * FROM ppk_agendas ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY agenda_date, start_time, title`, p));
}

export async function getAgenda(s: PpkStore, actor: Actor, id: string): Promise<Agenda> {
  await requirePpk(s, actor, 'read');
  const r = await s.get<Omit<Agenda, 'pic' | 'support'>>('SELECT * FROM ppk_agendas WHERE id = ?', [id]);
  if (!r) throw new PpkError('NOT_FOUND', 'Agenda tidak ditemukan.');
  return (await attach(s, [r]))[0];
}

/** Agenda baru. Tidak bergantung pada pengiriman WhatsApp. */
export async function createAgenda(s: PpkStore, actor: Actor, i: AgendaInput): Promise<Agenda> {
  const c = clean(i); const id = randomUUID(); const ts = now();
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    await t.run(`INSERT INTO ppk_agendas (id, ${COLS.join(', ')}, created_by, created_at, updated_by, updated_at) VALUES (?, ${COLS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
      [id, ...COLS.map((k) => c.r[k]), actor.name, ts, actor.name, ts]);
    await setAssignees(t, id, c.pic, c.support);
    if (i.invitation_id) await convertInvitation(t, actor, i.invitation_id, id, ts);
    await ppkAudit(t, actor, 'agenda.create', 'ppk_agendas', id, { after: { ...c.r, pic: c.pic, support: c.support, invitation_id: i.invitation_id ?? null } });
  });
  return getAgenda(s, actor, id);
}

export async function updateAgenda(s: PpkStore, actor: Actor, id: string, version: number, i: AgendaInput): Promise<Agenda> {
  const c = clean(i);
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const before = await t.get<Record<string, unknown>>('SELECT * FROM ppk_agendas WHERE id = ?', [id]);
    if (!before) throw new PpkError('NOT_FOUND', 'Agenda tidak ditemukan.');
    if (before.status === 'dibatalkan') throw new PpkError('INVALID', 'Agenda yang dibatalkan tidak dapat diubah.');
    const was = await t.all<{ user_id: string; role: string }>('SELECT user_id, role FROM ppk_agenda_assignees WHERE agenda_id = ?', [id]);
    const r = await t.run(`UPDATE ppk_agendas SET ${COLS.map((k) => `${k} = ?`).join(', ')}, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?`,
      [...COLS.map((k) => c.r[k]), actor.name, now(), id, version]);
    if (!r.changes) throw new PpkError('CONFLICT', 'Agenda sudah diubah pengguna lain. Muat ulang lalu ulangi.');
    await setAssignees(t, id, c.pic, c.support);
    await ppkAudit(t, actor, 'agenda.update', 'ppk_agendas', id, { before: { ...before, assignees: was }, after: { ...c.r, pic: c.pic, support: c.support } });
  });
  return getAgenda(s, actor, id);
}

export async function setAgendaStatus(s: PpkStore, actor: Actor, id: string, status: Exclude<AgendaStatus, 'terjadwal'>, reason: string): Promise<Agenda> {
  const why = text(reason, 'Alasan pembatalan', { required: status === 'dibatalkan', max: 500 });
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const b = await t.get<{ status: AgendaStatus }>('SELECT status FROM ppk_agendas WHERE id = ?', [id]);
    if (!b) throw new PpkError('NOT_FOUND', 'Agenda tidak ditemukan.');
    if (b.status !== 'terjadwal') throw new PpkError('INVALID', 'Hanya agenda terjadwal yang dapat diselesaikan atau dibatalkan.');
    await t.run('UPDATE ppk_agendas SET status = ?, cancel_reason = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?', [status, why, actor.name, now(), id]);
    await ppkAudit(t, actor, `agenda.${status}`, 'ppk_agendas', id, { before: b.status, after: status, reason: why });
  });
  return getAgenda(s, actor, id);
}

/** Pengguna yang dapat ditugaskan: aktif dan punya peran PPK (administrator aplikasi otomatis). */
export async function agendaPeople(s: PpkStore, actor: Actor): Promise<Array<{ id: string; name: string }>> {
  await requirePpk(s, actor, 'read');
  return s.all(`SELECT u.id, u.name FROM app_users u LEFT JOIN ppk_user_roles r ON r.user_id = u.id
    WHERE u.is_active = 1 AND (u.role = 'admin' OR r.role IS NOT NULL) ORDER BY u.name`);
}

/** Agenda dari undangan = verifikasi staf: undangan ditandai dikonversi, agenda menyimpan siapa dan kapan memverifikasi. */
async function convertInvitation(t: PpkStore, actor: Actor, invitationId: string, agendaId: string, ts: string) {
  const inv = await t.get<{ status: string }>('SELECT status FROM ppk_invitations WHERE id = ?', [invitationId]);
  if (!inv) throw new PpkError('NOT_FOUND', 'Undangan asal tidak ditemukan.');
  if (['ditolak', 'diarsipkan'].includes(inv.status)) throw new PpkError('INVALID', 'Undangan ini sudah ditolak atau diarsipkan.');
  await t.run("UPDATE ppk_invitations SET status = 'dikonversi', verified_by = ?, verified_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?", [actor.name, ts, actor.name, ts, invitationId]);
  await t.run('UPDATE ppk_agendas SET invitation_id = ?, verified_by = ?, verified_at = ? WHERE id = ?', [invitationId, actor.name, ts, agendaId]);
  await ppkAudit(t, actor, 'invitation.convert', 'ppk_invitations', invitationId, { before: inv.status, after: 'dikonversi', agenda_id: agendaId });
}

/** Arsipkan atau kembalikan dari arsip. Agenda tidak pernah dihapus. */
export async function setAgendaArchived(s: PpkStore, actor: Actor, id: string, archived: boolean): Promise<Agenda> {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const b = await t.get<{ archived_at: string | null }>('SELECT archived_at FROM ppk_agendas WHERE id = ?', [id]);
    if (!b) throw new PpkError('NOT_FOUND', 'Agenda tidak ditemukan.');
    if (!!b.archived_at === archived) return;
    await t.run('UPDATE ppk_agendas SET archived_at = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?', [archived ? now() : null, actor.name, now(), id]);
    await ppkAudit(t, actor, archived ? 'agenda.archive' : 'agenda.unarchive', 'ppk_agendas', id, { before: b.archived_at, after: archived });
  });
  return getAgenda(s, actor, id);
}

/** Agenda lain di hari yang sama yang jamnya beririsan, beserta staf yang tertugaskan di keduanya. */
export async function agendaConflicts(s: PpkStore, actor: Actor, q: { agenda_date: string; start_time: string; end_time: string; exclude_id?: string; user_ids?: string[] }): Promise<AgendaConflict[]> {
  const same = (await listAgendas(s, actor, { from: q.agenda_date, to: q.agenda_date })).filter((a) => a.id !== q.exclude_id && a.status === 'terjadwal' && overlaps(a, q));
  const mine = new Set(q.user_ids ?? []);
  return same.map((a) => ({ id: a.id, title: a.title, agenda_date: a.agenda_date, start_time: a.start_time, end_time: a.end_time,
    shared_staff: [...(a.pic ? [a.pic] : []), ...a.support].filter((u) => mine.has(u.id)).map((u) => u.name) }));
}

/** Riwayat perubahan agenda dari audit_log (append-only). */
export async function agendaHistory(s: PpkStore, actor: Actor, id: string): Promise<AgendaHistoryRow[]> {
  await requirePpk(s, actor, 'read');
  const rows = await s.all<{ at: string; actor_name: string; action: string; detail_json: string }>(
    "SELECT at, actor_name, action, detail_json FROM audit_log WHERE entity = 'ppk_agendas' AND entity_id = ? ORDER BY at", [id]);
  return rows.map((r) => ({ at: r.at, actor_name: r.actor_name, action: r.action.replace(/^ppk\./, ''), detail: JSON.parse(r.detail_json) }));
}
