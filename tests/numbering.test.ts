import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type DB } from '../electron/main/db';
import { runMigrations, currentVersion, LATEST_SCHEMA, MIGRATIONS } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { formatLabel, maxSeqFor, parseNumber, renderNumber, validateFormat } from '../shared/numbering';
import type { Actor } from '../shared/numbering';
import { clock } from '../electron/main/numbering/clock';
import { listUsers, createUser, updateUser, authenticate, setPin } from '../electron/main/numbering/users';
import { configHistory, ensureDefaultMappings, getRegister, listCategoryMap, listRegisters, registerForTemplate, setCategoryMap, setTemplateMap, updateRegister } from '../electron/main/numbering/registers';
import { setNextSequence, suggestNext } from '../electron/main/numbering/engine';
import { addRef, assignNumber, createManual, generateBatch, getRecord, issueNumber, queryRecords, recordEvents, releaseNumber, updateMeta, summaries, searchReferenceable, voidNumber } from '../electron/main/numbering/records';
import { listAudit } from '../electron/main/numbering/audit';

let db: DB; let admin: Actor; let op: Actor; let op2: Actor;
const mkDoc = (id: string) => { const t = new Date().toISOString(); db.prepare("INSERT INTO documents (id, title, status, content_json, layout_json, created_at, updated_at) VALUES (?, 'Dok', 'draft', '{}', '{}', ?, ?)").run(id, t, t); };
const reg = (code: string) => getRegister(db, code);
beforeEach(() => {
  db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); ensureDefaultMappings(db);
  const a = listUsers(db).find((u) => u.role === 'admin')!;
  admin = { id: a.id, name: a.name, role: 'admin' };
  const u = createUser(db, admin, { name: 'Budi', role: 'operator' }); op = { id: u.id, name: u.name, role: 'operator' };
  const u2 = createUser(db, admin, { name: 'Sari', role: 'operator' }); op2 = { id: u2.id, name: u2.name, role: 'operator' };
  clock.now = () => new Date();
});
afterEach(() => { clock.now = () => new Date(); db.close(); });

const err = (fn: () => unknown): string => { try { fn(); } catch (e) { return `${(e as { code?: string }).code}:${(e as Error).message}`; } return 'NO_ERROR'; };
/** Membuat 1 nomor di bank lalu memilihnya untuk draf (setara pemesanan lama): status ASSIGNED. */
const res = (code: string, date: string, extra: { document_id?: string; subject?: string; counterparty?: string } = {}, who: Actor = op) => {
  const b = generateBatch(db, who, { register_id: reg(code).id, number_date: date, quantity: 1 });
  const r = assignNumber(db, who, b.records[0].id, { document_id: extra.document_id ?? null });
  return extra.subject || extra.counterparty ? updateMeta(db, who, r.id, { subject: extra.subject, counterparty: extra.counterparty }) : r;
};

