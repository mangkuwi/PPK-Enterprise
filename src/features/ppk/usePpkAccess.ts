import { useEffect } from 'react';
import { useAsync } from '@/hooks/useAsync';
import { useActor } from '@/features/numbering/NumberingContext';
import { api } from '@/services/api';
import type { PpkPerm } from '@shared/ppk/access';

/** Dikirim setelah masuk/keluar server PPK atau ganti mode, agar semua halaman memuat ulang hak akses. */
export const PPK_SESSION_EVENT = 'ppk-session';
export const notifyPpkSession = () => window.dispatchEvent(new Event(PPK_SESSION_EVENT));

/** Hak akses PPK pengguna aktif; dimuat ulang saat pengguna berganti. Server tetap memeriksa izin di setiap panggilan. */
export function usePpkAccess() {
  const { actor } = useActor();
  const q = useAsync(() => api.ppk.access(), [actor?.id]);
  const { reload } = q;
  useEffect(() => { window.addEventListener(PPK_SESSION_EVENT, reload); return () => window.removeEventListener(PPK_SESSION_EVENT, reload); }, [reload]);
  const can = (p: PpkPerm) => !!q.data?.perms.includes(p) && (p === 'read' || !!q.data?.has_pin);
  return { access: q.data ?? null, loading: q.loading, error: q.error, can };
}
