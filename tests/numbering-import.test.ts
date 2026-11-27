import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import type { Actor, ImportCommitInput } from '../shared/numbering';
import { listUsers } from '../electron/main/numbering/users';
import { ensureDefaultMappings, getRegister, updateRegister } from '../electron/main/numbering/registers';
import { commitImport, listImports, previewImport, validateImport } from '../electron/main/numbering/import';
import { exportRegisterXlsx, registerHtml } from '../electron/main/numbering/export';
import { readXlsx, writeXlsx } from '../electron/main/numbering/xlsx';
import { createUser } from '../electron/main/numbering/users';
import { queryRecords, generateBatch, assignNumber, updateMeta, issueNumber } from '../electron/main/numbering/records';
/** Setara pemesanan lama: buat 1 nomor di bank lalu pilih untuk draf. */
const reserveNumber = (d: DB, who: Actor, i: { register_id: string; number_date: string; subject?: string; counterparty?: string }) => {
  const r = assignNumber(d, who, generateBatch(d, who, { register_id: i.register_id, number_date: i.number_date, quantity: 1 }).records[0].id);
  return i.subject || i.counterparty ? updateMeta(d, who, r.id, { subject: i.subject, counterparty: i.counterparty }) : r;
};
import { suggestNext } from '../electron/main/numbering/engine';
import { listAudit } from '../electron/main/numbering/audit';

const FX = path.join(__dirname, 'fixtures');
const read = (f: string) => fs.readFileSync(path.join(FX, f));
let db: DB; let admin: Actor; let op: Actor;
const ba = () => getRegister(db, 'BERITA_ACARA');
beforeEach(() => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); ensureDefaultMappings(db);
  const a = listUsers(db).find((u) => u.role === 'admin')!; admin = { id: a.id, name: a.name, role: 'admin' };
  const u = createUser(db, admin, { name: 'Budi', role: 'operator' }); op = { id: u.id, name: u.name, role: 'operator' };
});
afterEach(() => db.close());
const OLD_FMT = '{SEQUENCE}/BA/PPK.6/BAKTI.31.9/KOMDIGI/{MONTH}/{YEAR}';
/** Berkas riwayat lama memakai format tahunan; register dipasang sementara dengan format lama saat mengimpor, lalu dikembalikan ke DDSS. */
const withOldFormat = <T,>(d: DB, who: Actor, fn: () => T): T => {
  const r = getRegister(d, 'BERITA_ACARA'); const prev = { format: r.format, seq_length: r.seq_length };
  updateRegister(d, who, r.id, { format: OLD_FMT, seq_length: 1 }, 'uji impor riwayat');
  try { return fn(); } finally { updateRegister(d, who, r.id, prev, 'kembali ke DDSS'); }
};
const mk = (rows: Array<Array<string | number | null>>, name = 'BA') => writeXlsx([{ name, header: ['TGL', 'NOMOR', 'NOMOR BA', 'PIHAK', 'PERIHAL'], rows }]);
const inputOf = (buf: Buffer, over: Partial<ImportCommitInput> = {}): ImportCommitInput => { const p = previewImport(buf); return { register_id: ba().id, sheet: p.sheet, header_row: p.header_row, mapping: p.mapping, confirm_gaps: false, skip_duplicates: false, file_name: 'x.xlsx', ...over }; };
const err = (fn: () => unknown): string => { try { fn(); } catch (e) { return `${(e as { code?: string }).code}:${(e as Error).message}`; } return 'NO_ERROR'; };
const input = (file: string, over: Partial<ImportCommitInput> = {}): ImportCommitInput => {
  const p = previewImport(read(file));
  return { register_id: ba().id, sheet: p.sheet, header_row: p.header_row, mapping: p.mapping, confirm_gaps: false, skip_duplicates: false, file_name: file, ...over };
};

describe('XLSX reader/writer', () => {
  it('tulis lalu baca ulang (teks, angka, karakter khusus)', () => {
    const buf = writeXlsx([{ name: 'Data', header: ['A', 'B'], rows: [['x & <y> "z"', 5], [null, 'baris\nbaru'], ['Tanggal', 12.5]] }]);
    const s = readXlsx(buf)[0];
    expect(s.name).toBe('Data');
    expect(s.rows[0]).toEqual(['A', 'B']);
    expect(s.rows[1]).toEqual(['x & <y> "z"', 5]);
    expect(s.rows[2][1]).toBe('baris\nbaru');
    expect(s.rows[3][1]).toBe(12.5);
  });
  it('membaca berkas openpyxl: tanggal Excel menjadi ISO, shared strings', () => {
    const s = readXlsx(read('register-ba-2026.xlsx'))[0];
    expect(s.name).toBe('BA 2026');
    expect(s.rows[2][3]).toBe('NOMOR BA');
    expect(s.rows[8][0]).toBe('2026-04-07');
    expect(s.rows[7]).toEqual([]);
  });
  it('berkas bukan XLSX ditolak dengan pesan', () => {
    expect(err(() => previewImport(Buffer.from('bukan zip sama sekali, hanya teks')))).toContain('INVALID');
  });
});

