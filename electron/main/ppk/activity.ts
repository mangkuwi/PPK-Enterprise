import type { Actor } from '@shared/numbering';
import { ACTIVITY_ACTIONS, activityItem, type ActivityItem, type ActivityRow } from '@shared/ppk/activity';
import type { PpkStore } from './store';
import { requirePpk } from './access';

/** Aktivitas PPK terbaru dari log audit; judul diambil dari tabel tugas/agenda/kontrak bila ada. */
export async function recentActivity(s: PpkStore, actor: Actor, limit = 8): Promise<ActivityItem[]> {
  await requirePpk(s, actor, 'read');
  const acts = Object.keys(ACTIVITY_ACTIONS);
  const rows = await s.all<ActivityRow>(`SELECT a.at, a.actor_name, a.action, a.detail_json, COALESCE(t.title, g.title, c.description) AS title
    FROM audit_log a
    LEFT JOIN ppk_tasks t ON a.entity = 'ppk_tasks' AND t.id = a.entity_id
    LEFT JOIN ppk_agendas g ON a.entity = 'ppk_agendas' AND g.id = a.entity_id
    LEFT JOIN ppk_contracts c ON a.entity = 'ppk_contracts' AND c.id = a.entity_id
    WHERE a.action IN (${acts.map(() => '?').join(', ')}) ORDER BY a.at DESC LIMIT ${Math.min(Math.max(1, limit), 50)}`, acts);
  return rows.map(activityItem);
}
