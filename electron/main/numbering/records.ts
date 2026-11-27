import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { Actor, AvailableQuery, BatchPreview, MigrationReview, NextInfo, NumberBatch, NumberEvent, NumberRecord, RecordPage, RecordQuery, Register, RegisterSummary, NumberStatus } from '@shared/numbering';
import { STATUS_LABEL, maxSeqFor, normalizeNumberText, parseNumber, renderNumber } from '@shared/numbering';
import { NumberingError } from './errors';
import { requireAdmin } from './users';
import { audit } from './audit';
import { clock, nowIso } from './clock';
import { getRegister, listRegisters } from './registers';
import { allocateSeq, bumpCounter, documentYear, limitMessage, planSeqs, suggestNext } from './engine';

const SELECT = `SELECT n.*, r.code register_code, d.title document_title, (SELECT COUNT(*) FROM number_events e WHERE e.record_id=n.id AND e.event='released') released_count FROM number_records n
  JOIN number_registers r ON r.id=n.register_id LEFT JOIN documents d ON d.id=n.document_id`;

export function toRecord(r: any): NumberRecord {
  return {
    id: r.id, register_id: r.register_id, register_code: r.register_code, year: r.year, seq: r.seq ?? r.legacy_seq ?? null, day: r.day, seq_scheme: r.seq_scheme, number_text: r.number_text, status: r.status,
    number_date: r.number_date, subject: r.subject, counterparty: r.counterparty, notes: r.notes, creator: r.creator, creator_id: r.creator_id,
    document_id: r.document_id, document_title: r.document_title ?? null, source: r.source, import_id: r.import_id,
    batch_id: r.batch_id ?? null, generated_at: r.generated_at, generated_by: r.generated_by, assigned_at: r.assigned_at, assigned_by: r.assigned_by,
    issued_at: r.issued_at, issued_by: r.issued_by, voided_at: r.voided_at, voided_by: r.voided_by, void_reason: r.void_reason,
    legacy_review: !!r.legacy_review, released_count: r.released_count ?? 0, created_at: r.created_at, updated_at: r.updated_at
  };
}
export function getRecord(db: DB, id: string): NumberRecord {
  const r = db.prepare(`${SELECT} WHERE n.id=?`).get(id);
  if (!r) throw new NumberingError('NOT_FOUND', 'Catatan nomor tidak ditemukan.');
  return toRecord(r);
}
export function recordForDocument(db: DB, documentId: string, registerId?: string): NumberRecord | null {
  const r = db.prepare(`${SELECT} WHERE n.document_id=? AND n.status IN ('assigned','issued') ${registerId ? 'AND n.register_id=?' : ''} ORDER BY n.created_at DESC LIMIT 1`).get(...(registerId ? [documentId, registerId] : [documentId]));
  return r ? toRecord(r) : null;
}

function event(db: DB, rec: { id: string; register_id: string }, actor: Actor | null, ev: string, detail: Record<string, unknown> = {}) {
  db.prepare('INSERT INTO number_events (id, record_id, register_id, event, actor_id, actor_name, at, detail_json) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), rec.id, rec.register_id, ev, actor?.id ?? null, actor?.name ?? 'Sistem', nowIso(), JSON.stringify(detail));
}
export function recordEvents(db: DB, recordId: string): NumberEvent[] {
  return (db.prepare('SELECT * FROM number_events WHERE record_id=? ORDER BY at, rowid').all(recordId) as any[])
    .map((e) => ({ id: e.id, record_id: e.record_id, register_id: e.register_id, event: e.event, actor_id: e.actor_id, actor_name: e.actor_name, at: e.at, detail: JSON.parse(e.detail_json) }));
}

/** Penugasan dapat diubah oleh pemilihnya atau administrator. */
const canTouch = (a: Actor, r: { assigned_by: string | null }) => a.role === 'admin' || r.assigned_by === a.name;
const clip = (s: string | undefined, n: number) => (s ?? '').trim().slice(0, n);

export interface ReserveInput { register_id: string; number_date: string; subject?: string; counterparty?: string; notes?: string; creator?: string; document_id?: string | null }

export const MAX_BATCH = 500;

/** Pratinjau nomor yang akan dibuat (tidak menulis apa pun). */
export function previewBatch(db: DB, registerId: string, date: string, quantity: number): BatchPreview {
  const reg = getRegister(db, registerId);
  if (!reg.is_active) throw new NumberingError('STATE', `Register ${reg.name} dinonaktifkan.`);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BATCH) throw new NumberingError('INVALID', `Jumlah nomor harus 1–${MAX_BATCH}.`);
  const info = suggestNext(db, registerId, date, reg);
  const plan = planSeqs(db, reg, date, quantity);
  return {
    register_id: registerId, date, quantity, numbers: plan.map((p) => p.text), first: plan[0].text, last: plan[plan.length - 1].text, first_seq: plan[0].seq, last_seq: plan[plan.length - 1].seq,
    limit: info.limit, remaining: info.remaining, format_label: info.format_label, max_quantity: Math.min(MAX_BATCH, info.remaining)
  };
}