describe('format nomor', () => {
  const s = { format: '{SEQUENCE}/BA/PPK.6/BAKTI.31.9/KOMDIGI/{MONTH}/{YEAR}', prefix: '', suffix: '', seq_length: 1 };
  it('render & parse bolak-balik', () => {
    expect(renderNumber(s, 7, '2026-03-15')).toBe('7/BA/PPK.6/BAKTI.31.9/KOMDIGI/3/2026');
    expect(parseNumber(s, '7/BA/PPK.6/BAKTI.31.9/KOMDIGI/3/2026')).toEqual({ seq: 7, year: 2026, month: 3 });
    expect(parseNumber(s, '7/XX/PPK')).toBeNull();
  });
  it('panjang urut, awalan/akhiran, bulan romawi', () => {
    const t = { format: '{SEQUENCE}/ND/{ROMAN}/{YY}', prefix: 'No. ', suffix: ' (R)', seq_length: 4 };
    expect(renderNumber(t, 12, '2026-11-02')).toBe('No. 0012/ND/XI/26 (R)');
    expect(parseNumber(t, 'No. 0012/ND/XI/26 (R)')).toEqual({ seq: 12, year: 2026, month: 11 });
  });
  it('validasi', () => {
    expect(validateFormat({ ...s, format: 'tanpa urut' })).toContain('SEQUENCE');
    expect(validateFormat({ ...s, format: '{SEQUENCE}/{FOO}' })).toContain('FOO');
    expect(validateFormat({ ...s, format: '{SEQUENCE}/{SEQUENCE}' })).toContain('tepat satu');
    expect(validateFormat(s)).toBeNull();
    expect(validateFormat({ ...s, seq_length: 0 })).toContain('1–10');
    expect(validateFormat({ format: '{DAY}{SEQUENCE}', prefix: '', suffix: '', seq_length: 2 })).toContain('DAY2');
  });
  it('DDSS: {DAY2}{SEQUENCE}, parse hari & urut, label format, batas', () => {
    const d = { format: '{DAY2}{SEQUENCE}', prefix: '', suffix: '', seq_length: 2 };
    expect(validateFormat(d)).toBeNull();
    expect(renderNumber(d, 1, '2026-11-24')).toBe('2401');
    expect(renderNumber(d, 1, '2026-12-01')).toBe('0101');
    expect(parseNumber(d, '2401')).toEqual({ seq: 1, day: 24 });
    expect(parseNumber(d, '0101')).toEqual({ seq: 1, day: 1 });
    expect(parseNumber(d, '240')).toBeNull();
    expect(formatLabel(d)).toBe('DDSS');
    expect(maxSeqFor(2)).toBe(99); expect(maxSeqFor(3)).toBe(999);
  });
});

describe('migrasi & seed', () => {
  it('upgrade dari skema v4: data lama utuh, tabel penomoran dibuat, pencadangan sebelum migrasi dipanggil', () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 4)) old.exec(m.sql);
    old.pragma('user_version = 4');
    const t = new Date().toISOString();
    old.prepare("INSERT INTO documents (id, title, status, content_json, layout_json, letter_number, created_at, updated_at) VALUES ('old1','Surat lama','final','{}','{}','123/LAMA/2024',?,?)").run(t, t);
    let from = -1;
    expect(runMigrations(old, { beforeMigrate: (v) => { from = v; } })).toBe(LATEST_SCHEMA);
    expect(from).toBe(4);
    expect((old.prepare("SELECT letter_number n FROM documents WHERE id='old1'").get() as { n: string }).n).toBe('123/LAMA/2024');
    expect(listRegisters(old).length).toBe(4);
    expect((old.prepare('SELECT COUNT(*) n FROM app_users').get() as { n: number }).n).toBe(1);
    expect(runMigrations(old)).toBe(LATEST_SCHEMA);
    expect((old.prepare('SELECT COUNT(*) n FROM number_registers').get() as { n: number }).n).toBe(4);
    old.close();
  });
  it('skema terbaru terpasang, empat register berformat DDSS & admin, pemetaan bawaan', () => {
    expect(currentVersion(db)).toBe(LATEST_SCHEMA);
    expect(listRegisters(db).map((r) => r.code)).toEqual(['SURAT_KELUAR', 'NOTA_DINAS', 'BERITA_ACARA', 'KONTRAK']);
    const m = listCategoryMap(db);
    const to = (n: string) => m.find((x) => x.category_name === n)?.register_id;
    expect(to('Surat Undangan')).toBe(reg('SURAT_KELUAR').id);
    expect(to('Nota Dinas')).toBe(reg('NOTA_DINAS').id);
    expect(to('Berita Acara')).toBe(reg('BERITA_ACARA').id);
    expect(to('Kontrak')).toBe(reg('KONTRAK').id);
    expect(to('Laporan')).toBeNull();
  });
  it('pemetaan bawaan tidak menimpa perubahan admin', () => {
    const c = listCategoryMap(db).find((x) => x.category_name === 'Surat Undangan')!;
    setCategoryMap(db, admin, c.category_id, reg('NOTA_DINAS').id);
    ensureDefaultMappings(db);
    expect(listCategoryMap(db).find((x) => x.category_name === 'Surat Undangan')!.register_id).toBe(reg('NOTA_DINAS').id);
  });
  it('template mengikuti kategori; pemetaan template lebih spesifik', () => {
    const t = db.prepare("SELECT id FROM templates WHERE category_id=(SELECT id FROM categories WHERE name='Nota Dinas') LIMIT 1").get() as { id: string };
    expect(registerForTemplate(db, t.id)!.code).toBe('NOTA_DINAS');
    setTemplateMap(db, admin, t.id, reg('KONTRAK').id);
    expect(registerForTemplate(db, t.id)!.code).toBe('KONTRAK');
    setTemplateMap(db, admin, t.id, null);
    const lap = db.prepare("SELECT id FROM categories WHERE name='Laporan'").get() as { id: string };
    expect(registerForTemplate(db, null, lap.id)).toBeNull();
  });
});

