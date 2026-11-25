export interface RelatedDocument { document_id: string; title: string; status: string; doc_date: string; number_text: string; register_name: string }
/** Nomor dibandingkan tanpa spasi dan huruf besar/kecil; bagian " tanggal ..." diabaikan. */
export const docNumberKey = (n: string) => n.replace(/\s+tanggal\s.*$/i, '').replace(/\s+/g, '').toUpperCase();