/**
 * Membuat nomor massal (status AVAILABLE) dalam SATU transaksi: semua terdaftar atau tidak sama sekali.
 * `expect_first/expect_last` (dari pratinjau yang dikonfirmasi pengguna) mencegah pendaftaran bila keadaan berubah setelah pratinjau.
 */
export function generateBatch(db: DB, actor: Actor, i: { register_id: string; number_date: string; quantity: number; expect_first?: string; expect_last?: string; note?: string }): { batch: NumberBatch; records: NumberRecord[] } {
  const reg = getRegister(db, i.register_id);
  if (!reg.is_active) throw new NumberingError('STATE', `Register ${reg.name} dinonaktifkan.`);
  if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > MAX_BATCH) throw new NumberingError('INVALID', `Jumlah nomor harus 1–${MAX_BATCH}.`);
  const year = documentYear(i.number_date);
  const attempt = () => db.transaction(() => {
    const plan = planSeqs(db, reg, i.number_date, i.quantity);
    if ((i.expect_first && i.expect_first !== plan[0].text) || (i.expect_last && i.expect_last !== plan[plan.length - 1].text)) {
      throw new NumberingError('COLLISION', `Pratinjau sudah tidak berlaku (nomor yang tersedia berubah: kini ${plan[0].text}–${plan[plan.length - 1].text}). Buat pratinjau ulang.`);
    }
    const bid = randomUUID(); const ts = nowIso();
    db.prepare('INSERT INTO number_batches (id, register_id, number_date, quantity, first_number, last_number, created_by, created_by_name, created_at, note) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(bid, reg.id, i.number_date, plan.length, plan[0].text, plan[plan.length - 1].text, actor.id, actor.name, ts, clip(i.note, 300));
    const ins = db.prepare(`INSERT INTO number_records (id, register_id, year, day, seq, seq_scheme, number_text, status, number_date, creator, creator_id, source, batch_id, generated_at, generated_by, created_at, updated_at)
      VALUES (?,?,?,?,?,'daily',?,'available',?,?,?,'app',?,?,?,?,?)`);
    const ids: string[] = [];
    for (const p of plan) {
      const id = randomUUID(); ids.push(id);
      ins.run(id, reg.id, year, i.number_date.slice(8, 10), p.seq, p.text, i.number_date, actor.name, actor.id, bid, ts, actor.name, ts, ts);
      event(db, { id, register_id: reg.id }, actor, 'generated', { number: p.text, batch_id: bid });
    }
    bumpCounter(db, reg.id, i.number_date, plan[plan.length - 1].seq + 1);
    audit(db, actor, 'number.batch', 'batch', bid, { register: reg.code, date: i.number_date, quantity: plan.length, first: plan[0].text, last: plan[plan.length - 1].text });
    const batch: NumberBatch = { id: bid, register_id: reg.id, number_date: i.number_date, quantity: plan.length, first_number: plan[0].text, last_number: plan[plan.length - 1].text, created_by_name: actor.name, created_at: ts, note: clip(i.note, 300) };
    return { batch, records: ids.map((id) => getRecord(db, id)) };
  }).immediate();
  // Penulis lain pada berkas yang sama dapat memenangkan nomor yang sama; UNIQUE menolak dan seluruh batch diulang dari awal.
  for (let n = 1; ; n++) {
    try { return attempt(); } catch (e) {
      if (/UNIQUE/i.test(String(e)) && n < 5) continue;
      if (/UNIQUE/i.test(String(e))) throw new NumberingError('COLLISION', 'Nomor bentrok dengan penulis lain berulang kali. Coba lagi.');
      throw e;
    }
  }
}
export function listBatches(db: DB, registerId: string, limit = 50): NumberBatch[] {
  return db.prepare('SELECT id, register_id, number_date, quantity, first_number, last_number, created_by_name, created_at, note FROM number_batches WHERE register_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?').all(registerId, limit) as NumberBatch[];
}

