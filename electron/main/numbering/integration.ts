/** Integrasi penomoran ↔ pembuatan dokumen. Semua keputusan nomor diambil di sisi server (main); renderer/AI tidak pernah membentuk nomor resmi. */
import type { DB } from '../db';
import type { Actor, NumberRecord, NumberRef, NumberingContext } from '@shared/numbering';
import { NumberingError } from './errors';
import { registerForTemplate, listRegisters } from './registers';
import { addRef, assignNumber, clearRefs, getRecord, issueNumber, linkDocument, recordForDocument, refsForDocument, releaseNumber } from './records';
import { audit } from './audit';
import { nowIso } from './clock';

const DATE_KEYS = ['TANGGAL_SURAT', 'TANGGAL', 'TANGGAL_NOTA_DINAS', 'TANGGAL_BA', 'TANGGAL_KONTRAK'];
const PARTY_KEYS = ['PIHAK', 'PIHAK_KEDUA', 'TUJUAN_SURAT', 'KEPADA', 'PENYEDIA'];

const fieldKeys = (db: DB, templateId: string) => (db.prepare('SELECT key FROM template_fields WHERE template_id=?').all(templateId) as { key: string }[]).map((r) => r.key);

export function contextForTemplate(db: DB, templateId: string): NumberingContext {
  const reg = registerForTemplate(db, templateId);
  if (!reg) return { register: null, own_keys: [], date_key: null, party_key: null, ref_fields: [] };
  const keys = fieldKeys(db, templateId); const have = new Set(keys);
  const own = reg.placeholder_keys.filter((k) => have.has(k));
  const ownSet = new Set(reg.placeholder_keys);
  const refs = listRegisters(db).filter((r) => r.id !== reg.id && r.is_active).map((r) => ({ key: r.placeholder_keys[0], register_id: r.id, register_name: r.name }))
    .filter((r) => r.key && have.has(r.key) && !ownSet.has(r.key));
  return { register: reg, own_keys: own, date_key: DATE_KEYS.find((k) => have.has(k)) ?? null, party_key: PARTY_KEYS.find((k) => have.has(k)) ?? null, ref_fields: refs };
}

/**
 * Memilih nomor dari bank untuk draf yang sedang dibuat. Tidak pernah membuat nomor baru.
 * Bila `previousId` diberikan (ganti pilihan), nomor lama dilepas ke AVAILABLE dan nomor baru ditugaskan dalam satu transaksi.
 */
export function selectNumber(db: DB, actor: Actor, templateId: string, recordId: string, previousId?: string | null): NumberRecord {
  const ctx = contextForTemplate(db, templateId);
  if (!ctx.register) throw new NumberingError('INVALID', 'Template ini tidak terhubung ke register penomoran.');
  return db.transaction(() => {
    const rec = getRecord(db, recordId);
    if (rec.register_id !== ctx.register!.id) throw new NumberingError('INVALID', `Nomor ${rec.number_text} berasal dari register lain, bukan ${ctx.register!.name}.`);
    if (previousId && previousId !== recordId) {
      const prev = getRecord(db, previousId);
      if (prev.document_id) throw new NumberingError('LINKED', `Nomor ${prev.number_text} sudah tertaut ke dokumen tersimpan dan tidak dapat diganti dari formulir ini.`);
      // Nomor baru divalidasi lebih dulu agar nomor lama tidak terlepas bila pilihan baru gagal (transaksi ini juga akan membatalkan keduanya).
      const assigned = assignNumber(db, actor, recordId);
      releaseNumber(db, actor, previousId, `Diganti dengan nomor ${assigned.number_text}`);
      return getRecord(db, recordId);
    }
    return assignNumber(db, actor, recordId);
  }).immediate();
}