describe('penghitung harian (DDSS) & independensi', () => {
  it('urut harian naik per tanggal dan kembali 01 saat tanggal berganti', () => {
    expect(res('BERITA_ACARA', '2026-11-24').number_text).toBe('2401');
    expect(res('BERITA_ACARA', '2026-11-24').number_text).toBe('2402');
    expect(res('BERITA_ACARA', '2026-11-25').number_text).toBe('2501');
    expect(res('BERITA_ACARA', '2026-12-01').number_text).toBe('0101');
    expect(res('BERITA_ACARA', '2027-11-24').number_text).toBe('2401'); // tanggal lengkap berbeda → urutan sendiri
  });
  it('independen antar kategori pada tanggal yang sama', () => {
    expect(res('BERITA_ACARA', '2026-11-24').number_text).toBe('2401');
    expect(res('SURAT_KELUAR', '2026-11-24').number_text).toBe('2401');
    expect(res('NOTA_DINAS', '2026-11-24').number_text).toBe('2401');
    expect(res('KONTRAK', '2026-11-24').number_text).toBe('2401');
    expect(res('SURAT_KELUAR', '2026-11-24').number_text).toBe('2402');
    expect(res('BERITA_ACARA', '2026-11-24').number_text).toBe('2402');
  });
  it('tanggal dokumen (mundur/maju) menentukan urutan, bukan jam sistem', () => {
    clock.now = () => new Date('2026-11-24T08:00:00Z');
    expect(res('NOTA_DINAS', '2026-11-25').number_text).toBe('2501');
    expect(res('NOTA_DINAS', '2026-11-24').number_text).toBe('2401');
    expect(res('NOTA_DINAS', '2026-11-25').number_text).toBe('2502');
    expect(res('NOTA_DINAS', '2026-11-24').number_text).toBe('2402'); // melanjutkan urutan 24 Nov, bukan 2503
    const r = res('KONTRAK', '2025-12-31'); expect(r.year).toBe(2025); expect(r.number_text).toBe('3101'); expect(r.day).toBe('31');
  });
  it('nomor void tidak dipakai ulang', () => {
    const a = res('BERITA_ACARA', '2026-11-24'); const b = res('BERITA_ACARA', '2026-11-24');
    releaseNumber(db, op, a.id, 'salah kategori'); voidNumber(db, admin, a.id, 'salah kategori', true); issueNumber(db, op, b.id);
    expect(getRecord(db, a.id).status).toBe('void');
    expect(res('BERITA_ACARA', '2026-11-24').number_text).toBe('2403');
  });
  it('awal terkonfigurasi dipakai untuk setiap tanggal baru', () => {
    updateRegister(db, admin, reg('NOTA_DINAS').id, { initial_sequence: 5 }, 'lanjut dari buku manual');
    expect(res('NOTA_DINAS', '2026-11-24').number_text).toBe('2405');
    expect(res('NOTA_DINAS', '2026-11-24').number_text).toBe('2406');
    expect(res('NOTA_DINAS', '2026-11-25').number_text).toBe('2505');
  });
  it('penghitung yang rusak/mundur tidak menghasilkan duplikat', () => {
    res('BERITA_ACARA', '2026-11-24'); res('BERITA_ACARA', '2026-11-24'); res('BERITA_ACARA', '2026-11-24');
    db.prepare('UPDATE number_daily_counters SET next_seq=1').run();
    expect(suggestNext(db, reg('BERITA_ACARA').id, '2026-11-24').conflicts.length).toBe(1);
    expect(res('BERITA_ACARA', '2026-11-24').number_text).toBe('2404');
  });
  it('unik di tingkat DB: kategori + tanggal + urut', () => {
    const r = res('BERITA_ACARA', '2026-11-24');
    const ins = (id: string, seq: number, text: string, date = '2026-11-24') => db.prepare(`INSERT INTO number_records (id,register_id,year,day,seq,seq_scheme,number_text,status,number_date,created_at,updated_at) VALUES (?,?,2026,'24',?,'daily',?,'issued',?,'t','t')`).run(id, r.register_id, seq, text, date);
    expect(err(() => ins('x', 1, 'lain'))).toContain('UNIQUE');
    expect(err(() => ins('y', 50, r.number_text))).toContain('UNIQUE');
    expect(err(() => ins('z', 1, '2401', '2026-11-25'))).toBe('NO_ERROR'); // tanggal lain boleh
  });
  it('batas 99 per kategori per tanggal: nomor ke-100 ditolak tanpa memotong/menimpa', () => {
    const rid = reg('SURAT_KELUAR').id;
    for (let i = 1; i <= 99; i++) expect(res('SURAT_KELUAR', '2026-11-24').seq).toBe(i);
    const n = suggestNext(db, rid, '2026-11-24');
    expect(n.full).toBe(true); expect(n.preview).toBeNull(); expect(n.remaining).toBe(0);
    expect(err(() => res('SURAT_KELUAR', '2026-11-24'))).toContain('LIMIT');
    expect(err(() => createManual(db, admin, { register_id: rid, number_date: '2026-11-24' }))).toContain('LIMIT');
    expect(queryRecords(db, { register_id: rid }).total).toBe(99);
    expect(res('SURAT_KELUAR', '2026-11-25').number_text).toBe('2501'); // tanggal lain tidak terpengaruh
    expect(res('NOTA_DINAS', '2026-11-24').number_text).toBe('2401'); // kategori lain tidak terpengaruh
    updateRegister(db, admin, rid, { seq_length: 3 }, 'perpanjang format');
    expect(res('SURAT_KELUAR', '2026-11-24').number_text).toBe('24100'); // nomor lama tidak berubah; urut ke-100 setelah format diperluas
  });
});