/** Mencatat nomor yang sudah dipakai di luar aplikasi (langsung ISSUED, sumber 'manual'). seq opsional (hanya admin). */
export function createManual(db: DB, actor: Actor, i: ReserveInput & { seq?: number; number_text?: string }): NumberRecord {
  const reg = getRegister(db, i.register_id);
  const year = documentYear(i.number_date);
  if (i.seq != null || i.number_text) requireAdmin(actor);
  const limit = maxSeqFor(reg.seq_length);
  return db.transaction(() => {
    let seq: number | null; let text: string; let scheme: 'daily' | 'legacy' = 'daily'; let legacy: number | null = null;
    if (i.number_text) {
      text = normalizeNumberText(i.number_text);
      const p = parseNumber(reg, text);
      if (p?.year != null && p.year !== year) throw new NumberingError('DATE_MISMATCH', `Tahun pada nomor (${p.year}) berbeda dengan tahun tanggal penomoran (${year}).`);
      const dayOk = p != null && p.day === Number(i.number_date.slice(8, 10));
      if (p && dayOk) seq = p.seq;
      else { seq = null; scheme = 'legacy'; legacy = p?.seq ?? i.seq ?? null; } // format/hari tidak cocok: dicatat apa adanya, tidak memengaruhi urutan harian
    } else if (i.seq != null) {
      if (!Number.isInteger(i.seq) || i.seq < 1) throw new NumberingError('INVALID', 'Nomor urut tidak valid.');
      if (i.seq > limit) throw new NumberingError('LIMIT', limitMessage(reg, i.number_date));
      seq = i.seq; text = renderNumber(reg, seq, i.number_date);
    } else { const a = allocateSeq(db, reg, i.number_date); seq = a.seq; text = a.text; }
    if (seq != null && seq > limit) throw new NumberingError('LIMIT', limitMessage(reg, i.number_date));
    const id = randomUUID(); const ts = nowIso();
    try {
      db.prepare(`INSERT INTO number_records (id, register_id, year, day, seq, seq_scheme, legacy_seq, number_text, status, number_date, subject, counterparty, notes, creator, creator_id, document_id, source,
        issued_at, issued_by, generated_at, generated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'issued',?,?,?,?,?,?,?, 'manual', ?,?,?,?,?,?)`)
        .run(id, reg.id, year, i.number_date.slice(8, 10), seq, scheme, legacy, text, i.number_date, clip(i.subject, 500), clip(i.counterparty, 300), clip(i.notes, 1000), clip(i.creator, 120) || actor.name, actor.id, i.document_id ?? null, ts, actor.name, ts, actor.name, ts, ts);
    } catch (e) {
      if (/UNIQUE/i.test(String(e))) throw new NumberingError('COLLISION', `Nomor ${text} pada tanggal ${i.number_date} sudah ada di register ${reg.name}.`);
      throw e;
    }
    if (seq != null) bumpCounter(db, reg.id, i.number_date, seq + 1);
    const rec = getRecord(db, id);
    event(db, rec, actor, 'created_manual', { number: text, scheme });
    audit(db, actor, 'number.manual', 'number', id, { register: reg.code, number: text, date: i.number_date });
    return rec;
  }).immediate();
}
export { bumpCounter };

