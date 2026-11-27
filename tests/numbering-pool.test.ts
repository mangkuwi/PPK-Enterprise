/** Uji penerimaan: Bank Nomor Dokumen (nomor dibuat lebih dulu, dipilih saat membuat dokumen). */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import type { Actor } from '../shared/numbering';
import { createUser, listUsers } from '../electron/main/numbering/users';
import { ensureDefaultMappings, getRegister } from '../electron/main/numbering/registers';
import { assignNumber, generateBatch, getRecord, issueNumber, listAvailable, listBatches, migrationReview, previewBatch, queryRecords, recordEvents, releaseNumber, resolveLegacy, summaries, voidNumber } from '../electron/main/numbering/records';
import { onDocumentDeleting, onDocumentStatus } from '../electron/main/numbering/integration';
import { listAudit } from '../electron/main/numbering/audit';

let db: DB; let admin: Actor; let op: Actor; let op2: Actor;
const err = (fn: () => unknown): string => { try { fn(); } catch (e) { return `${(e as { code?: string }).code}:${(e as Error).message}`; } return 'NO_ERROR'; };
const BA = () => getRegister(db, 'BERITA_ACARA').id;
const mkDoc = (id: string) => { const t = new Date().toISOString(); db.prepare("INSERT INTO documents (id, title, status, content_json, layout_json, created_at, updated_at) VALUES (?, 'Dok', 'draft', '{}', '{}', ?, ?)").run(id, t, t); };
const gen = (date: string, quantity: number, code = 'BERITA_ACARA', who = op) => generateBatch(db, who, { register_id: getRegister(db, code).id, number_date: date, quantity }).records;

beforeEach(() => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); ensureDefaultMappings(db);
  const a = listUsers(db).find((u) => u.role === 'admin')!; admin = { id: a.id, name: a.name, role: 'admin' };
  const u = createUser(db, admin, { name: 'Budi', role: 'operator' }); op = { id: u.id, name: u.name, role: 'operator' };
  const u2 = createUser(db, admin, { name: 'Sari', role: 'operator' }); op2 = { id: u2.id, name: u2.name, role: 'operator' };
});
afterEach(() => db.close());