describe('pratinjau & validasi', () => {
  it('mendeteksi baris header & pemetaan kolom otomatis (kolom BA)', () => {
    const p = previewImport(read('register-ba-2026.xlsx'));
    expect(p.header_row).toBe(3);
    expect(p.mapping).toEqual({ date: 0, month: 1, seq: 2, number: 3, counterparty: 4, subject: 5, notes: 6, creator: 7 });
    expect(p.total_rows).toBe(5);
  });
  it('berkas riwayat format lama: seluruh baris valid sebagai nomor lama, tanpa menulis ke DB', () => {
    const r = withOldFormat(db, admin, () => validateImport(db, read('register-ba-2026.xlsx'), input('register-ba-2026.xlsx')));
    expect(r.ok).toBe(true); expect(r.valid_rows).toBe(5); expect(r.skipped_blank).toBe(1);
    expect(r.years).toEqual([{ year: 2026, count: 5 }]);
    expect(r.daily_rows).toBe(0); expect(r.legacy_rows).toBe(5); expect(r.days_total).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM number_records').get() as { n: number }).n).toBe(0);
  });
  it('kesalahan: duplikat, nomor tidak cocok, tanggal tidak ada', () => {
    const r = withOldFormat(db, admin, () => validateImport(db, read('register-ba-bad.xlsx'), input('register-ba-bad.xlsx')));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code).sort()).toEqual(['BAD_DATE', 'DUPLICATE', 'SEQ_MISMATCH']);
  });
  it('skip_duplicates melewati duplikat tetapi kesalahan lain tetap memblokir', () => {
    const r = withOldFormat(db, admin, () => validateImport(db, read('register-ba-bad.xlsx'), input('register-ba-bad.xlsx', { skip_duplicates: true })));
    expect(r.duplicates).toHaveLength(1); expect(r.errors.map((e) => e.code).sort()).toEqual(['BAD_DATE', 'SEQ_MISMATCH']);
  });
  it('DDSS: urutan harian dari nomor tertinggi per tanggal (bukan baris terakhir), celah & ketidakkonsistenan dilaporkan', () => {
    const buf = mk([
      ['2026-11-24', 2, '2402', 'PT A', 'x'], ['2026-11-24', 4, '2404', 'PT B', 'y'], ['2026-11-24', 1, '2401', 'PT C', 'z'], // baris terakhir bukan yang tertinggi
      ['2026-11-25', 1, '2501', 'PT D', 'w'], ['2026-11-24', 1, '2501', 'PT E', 'salah hari']]);
    const r = validateImport(db, buf, inputOf(buf));
    expect(r.ok).toBe(true); expect(r.daily_rows).toBe(4); expect(r.legacy_rows).toBe(1);
    const d24 = r.days.find((d) => d.date === '2026-11-24')!;
    expect([d24.count, d24.max_seq, d24.gaps, d24.suggested_next]).toEqual([3, 4, [3], 5]);
    expect(r.days[0].date).toBe('2026-11-24'); // yang bercelah lebih dulu
    const d25 = r.days.find((d) => d.date === '2026-11-25')!; expect([d25.max_seq, d25.suggested_next, d25.gap_count]).toEqual([1, 2, 0]);
    expect(r.warnings.some((w) => w.code === 'DAY_MISMATCH' && w.row === 6)).toBe(true);
    expect(r.requires_confirmation).toBe(true);
  });
  it('DDSS: duplikat (tanggal + urut / nomor sama) terdeteksi dalam berkas dan terhadap DB', () => {
    const buf = mk([['2026-11-24', 1, '2401', 'A', 'a'], ['2026-11-24', 1, '2401', 'B', 'b']]);
    expect(validateImport(db, buf, inputOf(buf)).errors.map((e) => e.code)).toEqual(['DUPLICATE']);
    reserveNumber(db, op, { register_id: ba().id, number_date: '2026-11-24' });
    const buf2 = mk([['2026-11-24', 1, '2401', 'A', 'a'], ['2026-11-24', 2, '2402', 'A', 'a']]);
    const r = validateImport(db, buf2, inputOf(buf2, { skip_duplicates: true }));
    expect(r.duplicates).toHaveLength(1); expect(r.valid_rows).toBe(1);
  });
});