/** Memilih nomor AVAILABLE untuk sebuah draf. Satu pernyataan UPDATE bersyarat: hanya satu pemanggil yang menang bila dua pengguna memilih nomor yang sama. */
export function assignNumber(db: DB, actor: Actor, id: string, opts: { document_id?: string | null } = {}): NumberRecord {
  return db.transaction(() => {
    const r = getRecord(db, id);
    if (opts.document_id) {
      const ex = recordForDocument(db, opts.document_id, r.register_id);
      if (ex && ex.id !== id) throw new NumberingError('STATE', `Dokumen ini sudah memiliki nomor ${ex.number_text} (${STATUS_LABEL[ex.status]}).`);
    }
    if (r.legacy_review) throw new NumberingError('STATE', `Nomor ${r.number_text} berasal dari migrasi dan belum ditinjau administrator; belum dapat dipilih.`);
    const ts = nowIso();
    const ch = db.prepare("UPDATE number_records SET status='assigned', assigned_at=?, assigned_by=?, document_id=?, updated_at=? WHERE id=? AND status='available' AND legacy_review=0")
      .run(ts, actor.name, opts.document_id ?? null, ts, id).changes;
    if (ch !== 1) {
      const cur = getRecord(db, id);
      throw new NumberingError('STATE', cur.status === 'available' ? `Nomor ${cur.number_text} tidak dapat dipilih.` : `Nomor ${cur.number_text} tidak tersedia (status: ${STATUS_LABEL[cur.status]}). Pilih nomor lain.`);
    }
    event(db, r, actor, 'assigned', { document_id: opts.document_id ?? null });
    return getRecord(db, id);
  }).immediate();
}

/** Melepas nomor dari draf (draf dibatalkan/dihapus/ganti nomor): kembali AVAILABLE, tautan draf dihapus, catatan dan riwayat tetap. */
export function releaseNumber(db: DB, actor: Actor | null, id: string, reason: string): NumberRecord {
  return db.transaction(() => {
    const r = getRecord(db, id);
    if (r.status === 'available') return r;
    if (r.status !== 'assigned') throw new NumberingError('STATE', `Nomor ${r.number_text} berstatus ${STATUS_LABEL[r.status]} dan tidak dapat dilepas.`);
    if (actor && !canTouch(actor, r)) throw new NumberingError('FORBIDDEN', 'Hanya pengguna yang memilih nomor ini atau administrator yang dapat melepasnya.');
    const ts = nowIso();
    db.prepare("UPDATE number_records SET status='available', assigned_at=NULL, assigned_by=NULL, document_id=NULL, updated_at=? WHERE id=? AND status='assigned'").run(ts, id);
    event(db, r, actor, 'released', { reason: reason.trim() || 'dilepas', document_id: r.document_id, by: r.assigned_by });
    audit(db, actor, 'number.release', 'number', id, { number: r.number_text, reason: reason.trim() || 'dilepas', document_id: r.document_id });
    return getRecord(db, id);
  }).immediate();
}

/** Dokumen final → nomor terbit. Hanya dari ASSIGNED; nomor terbit tidak dapat dilepas/di-void/dipakai ulang. */
export function issueNumber(db: DB, actor: Actor, id: string, opts: { document_id?: string | null } = {}): NumberRecord {
  return db.transaction(() => {
    const r = getRecord(db, id);
    if (r.status === 'issued') return r;
    if (r.status !== 'assigned') throw new NumberingError('STATE', `Nomor ${r.number_text} berstatus ${STATUS_LABEL[r.status]} dan tidak dapat diterbitkan. Pilih nomor dari bank terlebih dahulu.`);
    const viaDocument = !!opts.document_id && r.document_id === opts.document_id; // jalur finalisasi dokumen
    if (!viaDocument && !canTouch(actor, r)) throw new NumberingError('FORBIDDEN', 'Hanya pengguna yang memilih nomor ini atau administrator yang dapat menerbitkannya.');
    const ts = nowIso();
    db.prepare("UPDATE number_records SET status='issued', issued_at=?, issued_by=?, document_id=COALESCE(?, document_id), updated_at=? WHERE id=? AND status='assigned'")
      .run(ts, actor.name, opts.document_id ?? null, ts, id);
    event(db, r, actor, 'issued', { document_id: opts.document_id ?? r.document_id });
    return getRecord(db, id);
  }).immediate();
}

