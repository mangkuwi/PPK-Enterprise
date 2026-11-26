import type { Actor } from '@shared/numbering';
import { docNumberKey, type RelatedDocument } from '@shared/ppk/documents';
import type { PpkStore } from './store';
import { requirePpk } from './access';

/**
 * Dokumen NASKAHDINAS yang memakai nomor kontrak/BA/tagihan ini: lewat nomor di Bank Nomor yang tertaut ke dokumen,
 * atau nomor surat di dokumen. Hanya membaca tabel dokumen/penomoran; tidak ada tautan yang disimpan.
 * `docs` = SQLite lokal (dokumen tidak pindah ke server); izin dicek di store PPK aktif.
 */
// shortcut: pencocokan nomor dengan pindai semua dokumen bernomor dan perbandingan di JS; pindah ke kolom kunci berindeks bila dokumen > ~50 ribu.
export async function relatedDocuments(s: PpkStore, docs: PpkStore, actor: Actor, numbers: string[]): Promise<RelatedDocument[]> {
  await requirePpk(s, actor, 'read');
  const keys = new Set(numbers.map(docNumberKey).filter((k) => k.length >= 3));
  if (!keys.size) return [];
  const rows = await docs.all<RelatedDocument>(`
    SELECT d.id AS document_id, d.title, d.status, d.doc_date, n.number_text, r.name AS register_name
      FROM number_records n JOIN documents d ON d.id = n.document_id JOIN number_registers r ON r.id = n.register_id
     WHERE n.status <> 'void'
    UNION
    SELECT d.id AS document_id, d.title, d.status, d.doc_date, d.letter_number AS number_text, '' AS register_name
      FROM documents d WHERE d.letter_number <> ''`);
  const seen = new Set<string>();
  return rows.filter((r) => keys.has(docNumberKey(r.number_text)) && !seen.has(r.document_id) && seen.add(r.document_id))
    .sort((a, b) => b.doc_date.localeCompare(a.doc_date));
}