describe('commit impor', () => {
  it('wajib admin; celah perlu konfirmasi; kegagalan dicatat tanpa mengubah register', () => {
    const buf = mk([['2026-11-24', 1, '2401', 'A', 'a'], ['2026-11-24', 3, '2403', 'A', 'a']]);
    expect(err(() => commitImport(db, op, buf, inputOf(buf)))).toContain('FORBIDDEN');
    expect(err(() => commitImport(db, admin, buf, inputOf(buf)))).toContain('NEEDS_CONFIRMATION');
    expect((db.prepare('SELECT COUNT(*) n FROM number_records').get() as { n: number }).n).toBe(0);
    expect(listImports(db).map((i) => i.status)).toEqual(['failed']);
  });
  it('riwayat lama tersimpan apa adanya; tidak diubah; reservasi baru mulai 01 pada tanggalnya', () => {
    const f = 'register-ba-2026.xlsx';
    const res = withOldFormat(db, admin, () => commitImport(db, admin, read(f), input(f)));
    expect(res.imported).toBe(5); expect(res.days_updated).toBe(0);
    const rows = queryRecords(db, { register_id: ba().id, sort: 'seq', dir: 'asc' }).rows;
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 4, 5, 6]); // nomor urut lama tetap terbaca
    expect(rows.every((r) => r.seq_scheme === 'legacy' && r.status === 'issued' && r.source === 'import')).toBe(true);
    expect(rows[0].number_text).toBe('1/BA/PPK.6/BAKTI.31.9/KOMDIGI/1/2026');
    expect(rows[0].number_date).toBe('2026-01-05'); expect(rows[0].counterparty).toBe('PT Alpha'); expect(rows[0].creator).toBe('Budi');
    expect(rows[3].subject).toBe('BA Pembayaran & "uang muka"'); expect(rows[4].number_date).toBe('2026-04-07');
    expect(reserveNumber(db, op, { register_id: ba().id, number_date: '2026-01-05' }).number_text).toBe('0501'); // tanggal sama dengan riwayat: mulai 01
    expect(listAudit(db, { action: 'import' })[0].action).toBe('import.committed');
  });
  it('DDSS: impor DDSS (urutan acak, ada celah dikonfirmasi) → pemesanan berikutnya melanjutkan tiap tanggal', () => {
    const buf = mk([['2026-11-24', 3, '2403', 'A', 'a'], ['2026-11-24', 1, '2401', 'A', 'a'], ['2026-11-25', 1, '2501', 'B', 'b'], ['2026-11-24', 2, '2402', 'C', 'c'], ['2026-11-24', 6, '2406', 'D', 'd']]);
    const r = commitImport(db, admin, buf, inputOf(buf, { confirm_gaps: true }));
    expect(r.imported).toBe(5); expect(r.days_updated).toBe(2);
    expect(reserveNumber(db, op, { register_id: ba().id, number_date: '2026-11-24' }).number_text).toBe('2407'); // dari nomor tertinggi 2406, bukan baris terakhir
    expect(reserveNumber(db, op, { register_id: ba().id, number_date: '2026-11-25' }).number_text).toBe('2502');
    expect(reserveNumber(db, op, { register_id: ba().id, number_date: '2026-11-26' }).number_text).toBe('2601');
    expect(suggestNext(db, ba().id, '2026-11-24').gaps).toEqual([4, 5]);
  });
  it('rollback penuh bila gagal di tengah; kegagalan tercatat', () => {
    const buf = mk([['2026-11-24', 1, '2401', 'A', 'a'], ['2026-11-24', 2, '2402', 'A', 'a'], ['2026-11-24', 3, '2403', 'A', 'a'], ['2026-11-24', 4, '2404', 'A', 'a']]);
    const e = err(() => commitImport(db, admin, buf, inputOf(buf), { afterRow: (n) => { if (n === 3) throw new Error('disk penuh'); } }));
    expect(e).toContain('dikembalikan');
    expect((db.prepare('SELECT COUNT(*) n FROM number_records').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM number_daily_counters').get() as { n: number }).n).toBe(0);
    expect(listImports(db)[0].status).toBe('failed');
  });
  it('impor ulang berkas sama: semua baris duplikat → ditolak; skip_duplicates → tidak ada baris valid', () => {
    const f = 'register-ba-2026.xlsx';
    withOldFormat(db, admin, () => {
      commitImport(db, admin, read(f), input(f));
      expect(err(() => commitImport(db, admin, read(f), input(f)))).toContain('INVALID');
      expect(err(() => commitImport(db, admin, read(f), input(f, { skip_duplicates: true })))).toContain('tidak ada baris valid');
    });
    expect((db.prepare('SELECT COUNT(*) n FROM number_records').get() as { n: number }).n).toBe(5);
  });
});