describe('uji penerimaan bank nomor', () => {
  it('TEST 1: 10 nomor Berita Acara 25 Nov 2026 = 2501–2510, semua AVAILABLE, satu batch', () => {
    const pv = previewBatch(db, BA(), '2026-11-25', 10);
    expect(pv.numbers).toEqual(['2501', '2502', '2503', '2504', '2505', '2506', '2507', '2508', '2509', '2510']);
    expect(db.prepare('SELECT COUNT(*) n FROM number_records').get()).toEqual({ n: 0 }); // pratinjau tidak menyimpan apa pun
    const recs = gen('2026-11-25', 10);
    expect(recs.map((r) => r.number_text)).toEqual(pv.numbers);
    expect(recs.every((r) => r.status === 'available' && r.batch_id)).toBe(true);
    const b = listBatches(db, BA());
    expect(b).toHaveLength(1); expect([b[0].quantity, b[0].first_number, b[0].last_number]).toEqual([10, '2501', '2510']);
    expect(listAudit(db, { action: 'number.batch' })).toHaveLength(1);
  });

  it('TEST 2: tidak ada nomor dibuat otomatis (hanya pembuatan eksplisit yang menambah nomor)', () => {
    expect(db.prepare('SELECT COUNT(*) n FROM number_records').get()).toEqual({ n: 0 });
    expect(listAvailable(db, { register_id: BA() })).toEqual([]);
    expect(summaries(db, 2026).every((s) => s.total === 0)).toBe(true);
  });

  it('TEST 3–5: pilih 2503 → ASSIGNED; batalkan draf → AVAILABLE; pilih lagi berhasil', () => {
    const recs = gen('2026-11-25', 10);
    const n2503 = recs.find((r) => r.number_text === '2503')!;
    expect(assignNumber(db, op, n2503.id).status).toBe('assigned');
    expect(listAvailable(db, { register_id: BA() }).map((r) => r.number_text)).not.toContain('2503');
    const rel = releaseNumber(db, op, n2503.id, 'draf dibatalkan');
    expect(rel.status).toBe('available'); expect(rel.document_id).toBeNull();
    expect(listAvailable(db, { register_id: BA() }).map((r) => r.number_text)).toContain('2503');
    const again = assignNumber(db, op2, n2503.id);
    expect(again.status).toBe('assigned'); expect(again.assigned_by).toBe('Sari');
    expect(recordEvents(db, n2503.id).map((e) => e.event)).toEqual(['generated', 'assigned', 'released', 'assigned']);
    expect(listAvailable(db, { register_id: BA() }).length).toBe(9); // 10 − 1
  });

  it('TEST 6: dua draf memilih nomor yang sama → hanya satu berhasil (dua koneksi pada berkas yang sama)', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'nd-pool-')), 'x.db');
    const d1 = openDatabase(f); runMigrations(d1); seedDefaults(d1); ensureDefaultMappings(d1);
    const d2 = openDatabase(f);
    const a = listUsers(d1).find((u) => u.role === 'admin')!; const act: Actor = { id: a.id, name: a.name, role: 'admin' };
    const rid = getRegister(d1, 'BERITA_ACARA').id;
    const [r] = generateBatch(d1, act, { register_id: rid, number_date: '2026-11-25', quantity: 1 }).records;
    const first = assignNumber(d1, { ...act, name: 'Satu' }, r.id);
    const second = err(() => assignNumber(d2, { ...act, name: 'Dua' }, r.id));
    expect(first.status).toBe('assigned'); expect(second).toContain('STATE'); expect(second).toContain('tidak tersedia');
    expect((d1.prepare("SELECT COUNT(*) n FROM number_records WHERE status='assigned'").get() as { n: number }).n).toBe(1);
    expect(getRecord(d2, r.id).assigned_by).toBe('Satu');
    d1.close(); d2.close();
  });

  it('TEST 7–8: finalisasi dokumen → ISSUED; nomor terbit tidak dapat dipilih/dilepas/di-void lagi', () => {
    const n = gen('2026-11-25', 5).find((r) => r.number_text === '2503')!;
    mkDoc('d1');
    assignNumber(db, op, n.id, { document_id: 'd1' });
    const issued = onDocumentStatus(db, op, 'd1', 'final')!;
    expect(issued.status).toBe('issued'); expect(issued.document_id).toBe('d1'); expect(issued.issued_by).toBe('Budi');
    expect(err(() => assignNumber(db, op2, n.id))).toContain('STATE');
    expect(err(() => releaseNumber(db, admin, n.id, 'coba'))).toContain('STATE');
    expect(err(() => voidNumber(db, admin, n.id, 'coba', true))).toContain('STATE');
    expect(listAvailable(db, { register_id: BA() }).map((r) => r.number_text)).not.toContain('2503');
    // draf dihapus setelah terbit: nomor tetap terbit
    onDocumentDeleting(db, op, 'd1');
    expect(getRecord(db, n.id).status).toBe('issued');
  });

  it('TEST 9: void manual oleh admin: alasan + pelaku tercatat, permanen, tidak dipakai ulang', () => {
    const recs = gen('2026-11-25', 3);
    expect(err(() => voidNumber(db, op, recs[1].id, 'alasan', true))).toContain('FORBIDDEN');
    const v = voidNumber(db, admin, recs[1].id, 'salah ketik nomor', true);
    expect(v.status).toBe('void'); expect(v.void_reason).toBe('salah ketik nomor'); expect(v.voided_by).toBe('Administrator');
    const ev = recordEvents(db, v.id).find((e) => e.event === 'voided')!;
    expect(ev.actor_name).toBe('Administrator'); expect(ev.detail.reason).toBe('salah ketik nomor');
    expect(listAudit(db, { action: 'number.void' })[0].actor_name).toBe('Administrator');
    // pembuatan nomor berikutnya melanjutkan, tidak memakai ulang 2502
    expect(gen('2026-11-25', 1)[0].number_text).toBe('2504');
    expect(queryRecords(db, { register_id: BA(), status: 'void' }).total).toBe(1);
  });

  it('draf yang dihapus mengembalikan nomor ke AVAILABLE (bukan void)', () => {
    const n = gen('2026-11-25', 2)[0];
    mkDoc('d9'); assignNumber(db, op, n.id, { document_id: 'd9' });
    onDocumentDeleting(db, op, 'd9');
    const r = getRecord(db, n.id);
    expect(r.status).toBe('available'); expect(r.document_id).toBeNull(); expect(r.void_reason).toBeNull();
  });
});

