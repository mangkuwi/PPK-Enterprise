import { describe, expect, it } from 'vitest';
import { openDatabase } from '../electron/main/db';
import { runMigrations } from '../electron/main/migrations';
import { seedDefaults } from '../electron/main/seed';
import { sqliteStore } from '../electron/main/ppk/store';
import { relatedDocuments } from '../electron/main/ppk/documents';
import { docNumberKey } from '@shared/ppk/documents';
import type { Actor } from '@shared/numbering';

describe('dokumen NASKAHDINAS terkait', () => {
  it('cocok lewat nomor surat atau Bank Nomor, abaikan spasi, huruf, dan "tanggal ..."', async () => {
    expect(docNumberKey('0505/BA.PPK.3 tanggal 05 Maret 2026')).toBe('0505/BA.PPK.3');
    const db = openDatabase(':memory:'); runMigrations(db); seedDefaults(db); const s = sqliteStore(db);
    const admin = db.prepare("SELECT id, name, role FROM app_users WHERE role='admin'").get() as Actor;
    const ts = '2026-03-05T00:00:00Z';
    const doc = (id: string, title: string, letter: string, date: string) => db.prepare(`INSERT INTO documents (id, title, letter_number, doc_date, content_json, layout_json, created_at, updated_at)
      VALUES (?,?,?,?,'{}','{}',?,?)`).run(id, title, letter, date, ts, ts);
    doc('d1', 'BA Pembayaran Maret', '0505/BA.PPK.3/BAKTI', '2026-03-05');
    doc('d2', 'Kontrak IP Transit', '', '2026-01-14');
    doc('d3', 'Lain', 'X-1', '2026-01-01');
    const reg = (db.prepare("SELECT id FROM number_registers WHERE code='KONTRAK'").get() as { id: string }).id;
    db.prepare(`INSERT INTO number_records (id, register_id, year, number_text, status, number_date, document_id, created_at, updated_at)
      VALUES ('n1', ?, 2026, '1402/PKS/PPK.2', 'issued', '2026-01-14', 'd2', ?, ?)`).run(reg, ts, ts);
    const r = await relatedDocuments(s, admin, ['0505/ba.ppk.3/bakti tanggal 05 Maret 2026', '1402/PKS/PPK.2', '']);
    expect(r.map((d) => [d.document_id, d.register_name])).toEqual([['d1', ''], ['d2', 'Kontrak']]);
  });
});