/** Formulir pembuatan ditinggalkan tanpa menyimpan dokumen: nomor kembali AVAILABLE (tidak dibatalkan). Nomor yang sudah tertaut dokumen tidak disentuh. */
export function releaseDraft(db: DB, actor: Actor, recordId: string, reason = 'Pembuatan dokumen dibatalkan'): NumberRecord {
  const r = getRecord(db, recordId);
  if (r.status !== 'assigned' || r.document_id) return r;
  return releaseNumber(db, actor, recordId, reason);
}

export type RefInput = NumberRef;
export interface Applied { values: Record<string, string>; record: NumberRecord; refs: Array<{ key: string; record: NumberRecord }> }

/** Menimpa isian bernomor/tanggal dengan data resmi dari register. Nilai dari klien untuk kunci tersebut diabaikan. */
export function applyToValues(db: DB, templateId: string, recordId: string, values: Record<string, string>, refs: RefInput[], opts: { documentId?: string } = {}): Applied {
  const ctx = contextForTemplate(db, templateId);
  if (!ctx.register) throw new NumberingError('INVALID', 'Template ini tidak terhubung ke register penomoran.');
  const record = getRecord(db, recordId);
  if (record.register_id !== ctx.register.id) throw new NumberingError('INVALID', `Nomor ${record.number_text} berasal dari register lain, bukan ${ctx.register.name}.`);
  if (record.status === 'void') throw new NumberingError('STATE', `Nomor ${record.number_text} berstatus VOID dan tidak dapat dipakai.`);
  if (record.status === 'available') throw new NumberingError('STATE', `Nomor ${record.number_text} belum dipilih untuk draf ini. Pilih nomor dari Bank Nomor Dokumen.`);
  if (record.status === 'issued' && record.document_id !== opts.documentId) throw new NumberingError('STATE', `Nomor ${record.number_text} sudah terbit dan tidak dapat dipakai ulang.`);
  if (record.document_id && record.document_id !== opts.documentId) throw new NumberingError('LINKED', `Nomor ${record.number_text} sudah terhubung ke dokumen lain.`);
  const out = { ...values };
  for (const k of ctx.own_keys) out[k] = record.number_text;
  if (ctx.date_key) out[ctx.date_key] = record.number_date;
  const used: Applied['refs'] = [];
  const allowed = new Map(ctx.ref_fields.map((f) => [f.key, f]));
  for (const r of refs) {
    const f = allowed.get(r.key);
    if (!f) throw new NumberingError('INVALID', `Kolom ${r.key} bukan kolom rujukan nomor pada template ini.`);
    const rec = getRecord(db, r.record_id);
    if (rec.register_id !== f.register_id) throw new NumberingError('INVALID', `Nomor ${rec.number_text} bukan dari register ${f.register_name}.`);
    if (rec.status === 'void' || rec.status === 'available') throw new NumberingError('STATE', `Nomor ${rec.number_text} (${rec.status === 'void' ? 'VOID' : 'belum dipakai'}) tidak dapat dirujuk.`);
    out[r.key] = rec.number_text; used.push({ key: r.key, record: rec });
  }
  return { values: out, record, refs: used };
}

