import { useNavigate, useParams } from 'react-router-dom';
import { Workbench, recordToDraft } from '@/features/documents/Workbench';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { Page } from '@/components/layout/Page';
import { Empty } from '@/components/ui/card';
import { DocxBar } from '@/features/importer/DocxBar';
import { DocNumberBar } from '@/features/numbering/DocNumberBar';

export default function DocumentPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const doc = useAsync(() => api.documents.get(id!), [id]);
  if (doc.loading) return <Page><p className="text-sm text-slate-500">Memuat dokumen…</p></Page>;
  if (doc.error || !doc.data) return <Page><Empty>{doc.error ?? 'Dokumen tidak ditemukan.'}</Empty></Page>;
  const d = doc.data;
  return (
    <div className="flex h-full flex-col">
      <DocNumberBar documentId={d.id} refreshKey={`${d.updated_at}:${d.status}`} />
      {d.source_kind === 'docx' && <DocxBar doc={d} onChanged={doc.reload} />}
      <div className="min-h-0 flex-1">
    <Workbench key={d.id + d.updated_at} initial={recordToDraft(doc.data)} content={doc.data.content} contentKey={doc.data.id}
      onSaved={(r, asNew) => { if (asNew) navigate(`/documents/${r.id}`); else if (d.source_kind === 'docx') doc.reload(); }} />
      </div>
    </div>
  );
}
