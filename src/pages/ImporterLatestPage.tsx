import { Navigate } from 'react-router-dom';
import { Page } from '@/components/layout/Page';
import { Empty } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';

/** Pintasan menu "Review Mapping"/"Template Preview": membuka impor terbaru. */
export default function ImporterLatestPage({ tab }: { tab?: 'compare' }) {
  const list = useAsync(() => api.importer.list(), []);
  if (list.loading) return <Page><p className="text-sm text-slate-500">Memuat…</p></Page>;
  const latest = list.data?.[0];
  if (!latest) return <Page><Empty>Belum ada dokumen yang diimpor. Mulai dari menu Upload Template.</Empty></Page>;
  return <Navigate replace to={`/importer/review/${latest.id}${tab ? `?tab=${tab}` : ''}`} />;
}
