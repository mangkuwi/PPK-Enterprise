import { randomUUID } from 'node:crypto';
import type { Actor } from '@shared/numbering';
import { nameSimilarity, normalizeNpwp, vendorNameKey, type Vendor, type VendorFilter, type VendorInput, type VendorStatus } from '@shared/ppk/vendors';
import type { PpkStore } from './store';
import { PpkError, ppkAudit, requirePpk } from './access';

const now = () => new Date().toISOString();
const SELECT = `SELECT v.*, c.name AS service_category_name FROM ppk_vendors v LEFT JOIN ppk_service_categories c ON c.id = v.service_category_id`;
const COLS = ['name', 'name_key', 'npwp', 'nib', 'address', 'contact_person', 'email', 'phone', 'bank_name', 'account_number', 'account_holder', 'service_category_id', 'notes'] as const;
type Row = Record<(typeof COLS)[number], string | null>;

function prepare(i: VendorInput): Row {
  const name = i.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new PpkError('INVALID', 'Nama penyedia wajib diisi.');
  const key = vendorNameKey(name);
  if (!key) throw new PpkError('INVALID', 'Nama penyedia harus memuat huruf atau angka.');
  const email = i.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PpkError('INVALID', 'Format email tidak valid.');
  let npwp: string;
  try { npwp = normalizeNpwp(i.npwp); } catch (e) { throw new PpkError('INVALID', (e as Error).message); }
  const account = i.account_number.replace(/[\s.-]/g, '');
  if (account && !/^\d+$/.test(account)) throw new PpkError('INVALID', 'Nomor rekening hanya boleh berisi angka.');
  return {
    name, name_key: key, npwp, nib: i.nib.trim(), address: i.address.trim(), contact_person: i.contact_person.trim(), email,
    phone: i.phone.trim(), bank_name: i.bank_name.trim(), account_number: account, account_holder: i.account_holder.trim(),
    service_category_id: i.service_category_id || null, notes: i.notes.trim()
  };
}

async function duplicateOf(s: PpkStore, r: Row, exceptId: string | null): Promise<string | null> {
  const hit = await s.get<{ name: string; npwp: string; status: string }>(
    `SELECT name, npwp, status FROM ppk_vendors WHERE (name_key = ? OR (npwp <> '' AND npwp = ?)) AND id <> ?`, [r.name_key, r.npwp, exceptId ?? '']);
  if (!hit) return null;
  const tip = hit.status === 'aktif' ? '' : ` Penyedia itu berstatus ${hit.status}; aktifkan kembali dari daftar "Semua status".`;
  return (hit.npwp && hit.npwp === r.npwp ? `NPWP ini sudah dipakai penyedia "${hit.name}".` : `Penyedia "${hit.name}" sudah terdaftar (nama dianggap sama).`) + tip;
}

