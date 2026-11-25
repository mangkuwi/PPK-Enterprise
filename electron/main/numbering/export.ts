import type { DB } from '../db';
import type { NumberRecord, RecordQuery } from '@shared/numbering';
import { RECORD_COLUMNS, STATUS_LABEL } from '@shared/numbering';
import { getRegister } from './registers';
import { allRecords } from './records';
import { writeXlsx } from './xlsx';

const MONTH_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const statusOf = (r: NumberRecord) => STATUS_LABEL[r.status];
const row = (r: NumberRecord): Array<string | number | null> => [
  r.number_date, MONTH_ID[Number(r.number_date.slice(5, 7)) - 1], r.seq, r.number_text, r.counterparty, r.subject, r.notes, r.creator, statusOf(r)
];

/** Ekspor register ke XLSX dengan kolom yang sama dengan format impor (dapat diimpor ulang). */
export function exportRegisterXlsx(db: DB, q: RecordQuery): Buffer {
  const reg = getRegister(db, q.register_id);
  const rows = allRecords(db, { ...q, sort: q.sort ?? 'seq', dir: q.dir ?? 'asc' });
  return writeXlsx([{ name: reg.name, header: [...RECORD_COLUMNS], rows: rows.map(row), widths: [6, 12, 8, 46, 28, 44, 28, 18, 14] }]);
}

const h = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** HTML siap cetak untuk diubah menjadi PDF oleh renderPdf (Electron). */
export function registerHtml(db: DB, q: RecordQuery): string {
  const reg = getRegister(db, q.register_id);
  const rows = allRecords(db, { ...q, sort: q.sort ?? 'seq', dir: q.dir ?? 'asc' });
  const filt = [q.year && `Tahun ${q.year}`, q.status && `Status ${STATUS_LABEL[q.status]}`, q.search && `Cari “${q.search}”`, q.date_from && `Dari ${q.date_from}`, q.date_to && `Sampai ${q.date_to}`].filter(Boolean).join(' · ');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:A4 landscape;margin:12mm}body{font-family:Arial,sans-serif;font-size:9pt;color:#111}h1{font-size:14pt;margin:0 0 2px}p{margin:0 0 8px;color:#444}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:3px 5px;vertical-align:top}th{background:#e8edf5}tr{page-break-inside:avoid}.c{text-align:center}</style></head><body>
<h1>Register ${h(reg.name)}</h1><p>${h(filt || 'Semua data')} · ${rows.length} catatan · dicetak ${h(new Date().toLocaleString('id-ID'))}</p>
<table><thead><tr><th>No</th><th>Tanggal</th><th>Nomor</th><th>Pihak</th><th>Perihal</th><th>Keterangan</th><th>Pembuat</th><th>Status</th></tr></thead><tbody>
${rows.map((r, i) => `<tr><td class="c">${i + 1}</td><td>${h(r.number_date)}</td><td>${h(r.number_text)}</td><td>${h(r.counterparty)}</td><td>${h(r.subject)}</td><td>${h(r.notes)}</td><td>${h(r.creator)}</td><td>${h(statusOf(r))}</td></tr>`).join('')}
</tbody></table></body></html>`;
}
