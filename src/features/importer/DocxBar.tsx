import { useEffect, useState } from 'react';
import { AlertTriangle, FileText, FileDown, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { ReportDialog } from '@/features/importer/ReportDialog';
import { api } from '@/services/api';
import type { DocumentRecord } from '@shared/types';

/** Bilah untuk dokumen hasil template Word: ekspor DOCX asli, PDF setia (LibreOffice), regenerasi dari formulir. */
export function DocxBar({ doc, onChanged }: { doc: DocumentRecord; onChanged: () => void }) {
  const { toast, confirm } = useFeedback();
  const [lo, setLo] = useState(false);
  const [busy, setBusy] = useState('');
  const [report, setReport] = useState(false);
  const edited = doc.docx_state === 'edited';
  useEffect(() => { api.importer.capabilities().then((c) => setLo(c.libreoffice)).catch(() => setLo(false)); }, []);

  const saved = (r: { canceled: boolean; path?: string }) => { if (!r.canceled && r.path) toast(`Tersimpan: ${r.path}`, 'success', { label: 'Buka folder', run: () => { api.showInFolder(r.path!).catch((e) => toast(errMsg(e), 'error')); } }); };
  const run = async (kind: 'docx' | 'pdf') => {
    if (edited && kind === 'docx' && !(await confirm({ title: 'Dokumen telah disunting di editor', confirmLabel: 'Ekspor DOCX asli',
      message: 'Berkas Word asli tidak memuat perubahan dari editor. Gunakan "Perbarui dari Formulir" atau tombol Export DOCX biasa pada editor untuk menyertakan perubahan Anda.' }))) return;
    setBusy(kind);
    try { saved(kind === 'docx' ? await api.importer.exportDocx(doc.id) : await api.importer.exportPdf(doc.id)); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
  };
  const regen = async () => {
    if (!(await confirm({ title: 'Perbarui dari formulir?', confirmLabel: 'Perbarui', message: 'Berkas Word dibuat ulang dari template dan nilai formulir tersimpan. Perubahan manual di editor akan hilang.' }))) return;
    setBusy('regen');
    try { await api.importer.regenerate(doc.id, doc.form_values); toast('Dokumen diperbarui dari formulir.', 'success'); onChanged(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900">
      <FileText size={14} /> <b>Dokumen Word asli</b> — format kop, font, tabel dipertahankan. Editor di bawah hanya pratinjau teks.
      {edited && <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-amber-900"><AlertTriangle size={12} /> Disunting di editor: berkas Word asli belum memuat perubahan</span>}
      <span className="flex-1" />
      <Button size="sm" disabled={!!busy} onClick={() => run('docx')}><FileText size={14} /> {busy === 'docx' ? 'Menyimpan…' : 'Export DOCX asli'}</Button>
      <Button size="sm" variant="outline" disabled={!!busy || edited} title={lo ? '' : 'Membutuhkan LibreOffice'} onClick={() => run('pdf')}><FileDown size={14} /> PDF (setia){lo ? '' : ' — butuh LibreOffice'}</Button>
      <Button size="sm" variant="outline" onClick={() => setReport(true)}><ShieldCheck size={14} /> Validasi & Bandingkan</Button>
      <Button size="sm" variant="outline" disabled={!!busy} onClick={regen}><RefreshCw size={14} /> Perbarui dari Formulir</Button>
      {report && <ReportDialog docId={doc.id} onClose={() => setReport(false)} />}
    </div>
  );
}
