import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import type { Actor, ConfigHistoryRow, Register, RegisterCode } from '@shared/numbering';
import { maxSeqFor, renderNumber, validateFormat } from '@shared/numbering';
import { NumberingError } from './errors';
import { requireAdmin } from './users';
import { audit } from './audit';
import { nowIso } from './clock';
import { getRawSetting, setSettings } from '../repo';

export const toRegister = (r: any): Register => ({
  id: r.id, code: r.code, name: r.name, format: r.format, prefix: r.prefix, suffix: r.suffix, seq_length: r.seq_length,
  initial_sequence: r.initial_sequence, ttl_hours: r.ttl_hours, placeholder_keys: JSON.parse(r.placeholder_keys_json || '[]'),
  is_active: !!r.is_active, sort_order: r.sort_order, updated_at: r.updated_at
});

export function listRegisters(db: DB): Register[] {
  return (db.prepare('SELECT * FROM number_registers ORDER BY sort_order').all() as any[]).map(toRegister);
}
export function getRegister(db: DB, idOrCode: string): Register {
  const r = db.prepare('SELECT * FROM number_registers WHERE id=? OR code=?').get(idOrCode, idOrCode);
  if (!r) throw new NumberingError('NOT_FOUND', 'Register tidak ditemukan.');
  return toRegister(r);
}

export interface RegisterPatch {
  name?: string; format?: string; prefix?: string; suffix?: string; seq_length?: number; initial_sequence?: number;
  ttl_hours?: number; placeholder_keys?: string[]; is_active?: boolean;
}
const KEY_RE = /^[A-Z][A-Z0-9_]{1,40}$/;

/** Ubah konfigurasi register (admin). Setiap perubahan dicatat; nomor yang sudah terbit tidak ikut berubah. */
export function updateRegister(db: DB, actor: Actor, id: string, p: RegisterPatch, reason = ''): Register {
  requireAdmin(actor);
  const cur = getRegister(db, id);
  const next: Register = { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) } as Register;
  next.name = next.name.trim();
  if (!next.name) throw new NumberingError('INVALID', 'Nama register wajib diisi.');
  const err = validateFormat(next);
  if (err) throw new NumberingError('INVALID', err);
  if (!Number.isInteger(next.initial_sequence) || next.initial_sequence < 1) throw new NumberingError('INVALID', 'Nomor urut awal minimal 1.');
  if (next.initial_sequence > maxSeqFor(next.seq_length)) throw new NumberingError('INVALID', `Nomor urut awal melebihi batas ${maxSeqFor(next.seq_length)} untuk panjang urut ${next.seq_length} digit.`);
  if (!Number.isInteger(next.ttl_hours) || next.ttl_hours < 1 || next.ttl_hours > 24 * 365) throw new NumberingError('INVALID', 'Masa berlaku reservasi 1 jam – 365 hari.');
  next.placeholder_keys = [...new Set(next.placeholder_keys.map((k) => k.trim().toUpperCase()).filter(Boolean))];
  if (!next.placeholder_keys.length || next.placeholder_keys.some((k) => !KEY_RE.test(k))) throw new NumberingError('INVALID', 'Kunci placeholder harus huruf besar/angka/garis bawah (mis. NOMOR_BA).');
  const keys = ['name', 'format', 'prefix', 'suffix', 'seq_length', 'initial_sequence', 'ttl_hours', 'placeholder_keys', 'is_active'] as const;
  const changed = keys.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(next[k]));
  if (!changed.length) return cur;
  const ts = nowIso();
  db.transaction(() => {
    db.prepare(`UPDATE number_registers SET name=?, format=?, prefix=?, suffix=?, seq_length=?, initial_sequence=?, ttl_hours=?, placeholder_keys_json=?, is_active=?, updated_at=? WHERE id=?`)
      .run(next.name, next.format, next.prefix, next.suffix, next.seq_length, next.initial_sequence, next.ttl_hours, JSON.stringify(next.placeholder_keys), next.is_active ? 1 : 0, ts, id);
    const pick = (r: Register) => Object.fromEntries(changed.map((k) => [k, r[k]]));
    db.prepare('INSERT INTO number_register_config_history (id, register_id, changed_at, changed_by, changed_by_name, old_json, new_json, reason) VALUES (?,?,?,?,?,?,?,?)')
      .run(randomUUID(), id, ts, actor.id, actor.name, JSON.stringify(pick(cur)), JSON.stringify(pick(next)), reason);
    audit(db, actor, 'register.config', 'register', id, { changed, reason });
  })();
  return getRegister(db, id);
}