/** VOID: hanya administrator, hanya nomor AVAILABLE, wajib konfirmasi + alasan. Catatan dipertahankan selamanya dan nomor tidak dipakai ulang. */
export function voidNumber(db: DB, actor: Actor, id: string, reason: string, confirm: boolean): NumberRecord {
  requireAdmin(actor);
  const why = reason.trim();
  if (why.length < 3) throw new NumberingError('INVALID', 'Alasan void wajib diisi (minimal 3 karakter).');
  if (!confirm) throw new NumberingError('NEEDS_CONFIRMATION', 'Void nomor bersifat permanen dan nomor tidak akan dipakai ulang. Konfirmasi diperlukan.');
  return db.transaction(() => {
    const r = getRecord(db, id);
    if (r.status === 'void') return r;
    if (r.status === 'issued') throw new NumberingError('STATE', `Nomor ${r.number_text} sudah terbit dan tidak dapat di-void.`);
    if (r.status === 'assigned') throw new NumberingError('STATE', `Nomor ${r.number_text} sedang dipakai draf. Lepaskan dari draf lebih dulu, baru di-void.`);
    const ts = nowIso();
    db.prepare("UPDATE number_records SET status='void', voided_at=?, voided_by=?, void_reason=?, legacy_review=0, updated_at=? WHERE id=? AND status='available'").run(ts, actor.name, why, ts, id);
    event(db, r, actor, 'voided', { reason: why });
    audit(db, actor, 'number.void', 'number', id, { number: r.number_text, reason: why });
    return getRecord(db, id);
  }).immediate();
}

/** Administrator meninjau catatan hasil migrasi yang statusnya tidak dapat dipastikan (dipesan tanpa dokumen). */
export function migrationReview(db: DB, actor: Actor): MigrationReview {
  requireAdmin(actor);
  const c = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const pending = (db.prepare(`${SELECT} WHERE n.legacy_review=1 ORDER BY n.number_date, COALESCE(n.seq, n.legacy_seq)`).all() as any[]).map(toRecord);
  return {
    counts: { issued: c("SELECT COUNT(*) n FROM number_records WHERE status='issued'"), void: c("SELECT COUNT(*) n FROM number_records WHERE status='void'"),
      assigned_with_document: c("SELECT COUNT(*) n FROM number_records WHERE status='assigned' AND document_id IS NOT NULL"), pending_review: pending.length },
    pending
  };
}
/** Keputusan administrator atas catatan migrasi: jadikan tersedia (dengan alasan) atau void. */
export function resolveLegacy(db: DB, actor: Actor, ids: string[], action: 'release' | 'void', reason: string): number {
  requireAdmin(actor);
  const why = reason.trim();
  if (why.length < 3) throw new NumberingError('INVALID', 'Alasan peninjauan wajib diisi.');
  return db.transaction(() => {
    let n = 0;
    for (const id of ids) {
      const r = getRecord(db, id);
      if (!r.legacy_review) continue;
      const ts = nowIso();
      if (action === 'release') { db.prepare('UPDATE number_records SET legacy_review=0, updated_at=? WHERE id=?').run(ts, id); event(db, r, actor, 'review_released', { reason: why }); }
      else { db.prepare("UPDATE number_records SET status='void', legacy_review=0, voided_at=?, voided_by=?, void_reason=?, updated_at=? WHERE id=? AND status='available'").run(ts, actor.name, `Hasil tinjauan migrasi: ${why}`, ts, id); event(db, r, actor, 'voided', { reason: why, via: 'migration_review' }); }
      n++;
    }
    audit(db, actor, 'number.migration_review', 'number', null, { action, count: n, reason: why });
    return n;
  })();
}

export function updateMeta(db: DB, actor: Actor, id: string, p: { subject?: string; counterparty?: string; notes?: string; creator?: string }): NumberRecord {
  return db.transaction(() => {
    const r = getRecord(db, id);
    if (r.status === 'void') throw new NumberingError('STATE', 'Catatan void tidak dapat diubah.');
    if (actor.role !== 'admin' && r.creator_id !== actor.id && r.assigned_by !== actor.name) throw new NumberingError('FORBIDDEN', 'Anda tidak berwenang mengubah catatan ini.');
    if (p.creator !== undefined && actor.role !== 'admin') throw new NumberingError('FORBIDDEN', 'Hanya administrator yang dapat mengubah nama pembuat.');
    const n = { subject: clip(p.subject ?? r.subject, 500), counterparty: clip(p.counterparty ?? r.counterparty, 300), notes: clip(p.notes ?? r.notes, 1000), creator: clip(p.creator ?? r.creator, 120) };
    const before = { subject: r.subject, counterparty: r.counterparty, notes: r.notes, creator: r.creator };
    if (JSON.stringify(before) === JSON.stringify(n)) return r;
    db.prepare('UPDATE number_records SET subject=?, counterparty=?, notes=?, creator=?, updated_at=? WHERE id=?').run(n.subject, n.counterparty, n.notes, n.creator, nowIso(), id);
    event(db, r, actor, 'edited', { before, after: n });
    return getRecord(db, id);
  })();
}

