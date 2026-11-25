import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Eye, FileDown, FileText, History, Printer, RefreshCw, Save, SaveAll, SlidersHorizontal, Undo2 } from 'lucide-react';
import { RichEditor } from '@/features/editor/RichEditor';
import { Button } from '@/components/ui/button';
import { Badge, STATUS_LABEL } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { formatDateTime } from '@/lib/utils';
import { buildDocumentHtml } from '@shared/render';
import { unresolvedKeys } from '@shared/placeholder';
import { FONT_FAMILIES } from '@shared/settings';
import type { DocumentInput, DocumentRecord, DocStatus, ExportDoc, TipTapNode } from '@shared/types';

/** number_*: hanya ada saat dokumen baru dibuat dari template yang terhubung ke register penomoran. */
export type Draft = Omit<DocumentInput, 'content' | 'note'> & { number_record_id?: string | null; number_refs?: Array<{ key: string; record_id: string }> };

export const recordToDraft = (r: DocumentRecord): Draft => ({
  id: r.id, template_id: r.template_id, template_name: r.template_name, category_id: r.category_id, title: r.title,
  letter_number: r.letter_number, recipient: r.recipient, subject: r.subject, doc_date: r.doc_date, status: r.status,
  header_text: r.header_text, footer_text: r.footer_text, layout: r.layout, form_values: r.form_values, use_kop: r.use_kop
});

interface Props {
  initial: Draft;
  content: TipTapNode;
  contentKey: string | number;
  onSaved?: (r: DocumentRecord, asNew: boolean) => void;
  onRegenerate?: () => void;
  onEditForm?: () => void;
}