describe('migrasi v6 & konkurensi', () => {
  it('upgrade v5→v6: nomor/tanggal lama utuh (legacy), anak tabel terjaga, urutan harian baru lanjut benar', () => {
    const old = openDatabase(':memory:');
    for (const m of MIGRATIONS.filter((x) => x.version <= 5)) old.exec(m.sql);
    old.pragma('user_version = 5');
    const rid = (old.prepare("SELECT id FROM number_registers WHERE code='BERITA_ACARA'").get() as { id: string }).id;
    const ins = old.prepare("INSERT INTO number_records (id,register_id,year,seq,number_text,status,number_date,subject,created_at,updated_at,source) VALUES (?,?,?,?,?,?,?,?,'t','t','import')");
    ins.run('o1', rid, 2025, 17, '17/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', 'issued', '2025-11-24', 'Lama A');
    ins.run('o2', rid, 2025, 18, '18/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', 'cancelled', '2025-11-24', 'Lama B');
    ins.run('o3', rid, 2025, 19, '19/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', 'reserved', '2025-11-24', 'Dipesan tanpa dokumen');
    old.prepare("INSERT INTO documents (id, title, status, content_json, layout_json, created_at, updated_at) VALUES ('dx','Dok','draft','{}','{}','t','t')").run();
    ins.run('o4', rid, 2025, 20, '20/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', 'reserved', '2025-11-24', 'Dipesan dengan dokumen');
    old.prepare("UPDATE number_records SET document_id='dx' WHERE id='o4'").run();
    old.prepare("INSERT INTO number_events (id,record_id,register_id,event,actor_name,at,detail_json) VALUES ('e1','o1',?,'imported','Admin','t','{}')").run(rid);
    expect(runMigrations(old)).toBe(LATEST_SCHEMA);
    const rows = old.prepare("SELECT id, seq, legacy_seq, seq_scheme, number_text, number_date, day, year, status, legacy_review lr FROM number_records ORDER BY id").all() as any[];
    expect(rows.map((r) => [r.id, r.seq, r.legacy_seq, r.seq_scheme, r.number_text, r.number_date, r.day, r.year, r.status, r.lr])).toEqual([
      ['o1', null, 17, 'legacy', '17/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', '2025-11-24', '24', 2025, 'issued', 0],
      ['o2', null, 18, 'legacy', '18/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', '2025-11-24', '24', 2025, 'void', 0],
      ['o3', null, 19, 'legacy', '19/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', '2025-11-24', '24', 2025, 'available', 1], // tidak diasumsikan tersedia: menunggu tinjauan admin
      ['o4', null, 20, 'legacy', '20/BA/PPK.6/BAKTI.31.9/KOMDIGI/11/2025', '2025-11-24', '24', 2025, 'assigned', 0]]);
    expect((old.prepare('SELECT COUNT(*) n FROM number_events').get() as { n: number }).n).toBe(1);
    expect(getRegister(old, rid).format).toBe('{DAY2}{SEQUENCE}');
    expect((old.prepare("SELECT COUNT(*) n FROM number_register_config_history WHERE changed_by_name='Migrasi v6'").get() as { n: number }).n).toBe(4);
    const a = listUsers(old)[0]; const act: Actor = { id: a.id, name: a.name, role: 'admin' };
    const r = generateBatch(old, act, { register_id: rid, number_date: '2025-11-24', quantity: 1 }).records[0];
    expect(r.number_text).toBe('2401'); // nomor lama tidak memengaruhi urutan harian
    expect(err(() => old.prepare("UPDATE number_records SET number_text='x' WHERE id='o1'").run())).toContain('tidak dapat diubah');
    expect(err(() => old.prepare("DELETE FROM number_records WHERE id='o1'").run())).toContain('tidak boleh dihapus');
    old.close();
  });
  it('dua koneksi pada berkas yang sama: tidak ada nomor ganda', async () => {
    const { mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
    const f = join(mkdtempSync(join(tmpdir(), 'nd-')), 'x.db');
    const d1 = openDatabase(f); runMigrations(d1); seedDefaults(d1); ensureDefaultMappings(d1);
    const d2 = openDatabase(f);
    const a = listUsers(d1)[0]; const act: Actor = { id: a.id, name: a.name, role: 'admin' };
    const rid = getRegister(d1, 'SURAT_KELUAR').id;
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) { const r = generateBatch(i % 2 ? d2 : d1, act, { register_id: rid, number_date: '2026-11-24', quantity: 1 }).records[0]; expect(seen.has(r.number_text)).toBe(false); seen.add(r.number_text); }
    expect(seen.size).toBe(40); expect([...seen][39]).toBe('2440');
    d1.close(); d2.close();
  });
});

