import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Download, Eye, FilePlus2, FileUp, Pencil, Plus, Star, Trash2, Upload } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import { buildDocumentHtml } from '@shared/render';

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const { kop } = useSettings();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const q = useDebounced(search);
  const cats = useAsync(() => api.categories(), []);
  const list = useAsync(() => api.templates.list({ search: q, categoryId, favoriteOnly: favOnly }), [q, categoryId, favOnly]);
  const imports = useAsync(() => api.importer.list(), []);
  const importOf = (tid: string) => imports.data?.find((i) => i.template_id === tid)?.id;
  const [preview, setPreview] = useState<{ name: string; html: string } | null>(null);

  const guard = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok, 'success'); list.reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const remove = async (id: string, name: string) => {
    if (await confirm({ title: 'Hapus template?', destructive: true, confirmLabel: 'Hapus',
      message: <>Template <b>{name}</b> akan dihapus. Dokumen yang pernah dibuat dari template ini <b>tidak</b> ikut terhapus.</> })) {
      await guard(() => api.templates.remove(id), 'Template dihapus.');
    }
  };

  const showPreview = async (id: string) => {
    try {
      const t = await api.templates.get(id);
      setPreview({ name: t.name, html: buildDocumentHtml({ title: t.name, content: t.content, layout: t.layout, kop, mode: 'preview' }) });
    } catch (e) { toast(errMsg(e), 'error'); }
  };

  const exportAll = () => guard(async () => {
    const ids = (list.data ?? []).map((t) => t.id);
    if (!ids.length) throw new Error('Tidak ada template untuk diekspor.');
    const r = await api.templates.export(ids);
    if (!r.canceled) toast(`${r.count} template diekspor ke ${r.path}`, 'success');
  });

  const importFile = () => guard(async () => {
    const r = await api.templates.import();
    if (!r.canceled) toast(`${r.imported} template diimpor.`, 'success');
  });

  const importWord = async () => {
    try {
      const r = await api.templates.importDocx();
      if (!r.canceled && r.template) navigate('/templates/new', { state: { imported: r.template } });
    } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <Page>
      <PageHeader title="Template" subtitle="Buat sekali, pakai berulang kali."
        actions={<>
          <Button variant="outline" onClick={importWord}><FileUp size={16} /> Import dari Word</Button>
          <Button variant="outline" onClick={importFile}><Upload size={16} /> Import JSON</Button>
          <Button variant="outline" onClick={exportAll}><Download size={16} /> Export {list.data?.length ? `(${list.data.length})` : ''}</Button>
          <Button onClick={() => navigate('/templates/new')}><Plus size={16} /> Tambah Template</Button>
        </>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="w-72" placeholder="Cari template…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-56" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Semua kategori</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Button variant={favOnly ? 'default' : 'outline'} onClick={() => setFavOnly((v) => !v)}><Star size={16} /> Favorit</Button>
      </div>
      {list.error && <Empty>{list.error}</Empty>}
      {list.data && list.data.length === 0 && <Empty>Tidak ada template yang cocok.</Empty>}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {list.data?.map((t) => (
          <Card key={t.id} className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-navy-900">{t.name}</span><Badge tone="navy">{t.category_name}</Badge>{t.kind === 'docx' && <Badge tone="green">Word asli</Badge>}{!t.is_active && <Badge tone="red">Nonaktif</Badge>}</div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{t.description || 'Tanpa deskripsi.'}</p>
                <p className="mt-1 text-xs text-slate-400">{t.field_count} isian · diperbarui {formatDateTime(t.updated_at)}</p>
              </div>
              <button aria-label="Favorit" title="Favorit" onClick={() => guard(() => api.templates.favorite(t.id, !t.is_favorite))}>
                <Star size={20} className={t.is_favorite ? 'fill-amber-400 text-amber-500' : 'text-slate-300 hover:text-amber-400'} />
              </button>
            </div>
            <div className="mt-auto flex flex-wrap gap-1.5">
              <Button size="sm" disabled={!t.is_active} onClick={() => navigate(`/generator?template=${t.id}`)}><FilePlus2 size={14} /> Gunakan</Button>
              <Button size="sm" variant="outline" onClick={() => showPreview(t.id)}><Eye size={14} /> Preview</Button>
              <Button size="sm" variant="outline" onClick={() => navigate(t.kind === 'docx' && importOf(t.id) ? `/importer/review/${importOf(t.id)}` : `/templates/${t.id}`)}><Pencil size={14} /> {t.kind === 'docx' ? 'Edit mapping' : 'Edit'}</Button>
              {t.kind !== 'docx' && <Button size="sm" variant="outline" onClick={() => guard(() => api.templates.duplicate(t.id), 'Template diduplikasi.')}><Copy size={14} /> Duplikasi</Button>}
              {t.kind !== 'docx' && <Button size="sm" variant="outline" onClick={() => guard(async () => { const r = await api.templates.export([t.id]); if (!r.canceled) toast(`Diekspor ke ${r.path}`, 'success'); })}><Download size={14} /> Export</Button>}
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => remove(t.id, t.name)}><Trash2 size={14} /> Hapus</Button>
            </div>
          </Card>
        ))}
      </div>
      <Dialog open={!!preview} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        {preview && <DialogContent wide title={`Preview: ${preview.name}`} description="Placeholder ditampilkan apa adanya." className="h-[90vh]">
          <iframe title="Preview" sandbox="" srcDoc={preview.html} className="h-[70vh] w-full rounded border border-slate-200" /></DialogContent>}
      </Dialog>
    </Page>
  );
}