describe('volume besar', () => {
  it('mengimpor 5.000 baris (100 tanggal × 50 urut) dalam satu transaksi dan melanjutkan penomoran', () => {
    const rows: Array<Array<string | number | null>> = [];
    for (let i = 1; i <= 5000; i++) {
      const d = new Date(Date.UTC(2025, 0, 1 + ((i - 1) % 100))); const seq = Math.floor((i - 1) / 100) + 1;
      const iso = d.toISOString().slice(0, 10);
      rows.push([iso, seq, `${iso.slice(8, 10)}${String(seq).padStart(2, '0')}`, `PT ${i % 50}`, `Perihal ${i}`]);
    }
    const buf = mk(rows, 'BA 2025');
    const p = previewImport(buf);
    expect(p.total_rows).toBe(5000);
    const t0 = Date.now();
    const r = commitImport(db, admin, buf, inputOf(buf, { confirm_gaps: false }));
    expect(r.imported).toBe(5000); expect(r.days_updated).toBe(100);
    expect(Date.now() - t0).toBeLessThan(60000);
    expect(queryRecords(db, { register_id: ba().id, page_size: 10 }).total).toBe(5000);
    expect(reserveNumber(db, op, { register_id: ba().id, number_date: '2025-01-05' }).number_text).toBe('0551');
  });
});

describe('ekspor', () => {
  it('ekspor XLSX dapat diimpor ulang ke register kosong dan menghasilkan nomor identik', () => {
    const buf0 = mk([['2026-11-24', 1, '2401', 'PT Alpha', 'P1'], ['2026-11-24', 2, '2402', 'PT Beta', 'P2'], ['2026-11-25', 1, '2501', 'PT Gamma', 'P3']]);
    commitImport(db, admin, buf0, inputOf(buf0));
    issueNumber(db, op, reserveNumber(db, op, { register_id: ba().id, number_date: '2026-11-24', subject: 'Baru', counterparty: 'PT Baru' }).id);
    const x = exportRegisterXlsx(db, { register_id: ba().id });
    const s = readXlsx(x)[0];
    expect(s.rows[0]).toEqual(['TGL', 'BULAN', 'NOMOR', 'NOMOR LENGKAP', 'PIHAK', 'PERIHAL', 'KETERANGAN', 'PEMBUAT', 'STATUS']);
    expect(s.rows).toHaveLength(5);
    expect(s.rows.map((r) => r[3])).toContain('2403');
    const db2 = openDatabase(':memory:'); runMigrations(db2); seedDefaults(db2); ensureDefaultMappings(db2);
    const reg2 = getRegister(db2, 'BERITA_ACARA');
    const p = previewImport(x);
    expect(p.mapping.number).toBe(3);
    commitImport(db2, admin, x, { register_id: reg2.id, sheet: p.sheet, header_row: p.header_row, mapping: p.mapping, confirm_gaps: true, skip_duplicates: false, file_name: 'ekspor.xlsx' });
    const key = (d: DB, id: string) => queryRecords(d, { register_id: id, sort: 'seq', dir: 'asc' }).rows.map((r) => [r.number_text, r.number_date, r.subject, r.counterparty]);
    expect(key(db2, reg2.id)).toEqual(key(db, ba().id));
    expect(suggestNext(db2, reg2.id, '2026-11-24').suggested).toBe(4);
    db2.close();
  });
  it('HTML untuk PDF memuat nomor dan melepas karakter HTML', () => {
    reserveNumber(db, op, { register_id: ba().id, number_date: '2026-05-02', subject: '<b>X</b> & Y' });
    const h = registerHtml(db, { register_id: ba().id });
    expect(h).toContain('&lt;b&gt;X&lt;/b&gt; &amp; Y'); expect(h).toContain('Register Berita Acara');
  });
});