export function linkDocument(db: DB, actor: Actor | null, recordId: string, documentId: string | null) {
  const r = getRecord(db, recordId);
  if (documentId) {
    const other = db.prepare("SELECT id FROM number_records WHERE document_id=? AND register_id=? AND status IN ('assigned','issued') AND id!=?").get(documentId, r.register_id, recordId);
    if (other) throw new NumberingError('LINKED', 'Dokumen ini sudah terhubung ke nomor lain pada register yang sama.');
  }
  db.prepare('UPDATE number_records SET document_id=?, updated_at=? WHERE id=?').run(documentId, nowIso(), recordId);
  event(db, r, actor, documentId ? 'linked' : 'unlinked', { document_id: documentId });
}

// ---------- rujukan nomor yang sudah terbit (mis. nomor kontrak di dalam BA) ----------
export function addRef(db: DB, documentId: string, recordId: string, key: string) {
  const r = getRecord(db, recordId);
  if (r.status === 'void' || r.status === 'available') throw new NumberingError('STATE', 'Hanya nomor yang sudah dipakai (terbit/dipakai draf) yang dapat dirujuk.');
  db.prepare('INSERT OR IGNORE INTO document_number_refs (id, document_id, record_id, placeholder_key, created_at) VALUES (?,?,?,?,?)').run(randomUUID(), documentId, recordId, key, nowIso());
}
export function clearRefs(db: DB, documentId: string) { db.prepare('DELETE FROM document_number_refs WHERE document_id=?').run(documentId); }
export function refsForDocument(db: DB, documentId: string): Array<{ key: string; record: NumberRecord }> {
  return (db.prepare('SELECT placeholder_key k, record_id FROM document_number_refs WHERE document_id=?').all(documentId) as any[]).map((x) => ({ key: x.k, record: getRecord(db, x.record_id) }));
}
export function documentsReferencing(db: DB, recordId: string): Array<{ document_id: string; title: string; key: string }> {
  return db.prepare('SELECT d.id document_id, d.title, x.placeholder_key key FROM document_number_refs x JOIN documents d ON d.id=x.document_id WHERE x.record_id=?').all(recordId) as any[];
}
/** Nomor terbit/dipakai draf yang dapat dirujuk, untuk pemilih rujukan lintas register. */
export function searchReferenceable(db: DB, registerId: string, q: string, limit = 20): NumberRecord[] {
  const like = `%${q.trim()}%`;
  return (db.prepare(`${SELECT} WHERE n.register_id=? AND n.status IN ('issued','assigned') AND (n.number_text LIKE ? OR n.subject LIKE ? OR n.counterparty LIKE ?) ORDER BY n.number_date DESC, COALESCE(n.seq, n.legacy_seq) DESC LIMIT ?`)
    .all(registerId, like, like, like, limit) as any[]).map(toRecord);
}

// ---------- daftar & ringkasan ----------
const SORTS: Record<string, string> = { number_date: 'n.number_date', seq: 'n.number_date|COALESCE(n.seq, n.legacy_seq)', number_text: 'n.number_text', subject: 'n.subject', counterparty: 'n.counterparty', creator: 'n.creator', status: 'n.status', created_at: 'n.created_at' };

