import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import type { Agenda, AgendaInput, AgendaStatus } from '@shared/ppk/agenda';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { date, text } from './validate';

const now = () => new Date().toISOString();
const COLS = ['title', 'letter_number', 'source_document_id', 'agenda_date', 'start_time', 'end_time', 'location', 'meeting_url', 'organizer', 'agenda_text', 'notes'] as const;

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
    organizer: text(i.organizer, 'Penyelenggara', { max: 300 }), agenda_text: text(i.agenda_text, 'Agenda rapat', { max: 4000 }), notes: text(i.notes, 'Catatan', { max: 2000 })
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

export async function listAgendas(s: PpkStore, actor: Actor, f: { from?: string; to?: string; include_cancelled?: boolean } = {}): Promise<Agenda[]> {
  await requirePpk(s, actor, 'read');
  const w: string[] = []; const p: string[] = [];
  if (f.from) { w.push('agenda_date >= ?'); p.push(f.from); }
  if (f.to) { w.push('agenda_date <= ?'); p.push(f.to); }
  if (!f.include_cancelled) w.push("status <> 'dibatalkan'");
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
    await ppkAudit(t, actor, 'agenda.create', 'ppk_agendas', id, { after: { ...c.r, pic: c.pic, support: c.support } });
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