export function configHistory(db: DB, registerId: string): ConfigHistoryRow[] {
  return (db.prepare('SELECT * FROM number_register_config_history WHERE register_id=? ORDER BY changed_at DESC, rowid DESC').all(registerId) as any[])
    .map((r) => ({ id: r.id, register_id: r.register_id, changed_at: r.changed_at, changed_by_name: r.changed_by_name, old: JSON.parse(r.old_json), next: JSON.parse(r.new_json), reason: r.reason }));
}

/** Contoh nomor untuk pratinjau konfigurasi. */
export const previewFormat = (r: Pick<Register, 'format' | 'prefix' | 'suffix' | 'seq_length'>, seq: number, iso: string) => renderNumber(r, seq, iso);

// ---------- pemetaan kategori/template → register ----------
const DEFAULT_MAP: Array<[string, RegisterCode]> = [['Surat Undangan', 'SURAT_KELUAR'], ['Nota Dinas', 'NOTA_DINAS'], ['Berita Acara', 'BERITA_ACARA'], ['Kontrak', 'KONTRAK']];

/** Dijalankan sekali: membuat kategori "Kontrak" bila belum ada dan memetakan kategori bawaan. Tidak menimpa pemetaan admin. */
export function ensureDefaultMappings(db: DB) {
  if (getRawSetting(db, 'numbering_map_v1') === 'true') return;
  const hasCats = (db.prepare('SELECT COUNT(*) n FROM categories').get() as { n: number }).n > 0;
  if (!hasCats) return; // seed belum jalan; dicoba lagi pada start berikutnya
  const ts = nowIso();
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM categories WHERE name='Kontrak'").get()) {
      const mx = (db.prepare('SELECT COALESCE(MAX(sort_order),0) m FROM categories').get() as { m: number }).m;
      db.prepare("INSERT INTO categories (id, name, code, sort_order, is_default, created_at, updated_at) VALUES (?, 'Kontrak', 'KTR', ?, 1, ?, ?)").run(randomUUID(), mx + 1, ts, ts);
    }
    for (const [cat, code] of DEFAULT_MAP) {
      const c = db.prepare('SELECT id FROM categories WHERE name=?').get(cat) as { id: string } | undefined;
      const r = db.prepare('SELECT id FROM number_registers WHERE code=?').get(code) as { id: string } | undefined;
      if (c && r) db.prepare('INSERT OR IGNORE INTO register_category_map (category_id, register_id) VALUES (?,?)').run(c.id, r.id);
    }
    setSettings(db, { numbering_map_v1: 'true' });
  })();
}

export interface MapRow { category_id: string; category_name: string; register_id: string | null }
export function listCategoryMap(db: DB): MapRow[] {
  return db.prepare(`SELECT c.id category_id, c.name category_name, m.register_id FROM categories c LEFT JOIN register_category_map m ON m.category_id=c.id ORDER BY c.sort_order, c.name`).all() as MapRow[];
}
export function setCategoryMap(db: DB, actor: Actor, categoryId: string, registerId: string | null) {
  requireAdmin(actor);
  if (registerId === null) db.prepare('DELETE FROM register_category_map WHERE category_id=?').run(categoryId);
  else { getRegister(db, registerId); db.prepare('INSERT INTO register_category_map (category_id, register_id) VALUES (?,?) ON CONFLICT(category_id) DO UPDATE SET register_id=excluded.register_id').run(categoryId, registerId); }
  audit(db, actor, 'register.map_category', 'category', categoryId, { register_id: registerId });
}
export function setTemplateMap(db: DB, actor: Actor, templateId: string, registerId: string | null) {
  requireAdmin(actor);
  if (registerId === null) db.prepare('DELETE FROM register_template_map WHERE template_id=?').run(templateId);
  else { getRegister(db, registerId); db.prepare('INSERT INTO register_template_map (template_id, register_id) VALUES (?,?) ON CONFLICT(template_id) DO UPDATE SET register_id=excluded.register_id').run(templateId, registerId); }
  audit(db, actor, 'register.map_template', 'template', templateId, { register_id: registerId });
}
/** Template lebih spesifik daripada kategori. Null = dokumen tanpa nomor register. */
export function registerForTemplate(db: DB, templateId: string | null, categoryId?: string | null): Register | null {
  let rid: string | undefined;
  if (templateId) {
    rid = (db.prepare('SELECT register_id r FROM register_template_map WHERE template_id=?').get(templateId) as any)?.r;
    if (!rid && categoryId === undefined) categoryId = (db.prepare('SELECT category_id c FROM templates WHERE id=?').get(templateId) as any)?.c ?? null;
  }
  if (!rid && categoryId) rid = (db.prepare('SELECT register_id r FROM register_category_map WHERE category_id=?').get(categoryId) as any)?.r;
  if (!rid) return null;
  const r = getRegister(db, rid);
  return r.is_active ? r : null;
}