describe('alur status & audit', () => {
  it('AVAILABLE → ASSIGNED → ISSUED dengan riwayat', () => {
    const r = res('SURAT_KELUAR', '2026-04-01', { subject: 'Undangan rapat', counterparty: 'PT A' });
    expect(r.status).toBe('assigned'); expect(r.creator).toBe('Budi'); expect(r.assigned_by).toBe('Budi');
    const i = issueNumber(db, op, r.id);
    expect(i.status).toBe('issued');
    expect(recordEvents(db, r.id).map((e) => e.event)).toEqual(['generated', 'assigned', 'edited', 'issued']);
  });
  it('ASSIGNED → release → AVAILABLE; draf yang dibatalkan tidak membatalkan nomor', () => {
    const r = res('SURAT_KELUAR', '2026-04-01');
    const x = releaseNumber(db, op, r.id, 'draf dibatalkan');
    expect(x.status).toBe('available'); expect(x.assigned_by).toBeNull(); expect(x.document_id).toBeNull(); expect(x.released_count).toBe(1);
    expect(recordEvents(db, r.id).map((e) => e.event)).toEqual(['generated', 'assigned', 'released']);
    expect(listAudit(db, { action: 'number.release' })).toHaveLength(1);
  });
  it('VOID: hanya admin, konfirmasi + alasan, pelaku tercatat, final', () => {
    const b = generateBatch(db, op, { register_id: reg('SURAT_KELUAR').id, number_date: '2026-04-01', quantity: 2 }).records;
    expect(err(() => voidNumber(db, op, b[0].id, 'alasan', true))).toContain('FORBIDDEN');
    expect(err(() => voidNumber(db, admin, b[0].id, ' ', true))).toContain('INVALID');
    expect(err(() => voidNumber(db, admin, b[0].id, 'salah cetak', false))).toContain('NEEDS_CONFIRMATION');
    const v = voidNumber(db, admin, b[0].id, 'salah cetak', true);
    expect(v.status).toBe('void'); expect(v.void_reason).toBe('salah cetak'); expect(v.voided_by).toBe('Administrator'); expect(v.voided_at).toBeTruthy();
    expect(recordEvents(db, v.id).map((e) => e.event)).toEqual(['generated', 'voided']);
    expect(listAudit(db, { action: 'number.void' })).toHaveLength(1);
    expect(err(() => assignNumber(db, op, v.id))).toContain('STATE');
    expect(err(() => db.prepare("UPDATE number_records SET status='available' WHERE id=?").run(v.id))).toContain('Transisi status');
    const a = assignNumber(db, op, b[1].id);
    expect(err(() => voidNumber(db, admin, a.id, 'paksa', true))).toContain('STATE'); // sedang dipakai draf: lepas dulu
  });
  it('transisi terlarang ditolak aplikasi dan trigger DB; nomor terbit final', () => {
    const r = issueNumber(db, op, res('SURAT_KELUAR', '2026-04-01').id);
    expect(err(() => releaseNumber(db, admin, r.id, 'coba'))).toContain('STATE');
    expect(err(() => voidNumber(db, admin, r.id, 'coba void terbit', true))).toContain('STATE');
    expect(err(() => assignNumber(db, op, r.id))).toContain('STATE');
    expect(err(() => db.prepare("UPDATE number_records SET status='void' WHERE id=?").run(r.id))).toContain('Transisi status');
    expect(err(() => db.prepare("UPDATE number_records SET status='available' WHERE id=?").run(r.id))).toContain('Transisi status');
  });
  it('tidak dapat dihapus permanen; nomor/tanggal terkunci', () => {
    const r = res('SURAT_KELUAR', '2026-04-01');
    expect(err(() => db.prepare('DELETE FROM number_records WHERE id=?').run(r.id))).toContain('tidak boleh dihapus');
    expect(err(() => db.prepare("UPDATE number_records SET number_date='2026-04-09' WHERE id=?").run(r.id))).toContain('tidak dapat diubah');
  });
  it('dokumen yang sama tidak boleh memegang dua nomor pada satu register', () => {
    mkDoc('d2');
    res('BERITA_ACARA', '2026-04-01', { document_id: 'd2' });
    expect(err(() => res('BERITA_ACARA', '2026-04-01', { document_id: 'd2' }))).toContain('sudah memiliki nomor');
  });
});

