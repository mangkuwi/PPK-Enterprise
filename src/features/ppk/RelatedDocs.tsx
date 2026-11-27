import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { Badge, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';

/** Dokumen NASKAHDINAS yang memakai salah satu nomor ini (kontrak, BA, invoice). */
export function RelatedDocs({ numbers }: { numbers: string[] }) {
  const list = numbers.filter(Boolean);
  const docs = useAsync(() => api.ppk.relatedDocuments(list), [list.join('|')]);
  return (
    <div className="mt-4">
      <div className="mb-1 text-sm font-semibold text-slate-700">Dokumen NASKAHDINAS terkait</div>
      {docs.error && <p className="text-xs text-red-700">{docs.error}</p>}
      {docs.data && !docs.data.length && <p className="text-xs text-slate-500">Belum ada dokumen dengan nomor {list.join(' / ') || '—'}. Dokumen tertaut otomatis bila memakai nomor yang sama dari Bank Nomor atau nomor surat.</p>}
      {!!docs.data?.length && <ul className="divide-y divide-slate-100 rounded border border-slate-200 text-sm">
        {docs.data.map((d) => (
          <li key={d.document_id} className="flex items-center gap-2 px-3 py-1.5">
            <FileText size={14} className="shrink-0 text-slate-400" />
            <Link to={`/documents/${d.document_id}`} className="truncate font-medium text-navy-900 hover:underline">{d.title}</Link>
            <span className="truncate text-xs text-slate-500">{d.number_text}{d.register_name ? ` · ${d.register_name}` : ''}{d.doc_date ? ` · ${d.doc_date}` : ''}</span>
            <Badge className="ml-auto" tone={STATUS_TONE[d.status as keyof typeof STATUS_TONE] ?? 'slate'}>{STATUS_LABEL[d.status as keyof typeof STATUS_LABEL] ?? d.status}</Badge>
          </li>))}
      </ul>}
    </div>
  );
}
