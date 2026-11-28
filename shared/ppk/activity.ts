/** Aktivitas Terbaru di Dashboard: diturunkan dari log audit PPK (tidak ada tabel baru). */
export type ActivityKind = 'dokumen' | 'unggah' | 'tugas' | 'agenda' | 'status';
export interface ActivityRow { at: string; actor_name: string; action: string; title: string | null; detail_json: string }
export interface ActivityItem { at: string; actor: string; kind: ActivityKind; text: string; done?: boolean }

export const ACTIVITY_ACTIONS: Record<string, [string, ActivityKind]> = {
  'ppk.agenda.create': ['Agenda ditambahkan', 'agenda'],
  'ppk.agenda.update': ['Agenda diperbarui', 'status'],
  'ppk.agenda.report': ['Laporan rapat diunggah', 'unggah'],
  'ppk.invitation.upload': ['Dokumen undangan diunggah', 'unggah'],
  'ppk.task.create': ['Tugas ditambahkan', 'tugas'],
  'ppk.task.done': ['Tugas selesai', 'tugas'],
  'ppk.task.reopen': ['Tugas dibuka lagi', 'status'],
  'ppk.contract.create': ['Kontrak dicatat', 'dokumen'],
  'ppk.contract.status': ['Status kontrak diubah', 'status'],
  'ppk.payment.create': ['Pembayaran dicatat', 'status']
};

export function activityItem(r: ActivityRow): ActivityItem {
  const [label, kind] = ACTIVITY_ACTIONS[r.action] ?? [r.action, 'status'];
  let d: { filename?: string; after?: unknown } = {};
  try { d = JSON.parse(r.detail_json) as typeof d; } catch { /* detail rusak: tampilkan label saja */ }
  const what = r.title ?? d.filename ?? (r.action === 'ppk.contract.status' && typeof d.after === 'string' ? d.after : null);
  return { at: r.at, actor: r.actor_name, kind, text: what ? `${label}: ${what}` : label, done: r.action === 'ppk.task.done' };
}

/** '10 menit yang lalu', '2 jam yang lalu', '3 hari yang lalu'. */
export function timeAgo(iso: string, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (m < 1) return 'baru saja';
  if (m < 60) return `${m} menit yang lalu`;
  if (m < 1440) return `${Math.floor(m / 60)} jam yang lalu`;
  return `${Math.floor(m / 1440)} hari yang lalu`;
}