describe('pembuatan massal', () => {
  it('urutan per kategori & tanggal independen; melanjutkan setelah batch sebelumnya', () => {
    expect(gen('2026-11-24', 3).map((r) => r.number_text)).toEqual(['2401', '2402', '2403']);
    expect(gen('2026-11-25', 3).map((r) => r.number_text)).toEqual(['2501', '2502', '2503']);
    expect(gen('2026-11-24', 2).map((r) => r.number_text)).toEqual(['2404', '2405']);
    expect(gen('2026-11-24', 2, 'NOTA_DINAS').map((r) => r.number_text)).toEqual(['2401', '2402']);
    expect(gen('2026-11-24', 1, 'KONTRAK').map((r) => r.number_text)).toEqual(['2401']);
  });
  it('batas 99 per kategori per tanggal: batch yang melebihi ditolak seluruhnya (atomik) dengan pesan jelas', () => {
    gen('2026-11-24', 95);
    const e = err(() => generateBatch(db, op, { register_id: BA(), number_date: '2026-11-24', quantity: 10 }));
    expect(e).toContain('LIMIT'); expect(e).toContain('Administrator'); expect(e).toContain('4 nomor');
    expect(queryRecords(db, { register_id: BA(), date: '2026-11-24' }).total).toBe(95); // tidak ada yang terdaftar sebagian
    expect(err(() => previewBatch(db, BA(), '2026-11-24', 10))).toContain('LIMIT');
    expect(previewBatch(db, BA(), '2026-11-24', 4).last).toBe('2499');
    gen('2026-11-24', 4);
    expect(err(() => gen('2026-11-24', 1))).toContain('LIMIT');
  });
  it('pratinjau kedaluwarsa ditolak bila keadaan berubah sebelum konfirmasi', () => {
    const pv = previewBatch(db, BA(), '2026-11-25', 3);
    gen('2026-11-25', 2, 'BERITA_ACARA', op2); // pengguna lain membuat lebih dulu
    const e = err(() => generateBatch(db, op, { register_id: BA(), number_date: '2026-11-25', quantity: 3, expect_first: pv.first, expect_last: pv.last }));
    expect(e).toContain('COLLISION'); expect(e).toContain('pratinjau');
    expect(queryRecords(db, { register_id: BA(), date: '2026-11-25' }).total).toBe(2);
  });
  it('jumlah tidak valid ditolak; register nonaktif ditolak', () => {
    expect(err(() => previewBatch(db, BA(), '2026-11-25', 0))).toContain('INVALID');
    expect(err(() => previewBatch(db, BA(), '2026-11-25', 501))).toContain('INVALID');
    expect(err(() => previewBatch(db, BA(), '2026-13-40', 1))).toContain('INVALID');
  });
  it('unique DB mencegah nomor ganda untuk kategori + tanggal', () => {
    const [r] = gen('2026-11-25', 1);
    const ins = () => db.prepare(`INSERT INTO number_records (id,register_id,year,day,seq,seq_scheme,number_text,status,number_date,created_at,updated_at) VALUES ('z',?,2026,'25',1,'daily','lain','available','2026-11-25','t','t')`).run(r.register_id);
    expect(err(ins)).toContain('UNIQUE');
  });
  it('pemilih nomor: hanya AVAILABLE secara bawaan; include_all menampilkan status lain', () => {
    const recs = gen('2026-11-25', 4);
    assignNumber(db, op, recs[0].id); voidNumber(db, admin, recs[1].id, 'salah', true);
    expect(listAvailable(db, { register_id: BA() }).map((r) => r.number_text)).toEqual(['2503', '2504']);
    expect(listAvailable(db, { register_id: BA(), include_all: true }).map((r) => r.status)).toEqual(['assigned', 'void', 'available', 'available']);
    expect(listAvailable(db, { register_id: BA(), search: '2504' }).map((r) => r.number_text)).toEqual(['2504']);
    expect(listAvailable(db, { register_id: BA(), date: '2026-11-26' })).toEqual([]);
  });
  it('ringkasan: tersedia/dipakai/terbit/void per kategori', () => {
    const recs = gen('2026-11-25', 4);
    assignNumber(db, op, recs[0].id); issueNumber(db, op, recs[0].id); assignNumber(db, op, recs[1].id); voidNumber(db, admin, recs[2].id, 'salah ketik', true);
    const s = summaries(db, 2026).find((x) => x.register.code === 'BERITA_ACARA')!;
    expect([s.available, s.assigned, s.issued, s.void, s.total]).toEqual([1, 1, 1, 1, 4]);
  });
});

describe('tinjauan migrasi', () => {
  it('catatan hasil migrasi disembunyikan dari pemilih sampai admin meninjau; admin only', () => {
    const [a, b] = gen('2026-11-25', 2);
    db.prepare('UPDATE number_records SET legacy_review=1 WHERE id IN (?,?)').run(a.id, b.id);
    expect(listAvailable(db, { register_id: BA() })).toEqual([]);
    expect(err(() => assignNumber(db, op, a.id))).toContain('belum ditinjau');
    expect(err(() => migrationReview(db, op))).toContain('FORBIDDEN');
    expect(migrationReview(db, admin).counts.pending_review).toBe(2);
    expect(err(() => resolveLegacy(db, admin, [a.id], 'release', ' '))).toContain('INVALID');
    expect(resolveLegacy(db, admin, [a.id], 'release', 'diperiksa: belum pernah dipakai')).toBe(1);
    expect(resolveLegacy(db, admin, [b.id], 'void', 'sudah dipakai di dokumen manual')).toBe(1);
    expect(listAvailable(db, { register_id: BA() }).map((r) => r.number_text)).toEqual([a.number_text]);
    expect(getRecord(db, b.id).status).toBe('void');
    expect(migrationReview(db, admin).counts.pending_review).toBe(0);
    expect(listAudit(db, { action: 'number.migration_review' })).toHaveLength(2);
  });
});