describe('otorisasi', () => {
  it('operator lain tidak dapat menerbitkan/membatalkan/mengubah', () => {
    const r = res('BERITA_ACARA', '2026-04-01');
    expect(err(() => issueNumber(db, op2, r.id))).toContain('FORBIDDEN');
    expect(err(() => releaseNumber(db, op2, r.id, 'iseng'))).toContain('FORBIDDEN');
    expect(err(() => updateMeta(db, op2, r.id, { subject: 'x' }))).toContain('FORBIDDEN');
    expect(issueNumber(db, admin, r.id).status).toBe('issued');
  });
  it('konfigurasi, pengguna, nomor awal: admin saja', () => {
    expect(err(() => updateRegister(db, op, reg('NOTA_DINAS').id, { initial_sequence: 5 }))).toContain('FORBIDDEN');
    expect(err(() => setNextSequence(db, op, reg('NOTA_DINAS').id, '2026-01-05', 5))).toContain('FORBIDDEN');
    expect(err(() => createUser(db, op, { name: 'X', role: 'admin' }))).toContain('FORBIDDEN');
    expect(err(() => createManual(db, op, { register_id: reg('NOTA_DINAS').id, number_date: '2026-01-01', seq: 9 }))).toContain('FORBIDDEN');
  });
  it('minimal satu admin aktif; PIN diverifikasi', () => {
    expect(err(() => updateUser(db, admin, admin.id, { is_active: false }))).toContain('minimal satu administrator');
    setPin(db, admin, op.id, '1234');
    expect(err(() => authenticate(db, op.id, '0000'))).toContain('PIN salah');
    expect(authenticate(db, op.id, '1234').id).toBe(op.id);
    expect(err(() => setPin(db, op2, op.id, '9999'))).toContain('FORBIDDEN');
    expect(err(() => setPin(db, admin, op.id, '12'))).toContain('4–12');
  });
  it('operator mengubah metadata sendiri; nomor tetap', () => {
    const r = res('BERITA_ACARA', '2026-04-01');
    const u = updateMeta(db, op, r.id, { subject: 'Perihal baru', counterparty: 'PT B', notes: 'cat' });
    expect(u.subject).toBe('Perihal baru'); expect(u.number_text).toBe(r.number_text);
    expect(err(() => updateMeta(db, op, r.id, { creator: 'Orang lain' }))).toContain('FORBIDDEN');
    expect(recordEvents(db, r.id).map((e) => e.event)).toEqual(['generated', 'assigned', 'edited']);
  });
});