/** Menghubungkan nomor dengan dokumen yang sudah tersimpan: tautan, letter_number, tanggal, pihak/perihal, rujukan. Dipanggil dalam transaksi penyimpanan. */
export function bindDocument(db: DB, actor: Actor, a: { record_id: string; document_id: string; values: Record<string, string>; /** undefined = rujukan tidak diubah (penyimpanan biasa) */ refs?: RefInput[]; template_id: string | null }): { record: NumberRecord; in_content: boolean } {
  return db.transaction(() => {
    const doc = db.prepare('SELECT id, title, subject, recipient, content_text, status FROM documents WHERE id=?').get(a.document_id) as any;
    if (!doc) throw new NumberingError('NOT_FOUND', 'Dokumen tidak ditemukan.');
    let rec = getRecord(db, a.record_id);
    const existing = recordForDocument(db, a.document_id, rec.register_id);
    if (existing && existing.id !== rec.id) throw new NumberingError('LINKED', `Dokumen ini sudah memiliki nomor ${existing.number_text}. Nomor tidak dapat diganti setelah dokumen dibuat.`);
    if (rec.status === 'void' || rec.status === 'available') throw new NumberingError('STATE', `Nomor ${rec.number_text} berstatus ${rec.status === 'void' ? 'VOID' : 'tersedia (belum dipilih)'} dan tidak dapat ditautkan ke dokumen.`);
    if (rec.document_id !== a.document_id) linkDocument(db, actor, rec.id, a.document_id);
    const ctx = a.template_id ? contextForTemplate(db, a.template_id) : null;
    const party = (ctx?.party_key && a.values[ctx.party_key]) || a.values.PIHAK || doc.recipient || '';
    const subject = a.values.PERIHAL || doc.subject || doc.title || '';
    db.prepare('UPDATE number_records SET subject=CASE WHEN subject=\'\' THEN ? ELSE subject END, counterparty=CASE WHEN counterparty=\'\' THEN ? ELSE counterparty END, updated_at=? WHERE id=?')
      .run(String(subject).slice(0, 500), String(party).slice(0, 300), nowIso(), rec.id);
    db.prepare('UPDATE documents SET letter_number=?, doc_date=? WHERE id=?').run(rec.number_text, rec.number_date, a.document_id);
    if (a.refs) { clearRefs(db, a.document_id); for (const r of a.refs) addRef(db, a.document_id, r.record_id, r.key); }
    if (doc.status === 'final' && rec.status === 'assigned') issueNumber(db, actor, rec.id, { document_id: a.document_id });
    rec = getRecord(db, rec.id);
    audit(db, actor, 'number.bind', 'document', a.document_id, { number: rec.number_text, register: rec.register_code, refs: a.refs?.length ?? null });
    return { record: rec, in_content: String(doc.content_text ?? '').includes(rec.number_text) };
  })();
}

/** Dokumen difinalkan → nomor terbit. Kembali ke draft tidak membatalkan nomor yang telah terbit. */
export function onDocumentStatus(db: DB, actor: Actor, docId: string, status: 'draft' | 'review' | 'final'): NumberRecord | null {
  if (status !== 'final') return null;
  const rec = recordForDocument(db, docId);
  if (!rec || rec.status !== 'assigned') return rec;
  return issueNumber(db, actor, rec.id, { document_id: docId });
}

/** Sebelum dokumen dihapus: nomor yang masih dipakai draf KEMBALI AVAILABLE (bukan dibatalkan/void); nomor terbit tetap tercatat. */
export function onDocumentDeleting(db: DB, actor: Actor, docId: string): void {
  const rows = db.prepare("SELECT id FROM number_records WHERE document_id=? AND status='assigned'").all(docId) as { id: string }[];
  for (const r of rows) releaseNumber(db, null, r.id, 'Dokumen draf dihapus; nomor dikembalikan ke bank nomor');
  if ((db.prepare("SELECT COUNT(*) n FROM number_records WHERE document_id=? AND status='issued'").get(docId) as { n: number }).n) {
    audit(db, actor, 'document.delete_issued', 'document', docId, { note: 'Dokumen bernomor terbit dihapus; catatan nomor dipertahankan.' });
  }
}

/** Data yang wajib dipaksakan saat dokumen dibuat ulang (regenerate): nomor & rujukan tertaut. */
export function forcedValuesForDocument(db: DB, docId: string, templateId: string, values: Record<string, string>): Record<string, string> {
  const rec = recordForDocument(db, docId);
  if (!rec) return values;
  const refs = refsForDocument(db, docId).map((x) => ({ key: x.key, record_id: x.record.id }));
  return applyToValues(db, templateId, rec.id, values, refs, { documentId: docId }).values;
}

export function documentNumbering(db: DB, docId: string): { record: NumberRecord | null; refs: Array<{ key: string; record: NumberRecord }> } {
  return { record: recordForDocument(db, docId), refs: refsForDocument(db, docId) };
}
