import { randomUUID } from 'node:crypto';
import type { DB } from '../db';
import { nowIso } from './clock';
import type { Actor, AuditRow } from '@shared/numbering';

export const SYSTEM_ACTOR: Actor = { id: 'system', name: 'Sistem', role: 'operator' };

export function audit(db: DB, actor: Actor | null, action: string, entity: string, entityId: string | null, detail: Record<string, unknown> = {}) {
  db.prepare('INSERT INTO audit_log (id, at, actor_id, actor_name, action, entity, entity_id, detail_json) VALUES (?,?,?,?,?,?,?,?)')
    .run(randomUUID(), nowIso(), actor?.id ?? null, actor?.name ?? 'Sistem', action, entity, entityId, JSON.stringify(detail));
}

export function listAudit(db: DB, f: { search?: string; action?: string; limit?: number } = {}): AuditRow[] {
  const w: string[] = []; const a: unknown[] = [];
  if (f.action) { w.push('action LIKE ?'); a.push(`${f.action}%`); }
  if (f.search) { w.push('(actor_name LIKE ? OR action LIKE ? OR detail_json LIKE ?)'); a.push(`%${f.search}%`, `%${f.search}%`, `%${f.search}%`); }
  const rows = db.prepare(`SELECT * FROM audit_log ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY at DESC, rowid DESC LIMIT ${Math.min(f.limit ?? 200, 1000)}`).all(...a) as any[];
  return rows.map((r) => ({ id: r.id, at: r.at, actor_name: r.actor_name, action: r.action, entity: r.entity, entity_id: r.entity_id, detail: JSON.parse(r.detail_json) }));
}