describe('konfigurasi & nomor awal', () => {
  it('riwayat konfigurasi; nomor terbit lama tidak berubah', () => {
    const r = issueNumber(db, op, res('BERITA_ACARA', '2026-04-01').id);
    updateRegister(db, admin, reg('BERITA_ACARA').id, { format: '{SEQUENCE}/BA-BARU/{YEAR}', seq_length: 3 }, 'format baru');
    const h = configHistory(db, reg('BERITA_ACARA').id);
    expect(h).toHaveLength(2); expect(h[0].reason).toBe('format baru'); expect(h[0].changed_by_name).toBe('Administrator'); expect(h[1].changed_by_name).toBe('Migrasi v6');
    expect(getRecord(db, r.id).number_text).toBe(r.number_text);
    expect(res('BERITA_ACARA', '2026-05-01').number_text).toBe('001/BA-BARU/2026');
  });
  it('format tidak valid ditolak; tanpa perubahan tidak mencatat riwayat', () => {
    expect(err(() => updateRegister(db, admin, reg('BERITA_ACARA').id, { format: 'abc' }))).toContain('SEQUENCE');
    updateRegister(db, admin, reg('BERITA_ACARA').id, { name: 'Berita Acara' });
    expect(configHistory(db, reg('BERITA_ACARA').id)).toHaveLength(1); // hanya baris migrasi v6
  });
  it('setNextSequence: lompat/tabrakan/konfirmasi per tanggal', () => {
    const rid = reg('BERITA_ACARA').id;
    res('BERITA_ACARA', '2026-01-01'); res('BERITA_ACARA', '2026-01-01');
    expect(err(() => setNextSequence(db, admin, rid, '2026-01-01', 2))).toContain('COLLISION');
    expect(err(() => setNextSequence(db, admin, rid, '2026-01-01', 10))).toContain('NEEDS_CONFIRMATION');
    expect(err(() => setNextSequence(db, admin, rid, '2026-01-01', 100, true))).toContain('LIMIT');
    expect(setNextSequence(db, admin, rid, '2026-01-01', 10, true).suggested).toBe(10);
    expect(res('BERITA_ACARA', '2026-01-01').number_text).toBe('0110');
    expect(setNextSequence(db, admin, rid, '2030-01-01', 1).suggested).toBe(1);
    expect(err(() => setNextSequence(db, op, rid, '2026-01-01', 50))).toContain('FORBIDDEN');
    expect(listAudit(db, { action: 'counter.set' }).length).toBe(2);
  });
  it('celah nomor terdeteksi pada tanggal tertentu', () => {
    const rid = reg('BERITA_ACARA').id;
    createManual(db, admin, { register_id: rid, number_date: '2026-01-02', seq: 1 });
    createManual(db, admin, { register_id: rid, number_date: '2026-01-02', seq: 4 });
    const n = suggestNext(db, rid, '2026-01-02');
    expect(n.gaps).toEqual([2, 3]); expect(n.suggested).toBe(5); expect(n.requires_confirmation).toBe(true);
    expect(suggestNext(db, rid, '2026-01-03').gaps).toEqual([]);
    expect(err(() => suggestNext(db, rid, '2026-13-40'))).toContain('INVALID');
  });
});

