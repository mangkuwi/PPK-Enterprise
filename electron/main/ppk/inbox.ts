import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import type { InvitationDetail, InvitationFile, InvitationStatus } from '@shared/ppk/agenda';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';
import { text } from './validate';

export const MAX_FILE = 20 * 1024 * 1024;
const now = () => new Date().toISOString();

/** Jenis file dari isinya (bukan dari nama saja). PDF, DOC, DOCX, JPG/JPEG, PNG. */
export function fileKind(buf: Buffer, filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const head = (n: number) => buf.subarray(0, n).toString('hex');
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head(8) === '89504e470d0a1a0a') return 'image/png';
  if (head(3) === 'ffd8ff') return 'image/jpeg';
  if (head(4) === '504b0304' && ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (head(8) === 'd0cf11e0a1b11ae1' && ext === 'doc') return 'application/msword';
  throw new PpkError('INVALID', 'Jenis file tidak didukung. Gunakan PDF, DOC, DOCX, JPG, atau PNG.');
}

/** Unggah undangan manual: file asli disimpan utuh, undangan menunggu verifikasi staf. File yang sama persis ditandai duplikat. */
export async function uploadInvitation(s: PpkStore, actor: Actor, i: { filename: string; content: Buffer; note?: string }): Promise<{ id: string; duplicate_of: string | null }> {
  if (!i.content.length) throw new PpkError('INVALID', 'File kosong.');
  if (i.content.length > MAX_FILE) throw new PpkError('INVALID', 'Ukuran file maksimal 20 MB.');
  const mime = fileKind(i.content, i.filename);
  const filename = text(i.filename, 'Nama file', { required: true, max: 255 });
  const note = text(i.note, 'Catatan', { max: 2000 });
  const sha = createHash('sha256').update(i.content).digest('hex');
  const id = randomUUID(); const ts = now();
  let dup: string | null = null;
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    dup = (await t.get<{ owner_id: string }>("SELECT owner_id FROM ppk_files WHERE owner_type = 'undangan' AND sha256 = ? ORDER BY created_at LIMIT 1", [sha]))?.owner_id ?? null;
    await t.run(`INSERT INTO ppk_invitations (id, source, sender_name, received_at, message_text, status, duplicate_of, created_by, created_at, updated_by, updated_at)
      VALUES (?, 'unggah', ?, ?, ?, 'menunggu_verifikasi', ?, ?, ?, ?, ?)`, [id, actor.name, ts, note, dup, actor.name, ts, actor.name, ts]);
    await t.run(`INSERT INTO ppk_files (id, owner_type, owner_id, filename, mime_type, size_bytes, sha256, content, created_by, created_at)
      VALUES (?, 'undangan', ?, ?, ?, ?, ?, ?, ?, ?)`, [randomUUID(), id, filename, mime, i.content.length, sha, i.content, actor.name, ts]);
    await ppkAudit(t, actor, 'invitation.upload', 'ppk_invitations', id, { filename, size: i.content.length, sha256: sha, duplicate_of: dup });
  });
  return { id, duplicate_of: dup };
}

export async function invitationFiles(s: PpkStore, actor: Actor, invitationId: string): Promise<InvitationFile[]> {
  await requirePpk(s, actor, 'read');
  return s.all("SELECT id, filename, mime_type, size_bytes, created_at FROM ppk_files WHERE owner_type = 'undangan' AND owner_id = ? ORDER BY created_at", [invitationId]);
}

/** Isi file asli untuk dibuka. Tidak ada URL; isi hanya lewat proses utama. */
export async function fileContent(s: PpkStore, actor: Actor, fileId: string): Promise<{ filename: string; mime_type: string; content: Buffer }> {
  await requirePpk(s, actor, 'read');
  const f = await s.get<{ filename: string; mime_type: string; content: Buffer }>('SELECT filename, mime_type, content FROM ppk_files WHERE id = ?', [fileId]);
  if (!f) throw new PpkError('NOT_FOUND', 'File tidak ditemukan.');
  return f;
}

/** Detail satu pesan: teks asli, lampiran, agenda hasil, dan riwayat. */
export async function getInvitation(s: PpkStore, actor: Actor, id: string): Promise<InvitationDetail> {
  await requirePpk(s, actor, 'read');
  const i = await s.get<Omit<InvitationDetail, 'files' | 'agenda' | 'history' | 'file_count'>>(`SELECT id, source, sender_phone, sender_name, received_at, message_text, status, error_message,
    reject_reason, verified_by, verified_at, duplicate_of FROM ppk_invitations WHERE id = ?`, [id]);
  if (!i) throw new PpkError('NOT_FOUND', 'Pesan tidak ditemukan.');
  const files = await invitationFiles(s, actor, id);
  const agenda = (await s.get<{ id: string; title: string; agenda_date: string }>('SELECT id, title, agenda_date FROM ppk_agendas WHERE invitation_id = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1', [id])) ?? null;
  const history = (await s.all<{ at: string; actor_name: string; action: string; detail_json: string }>(
    "SELECT at, actor_name, action, detail_json FROM audit_log WHERE entity = 'ppk_invitations' AND entity_id = ? ORDER BY at", [id]))
    .map((r) => ({ at: r.at, actor_name: r.actor_name, action: r.action.replace(/^ppk\./, ''), detail: JSON.parse(r.detail_json) }));
  return { ...i, file_count: files.length, files, agenda, history };
}

const OPEN_STATUS: InvitationStatus[] = ['baru', 'diproses', 'menunggu_verifikasi', 'gagal'];
/**
 * "Tandai diproses" = selesai tanpa agenda (status ditolak, alasan wajib). "Arsipkan" = disembunyikan dari daftar kerja.
 * Pesan tidak pernah dihapus; status lama tercatat di audit.
 */
export async function markInvitation(s: PpkStore, actor: Actor, id: string, action: 'diproses' | 'arsip', reason: string): Promise<void> {
  const why = text(reason, 'Alasan', { required: action === 'diproses', max: 500 });
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const inv = await t.get<{ status: InvitationStatus }>('SELECT status FROM ppk_invitations WHERE id = ?', [id]);
    if (!inv) throw new PpkError('NOT_FOUND', 'Pesan tidak ditemukan.');
    if (action === 'diproses' && !OPEN_STATUS.includes(inv.status)) throw new PpkError('INVALID', 'Pesan ini sudah diproses atau diarsipkan.');
    if (action === 'arsip' && inv.status === 'diarsipkan') throw new PpkError('INVALID', 'Pesan ini sudah diarsipkan.');
    const after: InvitationStatus = action === 'diproses' ? 'ditolak' : 'diarsipkan';
    const ts = now();
    await t.run(`UPDATE ppk_invitations SET status = ?, ${after === 'ditolak' ? 'reject_reason = ?,' : ''} version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?`,
      [after, ...(after === 'ditolak' ? [why] : []), actor.name, ts, id]);
    await ppkAudit(t, actor, action === 'diproses' ? 'invitation.processed' : 'invitation.archive', 'ppk_invitations', id, { before: inv.status, after, reason: why });
  });
}
