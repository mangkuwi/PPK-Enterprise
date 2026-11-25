import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileUp, ScanSearch } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';

/** Upload Template + Analyze Document: analisis berjalan segera setelah berkas dipilih. */
export default function ImporterUploadPage({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const list = useAsync(() => api.importer.list(), []);
  const pending = (list.data ?? []).filter((i) => i.import_status === 'analyzed' || i.import_status === 'reviewed');

  const upload = async () => {
    setBusy(true);
    try {
      const r = await api.importer.upload();
      if (!r.canceled && r.id) { toast('Dokumen dianalisis. Tinjau hasil pemetaan sebelum disimpan.', 'success'); navigate(`/importer/review/${r.id}`); }
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Page>
      <PageHeader title={pendingOnly ? 'Analyze Document' : 'Upload Template'}
        subtitle={pendingOnly ? 'Dokumen yang sudah dianalisis dan menunggu review/penyimpanan.' : 'Unggah dokumen Word (.docx) — sistem mengenali bagian tetap dan bagian yang berubah-ubah, tanpa AI dan tanpa internet.'} />
      {!pendingOnly && (
        <Card className="mb-6 p-8 text-center">
          <FileUp className="mx-auto mb-2 text-navy-600" size={36} />
          <p className="mb-1 font-semibold text-navy-900">Pilih dokumen Word dari komputer</p>
          <p className="mb-4 text-sm text-slate-500">Format: .docx (maks 50 MB). Berkas asli disimpan utuh dan tidak pernah diubah; template dibuat dari salinannya. Untuk .doc, simpan ulang sebagai .docx dari Word. PDF hanya dapat menjadi referensi (OCR belum didukung).</p>
          <Button onClick={upload} disabled={busy}><ScanSearch size={16} /> {busy ? 'Menganalisis…' : 'Pilih & Analisis Dokumen'}</Button>
        </Card>
      )}
      <div className="mb-2 text-sm font-semibold text-navy-900">Menunggu review</div>
      {pending.length === 0 ? <Empty>Tidak ada dokumen yang menunggu review.</Empty> : (
        <div className="space-y-2">{pending.map((i) => (
          <Card key={i.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0"><div className="truncate font-semibold text-navy-900">{i.original_filename}</div>
              <div className="text-xs text-slate-500">{formatDateTime(i.created_at)} · {i.auto_count} otomatis · {i.confirm_count} perlu konfirmasi</div></div>
            <div className="flex items-center gap-2"><Badge tone="amber">{i.import_status === 'analyzed' ? 'Dianalisis' : 'Direview'}</Badge><Button asChild size="sm"><Link to={`/importer/review/${i.id}`}>Review</Link></Button></div>
          </Card>
        ))}</div>
      )}
    </Page>
  );
}
