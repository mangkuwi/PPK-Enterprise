/** Mesin penomoran harian: kunci urutan = register (kategori) + tanggal dokumen lengkap. Nomor DDSS: DD = hari, SS = urut harian 01–99. */
import type { DB } from '../db';
import type { Actor, NextInfo, Register } from '@shared/numbering';
import { formatLabel, maxSeqFor, renderNumber, yearOf } from '@shared/numbering';
import { NumberingError } from './errors';
import { requireAdmin } from './users';
import { audit } from './audit';
import { nowIso } from './clock';
import { getRegister } from './registers';

const MAX_GAPS = 500;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

interface Agg { n: number; mx: number | null; imported: number }
/** Hanya catatan berskema harian yang menentukan urutan; catatan lama (legacy) dipertahankan tanpa memengaruhi urutan. */
function agg(db: DB, registerId: string, date: string): Agg {
  return db.prepare(`SELECT COUNT(*) n, MAX(seq) mx, SUM(source='import') imported FROM number_records WHERE register_id=? AND number_date=? AND seq_scheme='daily'`).get(registerId, date) as Agg;
}
export function gapsOf(db: DB, registerId: string, date: string, from = 1): number[] {
  const seqs = (db.prepare("SELECT seq FROM number_records WHERE register_id=? AND number_date=? AND seq_scheme='daily' ORDER BY seq").all(registerId, date) as { seq: number }[]).map((r) => r.seq);
  if (!seqs.length) return [];
  const set = new Set(seqs); const out: number[] = [];
  for (let s = from; s < seqs[seqs.length - 1] && out.length < MAX_GAPS; s++) if (!set.has(s)) out.push(s);
  return out;
}
const counterRow = (db: DB, registerId: string, date: string) =>
  db.prepare('SELECT next_seq FROM number_daily_counters WHERE register_id=? AND number_date=?').get(registerId, date) as { next_seq: number } | undefined;
const textTaken = (db: DB, registerId: string, date: string, text: string) =>
  !!db.prepare('SELECT 1 FROM number_records WHERE register_id=? AND number_date=? AND number_text=?').get(registerId, date, text);

