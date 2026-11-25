import { Link } from 'react-router-dom';
import { Hash } from 'lucide-react';
import { Badge } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { REGISTER_LABEL, REGISTER_PATH, STATUS_LABEL, STATUS_TONE } from '@shared/numbering';

/** Ringkasan nomor register yang tertaut ke dokumen (bila ada), beserta nomor yang dirujuk. */
export function DocNumberBar({ documentId, refreshKey }: { documentId: string; refreshKey?: string }) {
  const info = useAsync(() => api.numbering.documentInfo(documentId), [documentId, refreshKey]);
  const r = info.data?.record;
  if (!r) return null;
  const st = r.status;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs text-slate-700">
      <Hash size={13} className="text-navy-700" />
      <Link to={`/register/${REGISTER_PATH[r.register_code]}`} className="font-medium text-navy-800 hover:underline">Register {REGISTER_LABEL[r.register_code]}</Link>
      <span className="font-mono">{r.number_text}</span>
      <Badge tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Badge>
      {r.status === 'assigned' && <span className="text-slate-500">— terbit saat dokumen difinalkan</span>}
      {info.data?.refs.map((x) => <span key={x.key} className="text-slate-500">· merujuk {x.record.number_text} ({x.key})</span>)}
    </div>
  );
}