describe('pencatatan manual & daftar', () => {
  it('manual dari nomor lengkap: parse sesuai format, tolak duplikat; nomor tak cocok dicatat sebagai lama', () => {
    const rid = reg('BERITA_ACARA').id;
    const m = createManual(db, admin, { register_id: rid, number_date: '2026-03-10', number_text: '1012' });
    expect(m.creator).toBe('Administrator');
    expect(createManual(db, op, { register_id: rid, number_date: '2026-03-11', creator: 'Siti (Biro Umum)' }).creator).toBe('Siti (Biro Umum)');
    expect(m.seq).toBe(12); expect(m.seq_scheme).toBe('daily'); expect(m.status).toBe('issued'); expect(m.source).toBe('manual');
    expect(res('BERITA_ACARA', '2026-03-10').number_text).toBe('1013');
    expect(err(() => createManual(db, admin, { register_id: rid, number_date: '2026-03-10', number_text: '1012' }))).toContain('COLLISION');
    const old = createManual(db, admin, { register_id: rid, number_date: '2026-03-10', number_text: '77/BA/PPK.6/BAKTI.31.9/KOMDIGI/3/2026' });
    expect(old.seq_scheme).toBe('legacy'); expect(old.number_text).toBe('77/BA/PPK.6/BAKTI.31.9/KOMDIGI/3/2026');
    expect(res('BERITA_ACARA', '2026-03-10').number_text).toBe('1014'); // nomor lama tidak memengaruhi urutan harian
    expect(err(() => createManual(db, op, { register_id: rid, number_date: '2026-03-10', number_text: '1020' }))).toContain('FORBIDDEN');
  });
  it('pencarian, filter, urut, halaman', () => {
    const rid = reg('SURAT_KELUAR').id;
    for (let i = 1; i <= 7; i++) res('SURAT_KELUAR', `2026-0${i}-10`, { subject: i % 2 ? 'Undangan' : 'Permohonan', counterparty: i < 4 ? 'PT Satelindo' : 'PT Lain' });
    expect(queryRecords(db, { register_id: rid }).total).toBe(7);
    expect(queryRecords(db, { register_id: rid, search: 'satelindo' }).total).toBe(3);
    expect(queryRecords(db, { register_id: rid, subject: 'Permohonan' }).total).toBe(3);
    expect(queryRecords(db, { register_id: rid, date_from: '2026-03-01', date_to: '2026-05-31' }).total).toBe(3);
    const p = queryRecords(db, { register_id: rid, sort: 'seq', dir: 'asc', page: 2, page_size: 3 });
    expect(p.rows.map((r) => r.number_date)).toEqual(['2026-04-10', '2026-05-10', '2026-06-10']);
    expect(queryRecords(db, { register_id: rid, status: 'issued' }).total).toBe(0);
  });
  it('ringkasan dashboard & rujukan', () => {
    const k = issueNumber(db, op, res('KONTRAK', '2026-02-02', { subject: 'Kontrak X', counterparty: 'PT K' }).id);
    res('BERITA_ACARA', '2026-02-03'); releaseNumber(db, op, res('BERITA_ACARA', '2026-02-04').id, 'batal');
    const s = summaries(db, 2026);
    expect(s.find((x) => x.register.code === 'KONTRAK')!.issued).toBe(1);
    const ba = s.find((x) => x.register.code === 'BERITA_ACARA')!;
    expect([ba.assigned, ba.available, ba.void, ba.year_total]).toEqual([1, 1, 0, 2]);
    expect(searchReferenceable(db, k.register_id, 'Kontrak X')).toHaveLength(1);
    mkDoc('d3');
    addRef(db, 'd3', k.id, 'NOMOR_KONTRAK');
    expect(db.prepare('SELECT COUNT(*) n FROM number_records').get()).toEqual({ n: 3 });
  });
});
