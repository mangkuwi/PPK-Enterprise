import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { MASTERS, type MasterDef, type MasterKey, type MasterRow } from '@shared/ppk/master';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';

const now = () => new Date().toISOString();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const def = (key: MasterKey): MasterDef => {
  const d = (MASTERS as Record<string, MasterDef>)[key];
  if (!d) throw new PpkError('INVALID', 'Jenis data master tidak dikenal.');
  return d;
};

export async function listMaster(s: PpkStore, actor: Actor, key: MasterKey): Promise<MasterRow[]> {
  await requirePpk(s, actor, 'read');
  const d = def(key);
  return s.all<MasterRow>(`SELECT * FROM ${d.table} ORDER BY ${d.order}`);
}

/** Validasi di batas kepercayaan: hanya kolom yang didefinisikan yang bisa ditulis, dengan tipe yang benar. */
function clean(d: MasterDef, raw: Record<string, unknown>): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const f of d.fields) {
    const v = raw[f.key];
    if (f.type === 'bool') { out[f.key] = v === false || v === 0 ? 0 : 1; continue; }
    if (f.type === 'number') {
      if (typeof v !== 'number' || !Number.isSafeInteger(v)) throw new PpkError('INVALID', `${f.label} harus berupa bilangan bulat.`);
      out[f.key] = v; continue;
    }
    const str = typeof v === 'string' ? v.trim() : v == null ? '' : null;
    if (str === null) throw new PpkError('INVALID', `${f.label} tidak valid.`);
    if (str.length > 300) throw new PpkError('INVALID', `${f.label} maksimal 300 karakter.`);
    if (!str) {
      if (f.required) throw new PpkError('INVALID', `${f.label} wajib diisi.`);
      out[f.key] = f.type === 'date' || f.type === 'ref' ? null : ''; continue;
    }
    if (f.type === 'date' && !(DATE.test(str) && !Number.isNaN(Date.parse(`${str}T00:00:00Z`)) && new Date(`${str}T00:00:00Z`).toISOString().startsWith(str)))
      throw new PpkError('INVALID', `${f.label} bukan tanggal yang valid.`);
    if (f.type === 'select' && !f.options!.includes(str)) throw new PpkError('INVALID', `${f.label} harus salah satu dari: ${f.options!.join(', ')}.`);
    out[f.key] = str;
  }
  return out;
}

function friendly(e: unknown, d: MasterDef): never {
  const m = String(e instanceof Error ? e.message : e);
  if (/UNIQUE/i.test(m)) throw new PpkError('DUPLICATE', `${d.label} dengan kode/nilai yang sama sudah ada.`);
  if (/FOREIGN KEY/i.test(m)) throw new PpkError('INVALID', `Data rujukan untuk ${d.label} tidak ditemukan.`);
  if (/CHECK/i.test(m)) throw new PpkError('INVALID', `Isian ${d.label} tidak memenuhi aturan (mis. tanggal selesai sebelum tanggal mulai).`);
  throw e;
}

/** Tambah (tanpa id) atau ubah (dengan id). Data master tidak dihapus; nonaktifkan lewat kolom Aktif. */
export async function saveMaster(s: PpkStore, actor: Actor, key: MasterKey, raw: Record<string, unknown> & { id?: string }): Promise<MasterRow> {
  const d = def(key);
  const vals = clean(d, raw);
  const cols = Object.keys(vals);
  return s.tx(async (t) => {
    await requirePpk(t, actor, 'master');
    const ts = now();
    let id = raw.id;
    try {
      if (id) {
        const before = await t.get<MasterRow>(`SELECT * FROM ${d.table} WHERE id = ?`, [id]);
        if (!before) throw new PpkError('NOT_FOUND', `${d.label} tidak ditemukan.`);
        await t.run(`UPDATE ${d.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...cols.map((c) => vals[c]), ts, id]);
        await ppkAudit(t, actor, `${key}.update`, d.table, id, { before, after: vals });
      } else {
        id = randomUUID();
        await t.run(`INSERT INTO ${d.table} (id, ${cols.join(', ')}, created_at, updated_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?)`, [id, ...cols.map((c) => vals[c]), ts, ts]);
        await ppkAudit(t, actor, `${key}.create`, d.table, id, { after: vals });
      }
    } catch (e) {
      if (e instanceof PpkError) throw e;
      friendly(e, d);
    }
    return (await t.get<MasterRow>(`SELECT * FROM ${d.table} WHERE id = ?`, [id]))!;
  });
}

export interface TaxRateRow { id: string; valid_from: string; ppn_bp: number; pph23_bp: number; note: string }
export async function listTaxRates(s: PpkStore, actor: Actor): Promise<TaxRateRow[]> {
  await requirePpk(s, actor, 'read');
  return s.all<TaxRateRow>('SELECT id, valid_from, ppn_bp, pph23_bp, note FROM ppk_tax_rates ORDER BY valid_from DESC');
}
