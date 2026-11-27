import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ShieldCheck, X, XCircle } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'; // legacy: Chromium Electron 33 belum punya Uint8Array.toHex
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ValidationReport, VisualCompareResult } from '@shared/importer';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function renderPages(data: string, scale: number): Promise<HTMLCanvasElement[]> {
  const doc = await pdfjs.getDocument({ data: b64(data) }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    await page.render({ canvasContext: c.getContext('2d') as CanvasRenderingContext2D, viewport: vp, canvas: c }).promise;
    out.push(c);
  }
  return out;
}

function diffRatio(a: HTMLCanvasElement, b: HTMLCanvasElement): number {
  const w = Math.min(a.width, b.width); const h = Math.min(a.height, b.height);
  const da = a.getContext('2d')!.getImageData(0, 0, w, h).data; const db = b.getContext('2d')!.getImageData(0, 0, w, h).data;
  let n = 0;
  for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n++;
  return n / (w * h);
}

const Page = ({ canvas }: { canvas?: HTMLCanvasElement }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const el = ref.current; if (el && canvas) { el.width = canvas.width; el.height = canvas.height; el.getContext('2d')!.drawImage(canvas, 0, 0); } }, [canvas]);
  return canvas ? <canvas ref={ref} className="h-auto w-full border border-slate-300 bg-white shadow" /> : <div className="flex h-40 items-center justify-center border border-dashed text-xs text-slate-400">tidak ada halaman</div>;
};

/** Laporan validasi (hash komponen terlindungi, dll) dan perbandingan visual Original vs Generated. */
export function ReportDialog({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { toast } = useFeedback();
  const [tab, setTab] = useState<'val' | 'vis'>('val');
  const [rep, setRep] = useState<ValidationReport | null>(null);
  const [vis, setVis] = useState<VisualCompareResult | null>(null);
  const [pages, setPages] = useState<{ o: HTMLCanvasElement[]; g: HTMLCanvasElement[]; diff: number[] } | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.importer.validation(docId).then(setRep).catch((e) => toast(errMsg(e), 'error')); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [docId]);

  const runVisual = async () => {
    setBusy(true);
    try {
      const r = await api.importer.visualCompare(docId); setVis(r);
      const [o, g] = await Promise.all([renderPages(r.original_pdf, 1), renderPages(r.generated_pdf, 1)]);
      setPages({ o, g, diff: o.map((c, i) => (g[i] ? diffRatio(c, g[i]) : 1)) });
      setPage(0);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  const Icon = ({ s }: { s: string }) => s === 'pass' ? <CheckCircle2 size={16} className="text-emerald-600" /> : s === 'warn' ? <AlertTriangle size={16} className="text-amber-600" /> : <XCircle size={16} className="text-red-600" />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-3">
          <div className="flex items-center gap-2 font-semibold text-navy-900"><ShieldCheck size={18} /> Validasi & Perbandingan Dokumen</div>
          <Button size="icon" variant="ghost" aria-label="Tutup" onClick={onClose}><X size={16} /></Button>
        </div>
        <div className="flex gap-2 border-b px-3 py-2 text-xs">
          <button className={cn('rounded-full px-3 py-1 font-medium', tab === 'val' ? 'bg-navy-800 text-white' : 'bg-slate-200')} onClick={() => setTab('val')}>Laporan validasi</button>
          <button className={cn('rounded-full px-3 py-1 font-medium', tab === 'vis' ? 'bg-navy-800 text-white' : 'bg-slate-200')} onClick={() => setTab('vis')}>Perbandingan visual</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'val' && (rep ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">{rep.ok ? <Badge tone="green">Lolos validasi</Badge> : <Badge tone="red">Gagal — ekspor dihentikan</Badge>}<span className="text-xs text-slate-500">{rep.created_at}</span></div>
              <ul className="space-y-1">{rep.checks.map((c) => (
                <li key={c.id} className="flex items-start gap-2 rounded border border-slate-200 p-2 text-sm"><Icon s={c.status} /><div><div className="font-medium text-navy-900">{c.label}</div><div className="text-xs text-slate-600">{c.detail}</div></div></li>
              ))}</ul>
              <details className="text-xs"><summary className="cursor-pointer font-semibold text-navy-900">SHA-256 komponen terlindungi ({Object.keys(rep.protected_hashes).length})</summary>
                <table className="mt-1 w-full font-mono"><tbody>{Object.entries(rep.protected_hashes).map(([k, h]) => <tr key={k} className="border-t border-slate-100"><td className="pr-2">{k}</td><td className="text-slate-500">{String(h).slice(0, 24)}…</td></tr>)}</tbody></table>
              </details>
              <p className="text-xs text-slate-500">XML yang tidak berubah tidak menjamin tampilan identik. Gunakan tab Perbandingan visual dan periksa akhir di Microsoft Word.</p>
            </div>
          ) : <p className="text-sm text-slate-500">Belum ada laporan validasi untuk dokumen ini.</p>)}

          {tab === 'vis' && (
            <div className="space-y-3">
              {!vis && <div className="space-y-2"><p className="text-sm text-slate-600">Membandingkan render LibreOffice dari dokumen sumber asli dan dokumen hasil. Isi yang berbeda memang akan tampak berbeda; yang diperiksa adalah gambar, header/footer, jumlah halaman, overflow, dan tata letak tabel.</p><Button onClick={runVisual} disabled={busy}>{busy ? 'Merender…' : 'Jalankan perbandingan visual'}</Button></div>}
              {vis && pages && (<>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {vis.report.material ? <Badge tone="amber">Ada perbedaan material — periksa temuan</Badge> : <Badge tone="green">Tidak ada perbedaan tata letak material</Badge>}
                  <Badge>Halaman: {vis.report.pages_original} → {vis.report.pages_generated}</Badge>
                  <span className="text-xs text-slate-500">Microsoft Word tetap acuan kompatibilitas akhir.</span>
                </div>
                <ul className="space-y-1 text-xs">{vis.report.findings.map((f, i) => <li key={i} className={cn('rounded border p-2', f.level === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-slate-200')}>{f.message}</li>)}{!vis.report.findings.length && <li className="text-slate-500">Tidak ada temuan.</li>}</ul>
                <div className="flex items-center gap-2 text-xs">
                  {Array.from({ length: Math.max(pages.o.length, pages.g.length) }, (_, i) => (
                    <button key={i} onClick={() => setPage(i)} className={cn('rounded border px-2 py-1', page === i ? 'border-navy-600 bg-navy-50' : 'border-slate-300')}>Hal. {i + 1}{pages.diff[i] !== undefined ? ` · ${(pages.diff[i] * 100).toFixed(1)}% beda` : ' · baru'}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3"><div><div className="mb-1 text-xs font-semibold">Original</div><Page canvas={pages.o[page]} /></div><div><div className="mb-1 text-xs font-semibold">Generated</div><Page canvas={pages.g[page]} /></div></div>
              </>)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
