import { Link, useNavigate } from 'react-router-dom';
import { Download, FilePlus2, RefreshCw, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import type { ImportSummary } from '@shared/importer';

const TONE = { analyzed: 'amber', reviewed: 'navy', saved: 'green', error: 'red' } as const;
const LABEL = { analyzed: 'Dianalisis', reviewed: 'Direview', saved: 'Template tersimpan', error: 'Gagal' } as const;

/** mode 'templates' = Imported Templates (hanya yang sudah jadi template); 'history' = Import History (semua). */
export default function ImportListPage({ mode }: { mode: 'templates' | 'history' }) {
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const list = useAsync(() => api.importer.list(), []);
  const rows = (list.data ?? []).filter((i) => mode === 'history' || i.import_status === 'saved');

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); list.reload(); } catch (e) { toast(errMsg(e), 'error'); } };

  const reanalyze = async (i: ImportSummary) => {
    if (!(await confirm({ title: 'Analisis ulang?', message: 'Pemetaan diganti hasil analisis baru dari sumber. Template yang sudah tersimpan baru berubah setelah Anda menyimpannya kembali.', confirmLabel: 'Analisis ulang' }))) return;
    await act(() => api.importer.reanalyze(i.id), 'Analisis ulang selesai.');
    navigate(`/importer/review/${i.id}`);
  };
  const restore = async (i: ImportSummary) => {
    if (!(await confirm({ title: 'Kembalikan ke sumber asli?', message: 'Berkas adaptasi dibuang dan pemetaan dianalisis ulang dari berkas sumber. Dokumen yang sudah dibuat tidak terpengaruh. Template perlu disimpan ulang agar dapat dipakai lagi.', confirmLabel: 'Kembalikan', destructive: true }))) return;
    await act(() => api.importer.restoreSource(i.id), 'Dikembalikan ke sumber asli.');
  };
  const remove = async (i: ImportSummary) => {
    const withTpl = i.template_id
      ? await confirm({ title: 'Hapus juga template hasil impor?', message: 'Pilih "Hapus semua" untuk menghapus data impor beserta template-nya. Dokumen di arsip tetap aman (menyimpan salinan sendiri). Pilih Batal untuk hanya menghapus data impor.', confirmLabel: 'Hapus semua', destructive: true })
      : false;
    if (!withTpl && !(await confirm({ title: 'Hapus data impor?', message: `Sumber "${i.original_filename}" dan seluruh pemetaannya dihapus dari aplikasi. Berkas asli di komputer Anda tidak tersentuh.`, confirmLabel: 'Hapus', destructive: true }))) return;
    await act(() => api.importer.remove(i.id, withTpl), 'Data impor dihapus.');
  };

  return (
    <Page>
      <PageHeader title={mode === 'templates' ? 'Imported Templates' : 'Import History'}
        subtitle={mode === 'templates' ? 'Template yang dibuat dari dokumen Word dan siap dipakai ulang.' : 'Seluruh dokumen yang pernah diimpor beserta statusnya.'}
        actions={<Button asChild size="sm"><Link to="/importer"><Wand2 size={14} /> Impor baru</Link></Button>} />
      {list.loading ? <p className="text-sm text-slate-500">Memuat…</p> : rows.length === 0 ? <Empty>{mode === 'templates' ? 'Belum ada template hasil impor.' : 'Belum ada riwayat impor.'}</Empty> : (
        <div className="space-y-2">{rows.map((i) => (
          <Card key={i.id} className="p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-semibold text-navy-900">{i.template_name || i.original_filename}</div>
                <div className="text-xs text-slate-500">{i.original_filename} · {(i.size / 1024).toFixed(0)} KB · {formatDateTime(i.created_at)} · {i.mapping_count} isian ({i.confirm_count} belum dikonfirmasi) · SHA-256 {i.sha256.slice(0, 10)}…</div>
              </div>
              <Badge tone={TONE[i.import_status]}>{LABEL[i.import_status]}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {i.template_id && <Button asChild size="sm"><Link to={`/generator?template=${i.template_id}`}><FilePlus2 size={14} /> Buat dokumen</Link></Button>}
              <Button asChild size="sm" variant="outline"><Link to={`/importer/review/${i.id}`}>Edit mapping</Link></Button>
              <Button asChild size="sm" variant="outline"><Link to={`/importer/review/${i.id}?tab=compare`}>Preview</Link></Button>
              <Button size="sm" variant="outline" onClick={() => reanalyze(i)}><RefreshCw size={14} /> Re-analyze</Button>
              <Button size="sm" variant="outline" onClick={() => api.importer.saveOriginal(i.id).then((r) => { if (!r.canceled) toast(`Tersimpan: ${r.path}`, 'success'); }).catch((e) => toast(errMsg(e), 'error'))}><Download size={14} /> Sumber asli</Button>
              <Button size="sm" variant="outline" onClick={() => restore(i)}><RotateCcw size={14} /> Restore sumber</Button>
              <Button size="sm" variant="ghost" className="text-red-700" onClick={() => remove(i)}><Trash2 size={14} /> Hapus</Button>
            </div>
          </Card>
        ))}</div>
      )}
    </Page>
  );
}
