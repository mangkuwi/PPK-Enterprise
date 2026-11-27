import type { Actor } from '@shared/numbering';
import type { AgendaHome, InvitationRow, InvitationStatus } from '@shared/ppk/agenda';
import { addDays, jakartaToday } from '@shared/date';
import type { PpkStore } from './store';
import { requirePpk } from './access';
import { listAgendas } from './agenda';

const OPEN = "a.status = 'terjadwal' AND a.archived_at IS NULL AND a.deleted_at IS NULL";
const NO_PIC = "NOT EXISTS (SELECT 1 FROM ppk_agenda_assignees x WHERE x.agenda_id = a.id AND x.role = 'utama')";
const n = async (s: PpkStore, sql: string, p: Array<string | number> = []) => Number((await s.get<{ n: number }>(sql, p))?.n ?? 0);

/** Undangan masuk, terbaru dulu. */
export async function listInvitations(s: PpkStore, actor: Actor, f: { status?: InvitationStatus; limit?: number } = {}): Promise<InvitationRow[]> {
  await requirePpk(s, actor, 'read');
  return s.all<InvitationRow>(`SELECT i.id, i.source, i.sender_phone, i.sender_name, i.received_at, i.message_text, i.status, i.error_message,
      (SELECT COUNT(*) FROM ppk_files f WHERE f.owner_type = 'undangan' AND f.owner_id = i.id) AS file_count
    FROM ppk_invitations i ${f.status ? 'WHERE i.status = ?' : ''} ORDER BY i.received_at DESC LIMIT ?`, [...(f.status ? [f.status] : []), f.limit ?? 200]);
}

/** Beranda Agenda PPK. `today` hanya diisi test; aplikasi memakai tanggal Asia/Jakarta. */
export async function agendaHome(s: PpkStore, actor: Actor, today = jakartaToday()): Promise<AgendaHome> {
  await requirePpk(s, actor, 'read');
  const month = today.slice(0, 7);
  const monthStartUtc = new Date(`${month}-01T00:00:00+07:00`).toISOString(); // verified_at disimpan UTC
  const pick = async (sql: string, p: string[]) => listAgendas(s, actor, { ids: (await s.all<{ id: string }>(sql, p)).map((r) => r.id) });
  const [counts, inbox] = await Promise.all([
    Promise.all([
      n(s, `SELECT COUNT(*) AS n FROM ppk_agendas a WHERE a.agenda_date >= ? AND a.agenda_date <= ? AND a.status <> 'dibatalkan' AND a.archived_at IS NULL AND a.deleted_at IS NULL`, [`${month}-01`, `${month}-31`]),
      n(s, `SELECT COUNT(*) AS n FROM ppk_agendas a WHERE a.agenda_date = ? AND a.status <> 'dibatalkan' AND a.archived_at IS NULL AND a.deleted_at IS NULL`, [today]),
      n(s, "SELECT COUNT(*) AS n FROM ppk_invitations WHERE source = 'whatsapp' AND status IN ('baru','diproses')"),
      n(s, "SELECT COUNT(*) AS n FROM ppk_invitations WHERE status = 'menunggu_verifikasi'"),
      n(s, `SELECT COUNT(*) AS n FROM ppk_agendas a WHERE ${OPEN} AND a.agenda_date >= ? AND ${NO_PIC}`, [today])
    ]),
    Promise.all([
      n(s, "SELECT COUNT(*) AS n FROM ppk_invitations WHERE status = 'baru'"),
      n(s, "SELECT COUNT(*) AS n FROM ppk_invitations WHERE status = 'menunggu_verifikasi'"),
      n(s, "SELECT COUNT(*) AS n FROM ppk_invitations WHERE status = 'gagal'"),
      n(s, "SELECT COUNT(*) AS n FROM ppk_invitations WHERE status = 'dikonversi' AND verified_at >= ?", [monthStartUtc])
    ])
  ]);
  return {
    today,
    counts: { month_total: counts[0], today_total: counts[1], wa_incoming: counts[2], pending_verification: counts[3], pending_assignment: counts[4] },
    inbox: { baru: inbox[0], menunggu_verifikasi: inbox[1], gagal: inbox[2], dikonversi_bulan_ini: inbox[3] },
    today_agendas: await listAgendas(s, actor, { from: today, to: today }),
    upcoming: await listAgendas(s, actor, { from: addDays(today, 1), to: addDays(today, 7) }),
    awaiting_verification: await listInvitations(s, actor, { status: 'menunggu_verifikasi', limit: 5 }),
    unassigned: await pick(`SELECT a.id FROM ppk_agendas a WHERE ${OPEN} AND a.agenda_date >= ? AND ${NO_PIC} ORDER BY a.agenda_date, a.start_time LIMIT 5`, [today]),
    // Kegiatan lewat yang belum ditutup: perlu ditandai selesai (laporan rapat menyusul di Fase 6).
    needs_report: await pick(`SELECT a.id FROM ppk_agendas a WHERE ${OPEN} AND a.agenda_date < ? ORDER BY a.agenda_date DESC LIMIT 5`, [today])
  };
}