export async function listVendors(s: PpkStore, actor: Actor, f: VendorFilter = {}): Promise<Vendor[]> {
  await requirePpk(s, actor, 'read');
  const w: string[] = []; const p: string[] = [];
  const status = f.status ?? 'aktif';
  if (status !== 'semua') { w.push('v.status = ?'); p.push(status); }
  if (f.service_category_id) { w.push('v.service_category_id = ?'); p.push(f.service_category_id); }
  if (f.search?.trim()) {
    const q = `%${f.search.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    w.push(`(lower(v.name) LIKE ? ESCAPE '\\' OR v.npwp LIKE ? ESCAPE '\\' OR lower(v.contact_person) LIKE ? ESCAPE '\\' OR v.nib LIKE ? ESCAPE '\\')`);
    p.push(q, q, q, q);
  }
  return s.all<Vendor>(`${SELECT} ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY v.name LIMIT 2000`, p);
}

export async function getVendor(s: PpkStore, actor: Actor, id: string): Promise<Vendor> {
  await requirePpk(s, actor, 'read');
  const v = await s.get<Vendor>(`${SELECT} WHERE v.id = ?`, [id]);
  if (!v) throw new PpkError('NOT_FOUND', 'Penyedia tidak ditemukan.');
  return v;
}

/** Penyedia yang namanya mirip (≥ 0,6) atau NPWP sama, untuk peringatan sebelum menyimpan. */
export async function similarVendors(s: PpkStore, actor: Actor, name: string, npwp: string, exceptId?: string): Promise<Array<{ id: string; name: string; npwp: string; status: VendorStatus; score: number }>> {
  await requirePpk(s, actor, 'read');
  let n = ''; try { n = normalizeNpwp(npwp); } catch { /* NPWP belum lengkap saat diketik */ }
  const all = await s.all<{ id: string; name: string; npwp: string; status: VendorStatus }>('SELECT id, name, npwp, status FROM ppk_vendors WHERE id <> ?', [exceptId ?? '']);
  return all.map((v) => ({ ...v, score: n && v.npwp === n ? 1 : nameSimilarity(name, v.name) }))
    .filter((v) => v.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 5);
}

export async function createVendor(s: PpkStore, actor: Actor, i: VendorInput): Promise<Vendor> {
  const r = prepare(i);
  const id = randomUUID();
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const dup = await duplicateOf(t, r, null);
    if (dup) throw new PpkError('DUPLICATE', dup);
    const ts = now();
    await t.run(`INSERT INTO ppk_vendors (id, ${COLS.join(', ')}, status, version, created_by, created_at, updated_by, updated_at) VALUES (?, ${COLS.map(() => '?').join(', ')}, 'aktif', 1, ?, ?, ?, ?)`,
      [id, ...COLS.map((c) => r[c]), actor.name, ts, actor.name, ts]);
    await ppkAudit(t, actor, 'vendor.create', 'ppk_vendors', id, { after: r });
  });
  return getVendor(s, actor, id);
}

/** version = versi yang terakhir dibaca pengguna; bila orang lain sudah mengubah, simpan ditolak (tidak saling menimpa). */
export async function updateVendor(s: PpkStore, actor: Actor, id: string, version: number, i: VendorInput): Promise<Vendor> {
  const r = prepare(i);
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const before = await t.get<Record<string, unknown>>('SELECT * FROM ppk_vendors WHERE id = ?', [id]);
    if (!before) throw new PpkError('NOT_FOUND', 'Penyedia tidak ditemukan.');
    const dup = await duplicateOf(t, r, id);
    if (dup) throw new PpkError('DUPLICATE', dup);
    const res = await t.run(`UPDATE ppk_vendors SET ${COLS.map((c) => `${c} = ?`).join(', ')}, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ? AND version = ?`,
      [...COLS.map((c) => r[c]), actor.name, now(), id, version]);
    if (!res.changes) throw new PpkError('CONFLICT', 'Data penyedia sudah diubah pengguna lain. Muat ulang lalu ulangi perubahan Anda.');
    await ppkAudit(t, actor, 'vendor.update', 'ppk_vendors', id, { before, after: r });
  });
  return getVendor(s, actor, id);
}

export async function setVendorStatus(s: PpkStore, actor: Actor, id: string, status: VendorStatus, reason: string): Promise<Vendor> {
  await s.tx(async (t) => {
    await requirePpk(t, actor, 'write');
    const before = await t.get<{ status: string }>('SELECT status FROM ppk_vendors WHERE id = ?', [id]);
    if (!before) throw new PpkError('NOT_FOUND', 'Penyedia tidak ditemukan.');
    if (before.status === status) return;
    await t.run('UPDATE ppk_vendors SET status = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = ?', [status, actor.name, now(), id]);
    await ppkAudit(t, actor, 'vendor.status', 'ppk_vendors', id, { before: before.status, after: status, reason: reason.trim() });
  });
  return getVendor(s, actor, id);
}

export const VENDOR_EXPORT_HEADER = ['Nama Penyedia', 'NPWP', 'NIB', 'Alamat', 'Kontak', 'Email', 'Telepon', 'Bank', 'No. Rekening', 'Atas Nama', 'Kategori Layanan', 'Status', 'Catatan'];
export const vendorExportRow = (v: Vendor) => [v.name, v.npwp, v.nib, v.address, v.contact_person, v.email, v.phone, v.bank_name, v.account_number, v.account_holder, v.service_category_name ?? '', v.status, v.notes];