export function Workbench({ initial, content, contentKey, onSaved, onRegenerate, onEditForm }: Props) {
  const { toast, confirm } = useFeedback();
  const { settings, kop } = useSettings();
  const cats = useAsync(() => api.categories(), []);
  const [draft, setDraft] = useState<Draft>(initial);
  const [cur, setCur] = useState({ content, key: `${contentKey}-0` });
  const contentRef = useRef<TipTapNode>(content);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [unresolved, setUnresolved] = useState(() => unresolvedKeys(content).length);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const tick = useRef(0);

  useEffect(() => { contentRef.current = content; setCur({ content, key: `${contentKey}-${++tick.current}` }); setUnresolved(unresolvedKeys(content).length); }, [content, contentKey]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => { setDraft((d) => ({ ...d, [k]: v })); setDirty(true); };
  const setLayout = (patch: Partial<Draft['layout']>) => set('layout', { ...draft.layout, ...patch });

  const onChange = useCallback((json: TipTapNode) => {
    contentRef.current = json;
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setUnresolved(unresolvedKeys(json).length), 400);
  }, []);

  const save = async (asNew: boolean) => {
    if (!draft.title.trim()) { toast('Nama dokumen wajib diisi.', 'error'); return; }
    setBusy('save');
    try {
      const rec = await api.documents.save({ ...draft, id: asNew ? undefined : draft.id, title: asNew && draft.id ? `${draft.title} (Salinan)` : draft.title, content: contentRef.current });
      setDraft(recordToDraft(rec));
      setDirty(false);
      toast(asNew ? 'Disimpan sebagai dokumen baru.' : 'Dokumen tersimpan di arsip.', 'success');
      if (rec.numbering && !rec.numbering.in_content) toast(`Peringatan: nomor resmi ${rec.numbering.number_text} tidak ditemukan di isi dokumen. Pastikan nomor tertulis pada dokumen sebelum difinalkan.`, 'info');
      onSaved?.(rec, asNew);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
  };

  const exportDoc = (): ExportDoc => ({
    title: draft.title || 'Dokumen', category_code: cats.data?.find((c) => c.id === draft.category_id)?.code ?? 'DOK', doc_date: draft.doc_date,
    content: contentRef.current, layout: draft.layout, header_text: draft.header_text, footer_text: draft.footer_text, use_kop: draft.use_kop
  });

  const run = async (kind: 'docx' | 'pdf' | 'print') => {
    const keys = unresolvedKeys(contentRef.current);
    if (keys.length) {
      const ok = await confirm({ title: 'Masih ada placeholder belum terisi', confirmLabel: 'Tetap lanjutkan',
        message: <>Dokumen masih memuat {keys.length} placeholder: <b>{keys.map((k) => `[${k}]`).join(', ')}</b>. Lanjutkan?</> });
      if (!ok) return;
    }
    setBusy(kind);
    try {
      if (kind === 'print') { await api.export.print(exportDoc()); return; }
      const r = await api.export[kind](exportDoc());
      if (!r.canceled && r.path) toast(`Tersimpan: ${r.path}`, 'success', { label: 'Buka folder', run: () => { api.showInFolder(r.path!).catch((e) => toast(errMsg(e), 'error')); } });
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
  };

  const preview = () => setPreviewHtml(buildDocumentHtml({
    title: draft.title, content: contentRef.current, layout: draft.layout, kop: draft.use_kop ? kop : null, mode: 'preview'
  }));

  const duplicate = async () => {
    if (!draft.id) return;
    try { const r = await api.documents.duplicate(draft.id); toast('Dokumen diduplikasi sebagai draft baru.', 'success'); onSaved?.(r, true); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const restored = (r: DocumentRecord) => {
    setDraft(recordToDraft(r)); contentRef.current = r.content;
    setCur({ content: r.content, key: `restored-${++tick.current}` }); setUnresolved(unresolvedKeys(r.content).length); setDirty(false); setVersionsOpen(false);
    toast('Versi dipulihkan.', 'success');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <Input className="h-9 min-w-[240px] flex-1 font-semibold" placeholder="Nama dokumen" value={draft.title} onChange={(e) => set('title', e.target.value)} />
        <Select className="w-44" value={draft.status} onChange={(e) => set('status', e.target.value as DocStatus)} aria-label="Status">
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        {unresolved > 0 && <Badge tone="amber">{unresolved} placeholder belum terisi</Badge>}
        {dirty && <Badge tone="navy">Belum disimpan</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5">
        <Button size="sm" disabled={!!busy} onClick={() => save(false)}><Save size={14} /> {draft.id ? 'Simpan' : 'Simpan sebagai Draft'}</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => save(true)}><SaveAll size={14} /> Simpan sebagai Baru</Button>
        <Button size="sm" variant="outline" onClick={preview}><Eye size={14} /> Pratinjau</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('docx')}><FileText size={14} /> {busy === 'docx' ? 'Membuat…' : 'Export DOCX'}</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('pdf')}><FileDown size={14} /> {busy === 'pdf' ? 'Membuat…' : 'Export PDF'}</Button>
        <Button size="sm" variant="outline" disabled={!!busy} onClick={() => run('print')}><Printer size={14} /> Cetak</Button>
        {draft.id && <Button size="sm" variant="ghost" onClick={duplicate}><Copy size={14} /> Duplikat</Button>}
        {draft.id && <Button size="sm" variant="ghost" onClick={() => setVersionsOpen(true)}><History size={14} /> Riwayat Versi</Button>}
        {onRegenerate && <Button size="sm" variant="ghost" onClick={onRegenerate}><RefreshCw size={14} /> Regenerate</Button>}
        {onEditForm && <Button size="sm" variant="ghost" onClick={onEditForm}><Undo2 size={14} /> Ubah Formulir</Button>}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <RichEditor key={cur.key} content={cur.content} onChange={onChange} layout={draft.layout} aiEnabled={settings.ai_enabled === 'true'} />
        </div>
        <aside className="w-80 shrink-0 space-y-3 overflow-auto border-l border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-navy-900"><SlidersHorizontal size={16} /> Informasi Arsip</div>
          <Field label="Kategori">
            <Select value={draft.category_id ?? ''} onChange={(e) => set('category_id', e.target.value || null)}>
              <option value="">— Tanpa kategori —</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Nomor surat"><Input value={draft.letter_number} onChange={(e) => set('letter_number', e.target.value)} /></Field>
          <Field label="Tujuan surat"><Input value={draft.recipient} onChange={(e) => set('recipient', e.target.value)} /></Field>
          <Field label="Perihal"><Input value={draft.subject} onChange={(e) => set('subject', e.target.value)} /></Field>
          <Field label="Tanggal dokumen"><Input type="date" value={draft.doc_date} onChange={(e) => set('doc_date', e.target.value)} /></Field>
          <Switch checked={draft.use_kop} onChange={(v) => set('use_kop', v)} label="Gunakan kop surat (halaman pertama)" />
          <Field label="Header" hint="Teks di bagian atas tiap halaman (opsional)"><Textarea className="min-h-[52px]" value={draft.header_text} onChange={(e) => set('header_text', e.target.value)} /></Field>
          <Field label="Footer" hint="Teks di bagian bawah tiap halaman (opsional)"><Textarea className="min-h-[52px]" value={draft.footer_text} onChange={(e) => set('footer_text', e.target.value)} /></Field>
          <div className="border-t border-slate-200 pt-3 text-sm font-semibold text-navy-900">Tata Letak Halaman (A4)</div>
          <Field label="Font"><Select value={draft.layout.fontFamily} onChange={(e) => setLayout({ fontFamily: e.target.value })}>
            {[...new Set([draft.layout.fontFamily, ...FONT_FAMILIES])].map((f) => <option key={f}>{f}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Ukuran (pt)"><Input type="number" min={6} max={72} value={draft.layout.fontSize} onChange={(e) => setLayout({ fontSize: Number(e.target.value) || 12 })} /></Field>
            <Field label="Spasi baris"><Input type="number" step={0.05} min={0.8} max={3} value={draft.layout.lineHeight} onChange={(e) => setLayout({ lineHeight: Number(e.target.value) || 1.15 })} /></Field>
            <Field label="Margin atas (mm)"><Input type="number" min={0} max={80} value={draft.layout.marginTop} onChange={(e) => setLayout({ marginTop: Number(e.target.value) || 0 })} /></Field>
            <Field label="Margin bawah"><Input type="number" min={0} max={80} value={draft.layout.marginBottom} onChange={(e) => setLayout({ marginBottom: Number(e.target.value) || 0 })} /></Field>
            <Field label="Margin kiri"><Input type="number" min={0} max={80} value={draft.layout.marginLeft} onChange={(e) => setLayout({ marginLeft: Number(e.target.value) || 0 })} /></Field>
            <Field label="Margin kanan"><Input type="number" min={0} max={80} value={draft.layout.marginRight} onChange={(e) => setLayout({ marginRight: Number(e.target.value) || 0 })} /></Field>
          </div>
          <Switch checked={draft.layout.showPageNumber} onChange={(v) => setLayout({ showPageNumber: v })} label="Nomor halaman di footer" />
          <p className="text-xs text-slate-500">Garis abu-abu pada kertas menandai kira-kira batas halaman. Pemisahan halaman final mengikuti hasil export DOCX/PDF.</p>
        </aside>
      </div>

      <Dialog open={previewHtml !== null} onOpenChange={(o) => { if (!o) setPreviewHtml(null); }}>
        {previewHtml !== null && (
          <DialogContent wide title="Pratinjau dokumen" className="h-[90vh]">
            <iframe title="Pratinjau" sandbox="" srcDoc={previewHtml} className="h-[70vh] w-full rounded border border-slate-200 bg-slate-300" />
          </DialogContent>
        )}
      </Dialog>
      {draft.id && <VersionsDialog open={versionsOpen} onOpenChange={setVersionsOpen} documentId={draft.id} draft={draft} onRestored={restored} />}
    </div>
  );
}

function VersionsDialog({ open, onOpenChange, documentId, draft, onRestored }: {
  open: boolean; onOpenChange: (o: boolean) => void; documentId: string; draft: Draft; onRestored: (r: DocumentRecord) => void;
}) {
  const { toast, confirm } = useFeedback();
  const { kop } = useSettings();
  const list = useAsync(() => (open ? api.documents.versions(documentId) : Promise.resolve([])), [open, documentId]);
  const [html, setHtml] = useState<string | null>(null);
  const view = async (id: string) => {
    try { const v = await api.documents.version(id); setHtml(buildDocumentHtml({ title: v.title, content: v.content, layout: draft.layout, kop: draft.use_kop ? kop : null, mode: 'preview' })); }
    catch (e) { toast(errMsg(e), 'error'); }
  };
  const restore = async (id: string, no: number) => {
    if (!(await confirm({ title: `Pulihkan versi ${no}?`, message: 'Isi dokumen saat ini diganti dengan versi ini. Keadaan sebelumnya tetap tersimpan sebagai versi baru.', confirmLabel: 'Pulihkan' }))) return;
    try { onRestored(await api.documents.restoreVersion(id)); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setHtml(null); }}>
      <DialogContent wide title="Riwayat Versi" description="Versi baru dibuat otomatis setiap isi dokumen berubah saat disimpan (maks. 50 versi).">
        <div className="grid grid-cols-[320px_1fr] gap-4">
          <ul className="max-h-[60vh] space-y-2 overflow-auto">
            {list.data?.map((v) => (
              <li key={v.id} className="rounded border border-slate-200 p-2 text-sm">
                <div className="font-semibold">Versi {v.version_no}</div>
                <div className="text-xs text-slate-500">{formatDateTime(v.created_at)}{v.note ? ` · ${v.note}` : ''}</div>
                <div className="mt-1 flex gap-2"><Button size="sm" variant="outline" onClick={() => view(v.id)}>Lihat</Button><Button size="sm" variant="secondary" onClick={() => restore(v.id, v.version_no)}>Pulihkan</Button></div>
              </li>
            ))}
          </ul>
          {html ? <iframe title="Versi" sandbox="" srcDoc={html} className="h-[60vh] w-full rounded border border-slate-200" /> : <div className="grid place-items-center text-sm text-slate-500">Pilih "Lihat" untuk meninjau versi.</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