export function checkDate(date: string): string {
  if (!ISO.test(date) || yearOf(date) == null || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new NumberingError('INVALID', 'Tanggal penomoran tidak valid (format YYYY-MM-DD).');
  return date;
}
export const documentYear = (iso: string): number => { checkDate(iso); return yearOf(iso) as number; };

/** Nomor urut berikutnya untuk (register, tanggal): tertinggi hari itu + 1, dibandingkan dengan penghitung & nomor awal terkonfigurasi. */
export function suggestNext(db: DB, registerId: string, date: string, regIn?: Register): NextInfo {
  checkDate(date);
  const reg = regIn ?? getRegister(db, registerId);
  const a = agg(db, registerId, date); const c = counterRow(db, registerId, date);
  const limit = maxSeqFor(reg.seq_length);
  const suggested = Math.max(a.mx != null ? a.mx + 1 : 0, reg.initial_sequence, c?.next_seq ?? 0);
  const conflicts: string[] = [];
  if (c && a.mx != null && c.next_seq <= a.mx) conflicts.push(`Penghitung tanggal ${date} (${c.next_seq}) tertinggal dari nomor tertinggi yang tercatat (${a.mx}); nomor ${a.mx + 1} akan dipakai.`);
  if (a.mx != null && reg.initial_sequence > a.mx + 1) conflicts.push(`Nomor urut awal terkonfigurasi (${reg.initial_sequence}) melompati ${reg.initial_sequence - a.mx - 1} nomor setelah nomor tertinggi (${a.mx}).`);
  const gaps = gapsOf(db, registerId, date, reg.initial_sequence);
  const full = suggested > limit;
  return {
    date, year: yearOf(date) as number, max_seq: a.mx, configured_start: reg.initial_sequence, counter_next: c?.next_seq ?? null, suggested, limit, remaining: Math.max(0, limit - suggested + 1), full,
    gaps, gap_count: gaps.length, conflicts, has_imported: (a.imported ?? 0) > 0, requires_confirmation: gaps.length > 0 || conflicts.length > 0,
    preview: full ? null : renderNumber(reg, suggested, date), format_label: formatLabel(reg)
  };
}

export const limitMessage = (reg: Register, date: string) =>
  `Batas nomor harian tercapai: register ${reg.name} tanggal ${date} sudah memakai seluruh nomor urut 1–${maxSeqFor(reg.seq_length)}. Tidak ada nomor yang dibuat dan nomor yang ada tidak berubah. Administrator perlu memperpanjang panjang nomor urut (Pengaturan Penomoran → Format) atau memilih tanggal lain.`;

export interface PlannedSeq { seq: number; text: string }
/** Menyusun `qty` nomor berikutnya untuk (register, tanggal) tanpa menulis apa pun. Melewati teks nomor yang sudah dipakai. LIMIT bila kapasitas harian tidak cukup. */
export function planSeqs(db: DB, reg: Register, date: string, qty: number): PlannedSeq[] {
  checkDate(date);
  const a = agg(db, reg.id, date); const c = counterRow(db, reg.id, date);
  const limit = maxSeqFor(reg.seq_length);
  let seq = Math.max(reg.initial_sequence, c?.next_seq ?? 0, a.mx != null ? a.mx + 1 : 0);
  const out: PlannedSeq[] = [];
  while (out.length < qty) {
    if (seq > limit) {
      throw new NumberingError('LIMIT', out.length
        ? `${limitMessage(reg, date)} Hanya ${out.length} nomor yang masih tersedia untuk dibuat; kurangi jumlah permintaan.`
        : limitMessage(reg, date));
    }
    const text = renderNumber(reg, seq, date);
    if (!textTaken(db, reg.id, date, text)) out.push({ seq, text });
    seq++;
  }
  return out;
}

/** Mengalokasikan satu nomor urut harian berikutnya secara atomik (transaksi pemanggil/mandiri) dan memajukan penghitung. */
export function allocateSeq(db: DB, reg: Register, date: string): { seq: number; text: string } {
  return db.transaction(() => {
    const [p] = planSeqs(db, reg, date, 1);
    db.prepare(`INSERT INTO number_daily_counters (register_id, number_date, next_seq, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(register_id, number_date) DO UPDATE SET next_seq=excluded.next_seq, updated_at=excluded.updated_at`).run(reg.id, date, p.seq + 1, nowIso());
    return p;
  })();
}

/** Admin menetapkan nomor urut berikutnya untuk satu tanggal. Tidak boleh ≤ nomor tertinggi yang sudah tercatat pada tanggal itu. */
export function setNextSequence(db: DB, actor: Actor, registerId: string, date: string, next: number, confirm = false): NextInfo {
  requireAdmin(actor);
  checkDate(date);
  if (!Number.isInteger(next) || next < 1) throw new NumberingError('INVALID', 'Nomor urut harus bilangan bulat ≥ 1.');
  const reg = getRegister(db, registerId);
  if (next > maxSeqFor(reg.seq_length)) throw new NumberingError('LIMIT', `Nomor urut ${next} melebihi batas ${maxSeqFor(reg.seq_length)} untuk panjang urut ${reg.seq_length} digit.`);
  const info = suggestNext(db, registerId, date, reg);
  if (info.max_seq != null && next <= info.max_seq) throw new NumberingError('COLLISION', `Nomor ${next} bertabrakan: nomor urut ${info.max_seq} sudah tercatat pada tanggal ${date}. Minimal ${info.max_seq + 1}.`);
  const skip = info.max_seq != null ? next - info.max_seq - 1 : next - reg.initial_sequence;
  if ((info.gap_count > 0 || skip > 0 || next < info.suggested) && !confirm) {
    throw new NumberingError('NEEDS_CONFIRMATION', `Penetapan nomor ${next} perlu konfirmasi: ${skip > 0 ? `${skip} nomor akan terlewat, ` : ''}${info.gap_count ? `${info.gap_count} celah nomor terdeteksi, ` : ''}nomor yang disarankan ${info.suggested}.`);
  }
  db.transaction(() => {
    db.prepare(`INSERT INTO number_daily_counters (register_id, number_date, next_seq, confirmed_by, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(register_id, number_date) DO UPDATE SET next_seq=excluded.next_seq, confirmed_by=excluded.confirmed_by, updated_at=excluded.updated_at`).run(registerId, date, next, actor.name, nowIso());
    audit(db, actor, 'counter.set', 'register', registerId, { date, next, previous: info.counter_next, suggested: info.suggested, gaps: info.gap_count, confirmed: confirm });
  })();
  return suggestNext(db, registerId, date, reg);
}

/** Penghitung tidak pernah mundur. */
export function bumpCounter(db: DB, registerId: string, date: string, next: number) {
  db.prepare(`INSERT INTO number_daily_counters (register_id, number_date, next_seq, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(register_id, number_date) DO UPDATE SET next_seq=MAX(next_seq, excluded.next_seq), updated_at=excluded.updated_at`).run(registerId, date, next, nowIso());
}
