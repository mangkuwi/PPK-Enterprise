import { useAsync } from '@/hooks/useAsync';
import { useActor } from '@/features/numbering/NumberingContext';
import { api } from '@/services/api';
import type { PpkPerm } from '@shared/ppk/access';

/** Hak akses PPK pengguna aktif; dimuat ulang saat pengguna berganti. Server tetap memeriksa izin di setiap panggilan. */
export function usePpkAccess() {
  const { actor } = useActor();
  const q = useAsync(() => api.ppk.access(), [actor?.id]);
  const can = (p: PpkPerm) => !!q.data?.perms.includes(p) && (p === 'read' || !!q.data?.has_pin);
  return { access: q.data ?? null, loading: q.loading, can };
}