export function queryRecords(db: DB, q: RecordQuery): RecordPage {
  const w = ['n.register_id=?']; const a: unknown[] = [q.register_id];
  if (q.year) { w.push('n.year=?'); a.push(q.year); }
  if (q.date_from) { w.push('n.number_date>=?'); a.push(q.date_from); }
  if (q.date_to) { w.push('n.number_date<=?'); a.push(q.date_to); }
  if (q.subject) { w.push('n.subject LIKE ?'); a.push(`%${q.subject}%`); }
  if (q.counterparty) { w.push('n.counterparty LIKE ?'); a.push(`%${q.counterparty}%`); }
  if (q.creator) { w.push('n.creator LIKE ?'); a.push(`%${q.creator}%`); }
  if (q.status) { w.push('n.status=?'); a.push(q.status); }
  if (q.batch_id) { w.push('n.batch_id=?'); a.push(q.batch_id); }
  if (q.date) { w.push('n.number_date=?'); a.push(q.date); }
  if (q.search?.trim()) { const l = `%${q.search.trim()}%`; w.push('(n.number_text LIKE ? OR n.subject LIKE ? OR n.counterparty LIKE ? OR n.notes LIKE ? OR n.creator LIKE ?)'); a.push(l, l, l, l, l); }
  const where = w.join(' AND ');
  const size = Math.min(Math.max(q.page_size ?? 25, 1), 500); const page = Math.max(q.page ?? 1, 1);
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const col = SORTS[q.sort ?? 'number_date'] ?? SORTS.number_date;
  const orderBy = col.split('|').map((c) => `${c} ${dir}`).join(', ') + ', n.seq DESC, n.created_at DESC';
  const total = (db.prepare(`SELECT COUNT(*) n FROM number_records n WHERE ${where}`).get(...a) as { n: number }).n;
  const rows = (db.prepare(`${SELECT} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...a, size, (page - 1) * size) as any[]).map(toRecord);
  return { rows, total, page, page_size: size };
}
export function allRecords(db: DB, q: RecordQuery): NumberRecord[] { return queryRecords(db, { ...q, page: 1, page_size: 500 }).rows.length < 500 ? queryRecords(db, { ...q, page: 1, page_size: 500 }).rows : collectAll(db, q); }
function collectAll(db: DB, q: RecordQuery): NumberRecord[] {
  const out: NumberRecord[] = []; let page = 1;
  for (;;) { const p = queryRecords(db, { ...q, page, page_size: 500 }); out.push(...p.rows); if (out.length >= p.total || !p.rows.length) break; page++; }
  return out;
}

/** Nomor AVAILABLE yang siap dipilih untuk draf (tanpa catatan migrasi yang belum ditinjau). include_all menampilkan status lain (hanya baca). */
export function listAvailable(db: DB, q: AvailableQuery): NumberRecord[] {
  const w = ['n.register_id=?']; const a: unknown[] = [q.register_id];
  if (!q.include_all) w.push("n.status='available' AND n.legacy_review=0");
  if (q.date) { w.push('n.number_date=?'); a.push(q.date); }
  if (q.date_from) { w.push('n.number_date>=?'); a.push(q.date_from); }
  if (q.search?.trim()) { w.push('n.number_text LIKE ?'); a.push(`%${q.search.trim()}%`); }
  return (db.prepare(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY n.number_date ASC, COALESCE(n.seq, n.legacy_seq) ASC LIMIT ?`).all(...a, Math.min(q.limit ?? 200, 500)) as any[]).map(toRecord);
}

/** Tanggal acuan 'berikutnya': hari ini bila tahun berjalan, selain itu 1 Januari tahun tsb. */
const todayIso = (year: number) => { const d = clock.now(); return d.getFullYear() === year ? `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : `${year}-01-01`; };

export function summaries(db: DB, year: number): RegisterSummary[] {
  return listRegisters(db).map((register) => {
    const c = db.prepare(`SELECT COUNT(*) total, SUM(status='available') available, SUM(status='assigned') assigned, SUM(status='issued') issued, SUM(status='void') void,
      SUM(legacy_review=1) review FROM number_records WHERE register_id=?`).get(register.id) as any;
    const y = db.prepare('SELECT COUNT(*) n FROM number_records WHERE register_id=? AND year=?').get(register.id, year) as { n: number };
    const last = db.prepare("SELECT number_text t FROM number_records WHERE register_id=? AND year=? AND status!='void' ORDER BY number_date DESC, COALESCE(seq, legacy_seq) DESC, created_at DESC LIMIT 1").get(register.id, year) as { t: string } | undefined;
    const nextDate = todayIso(year);
    const next: NextInfo = suggestNext(db, register.id, nextDate, register);
    return {
      register, total: c.total ?? 0, available: c.available ?? 0, assigned: c.assigned ?? 0, issued: c.issued ?? 0, void: c.void ?? 0, review: c.review ?? 0,
      year, year_total: y.n, year_last_number: last?.t ?? null, next_date: nextDate, next_number: next.preview, next_full: next.full,
      needs_confirmation: next.requires_confirmation && next.has_imported
    };
  });
}
export type { Register, NumberStatus };
