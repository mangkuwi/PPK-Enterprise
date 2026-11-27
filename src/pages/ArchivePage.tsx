import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowDownAZ, ArrowUpAZ, Copy, ExternalLink, FileDown, FileText, Trash2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Empty, PageHeader, STATUS_LABEL, STATUS_TONE } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { formatDateTime } from '@/lib/utils';
import type { DocumentFilter, DocumentSummary, DocStatus } from '@shared/types';

export default function ArchivePage() {
  const navigate = useNavigate();
  const { toast, confirm } = useFeedback();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [sp] = useSearchParams();
  const [status, setStatus] = useState<DocStatus | ''>((['draft', 'review', 'final'].includes(sp.get('status') ?? '') ? sp.get('status') : '') as DocStatus | '');
  useEffect(() => { const v = sp.get('status') ?? ''; setStatus((['draft', 'review', 'final'].includes(v) ? v : '') as DocStatus | ''); }, [sp]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<NonNullable<DocumentFilter['sortBy']>>('created_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const q = useDebounced(search);
  const cats = useAsync(() => api.categories(), []);
  const list = useAsync(() => api.documents.list({ search: q, categoryId, status, dateFrom, dateTo, sortBy, sortDir }), [q, categoryId, status, dateFrom, dateTo, sortBy, sortDir]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok, 'success'); list.reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const remove = async (d: DocumentSummary) => {
    if (await confirm({ title: 'Hapus dokumen?', destructive: true, confirmLabel: 'Hapus', message: <>Dokumen <b>{d.title}</b> beserta seluruh riwayat versinya akan dihapus permanen.</> })) {
      await act(() => api.documents.remove(d.id), 'Dokumen dihapus.');
    }
  };

  const reExport = (d: DocumentSummary, kind: 'docx' | 'pdf') => act(async () => {
    const full = await api.documents.get(d.id);
    const r = await api.export[kind]({
      title: full.title, category_code: full.category_code, doc_date: full.doc_date, content: full.content, layout: full.layout,
      header_text: full.header_text, footer_text: full.footer_text, use_kop: full.use_kop
    });
    if (!r.canceled && r.path) toast(`Tersimpan: ${r.path}`, 'success', { label: 'Buka folder', run: () => { api.showInFolder(r.path!).catch((e) => toast(errMsg(e), 'error')); } });
  });

  return (
    <Page>
      <PageHeader title="Arsip Dokumen" subtitle="Seluruh dokumen yang sudah disimpan." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="w-72" placeholder="Cari judul, nomor, tujuan, perihal, isi…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Semua kategori</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select className="w-48" value={status} onChange={(e) => setStatus(e.target.value as DocStatus | '')}>
          <option value="">Semua status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
        <label className="flex items-center gap-1 text-xs text-slate-600">Dari<Input type="date" className="w-40" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label className="flex items-center gap-1 text-xs text-slate-600">Sampai<Input type="date" className="w-40" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
        <Select className="w-44" value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="created_at">Urut: Tanggal dibuat</option><option value="updated_at">Urut: Diperbarui</option><option value="doc_date">Urut: Tanggal dokumen</option>
          <option value="title">Urut: Nama</option><option value="letter_number">Urut: Nomor surat</option><option value="status">Urut: Status</option></Select>
        <Button variant="outline" size="icon" aria-label="Arah urutan" onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}>{sortDir === 'asc' ? <ArrowUpAZ size={16} /> : <ArrowDownAZ size={16} />}</Button>
      </div>
      {list.error && <Empty>{list.error}</Empty>}
      {list.data && list.data.length === 0 && <Empty>Tidak ada dokumen yang cocok dengan filter.</Empty>}
      {!!list.data?.length && (
        <div className="overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="p-3">Nama dokumen</th><th className="p-3">Kategori</th><th className="p-3">Nomor</th><th className="p-3">Tujuan</th><th className="p-3">Perihal</th>
                <th className="p-3">Tgl dokumen</th><th className="p-3">Dibuat</th><th className="p-3">Status</th><th className="p-3 text-right">Aksi</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.data.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="max-w-[240px] p-3"><Link to={`/documents/${d.id}`} className="block truncate font-medium text-navy-800 hover:underline">{d.title}</Link></td>
                  <td className="p-3">{d.category_name}</td>
                  <td className="p-3">{d.letter_number || '–'}</td>
                  <td className="max-w-[160px] truncate p-3">{d.recipient || '–'}</td>
                  <td className="max-w-[200px] truncate p-3">{d.subject || '–'}</td>
                  <td className="p-3 whitespace-nowrap">{d.doc_date || '–'}</td>
                  <td className="p-3 whitespace-nowrap text-xs text-slate-500">{formatDateTime(d.created_at)}</td>
                  <td className="p-3">
                    <Select className="h-8 w-40 py-0 text-xs" value={d.status} aria-label="Status"
                      onChange={(e) => act(() => api.documents.setStatus(d.id, e.target.value as DocStatus))}>
                      {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                    <Badge className="mt-1 hidden" tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" title="Buka" onClick={() => navigate(`/documents/${d.id}`)}><ExternalLink size={15} /></Button>
                      <Button size="icon" variant="ghost" title="Duplikat" onClick={() => act(() => api.documents.duplicate(d.id), 'Dokumen diduplikasi.')}><Copy size={15} /></Button>
                      <Button size="icon" variant="ghost" title="Export ulang DOCX" onClick={() => reExport(d, 'docx')}><FileText size={15} /></Button>
                      <Button size="icon" variant="ghost" title="Export ulang PDF" onClick={() => reExport(d, 'pdf')}><FileDown size={15} /></Button>
                      <Button size="icon" variant="ghost" title="Hapus" className="text-red-600" onClick={() => remove(d)}><Trash2 size={15} /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
