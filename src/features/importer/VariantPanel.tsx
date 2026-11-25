import { useEffect, useState } from 'react';
import { Eye, GitCompare, Layers, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { renderPages } from '@/features/importer/ReportDialog';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import type { ImportReview, VariantGroup, VariantItem } from '@shared/importer';

const STATUS: Record<VariantGroup['status'], { label: string; tone: 'green' | 'amber' | 'slate' }> = {
  auto: { label: 'Terdeteksi otomatis', tone: 'green' }, confirmed: { label: 'Dikonfirmasi', tone: 'green' }, confirm: { label: 'Perlu konfirmasi', tone: 'amber' }, rejected: { label: 'Ditolak', tone: 'slate' }
};

/** Pratinjau satu varian: teks paragraf varian (wilayah khusus varian disorot) dan, bila LibreOffice ada, halaman hasil render. */
function PreviewDialog({ review, group, variant, libreoffice, onClose }: { review: ImportReview; group: VariantGroup; variant: VariantItem; libreoffice: boolean; onClose: () => void }) {
  const { toast } = useFeedback();
  const [tab, setTab] = useState<'teks' | 'pdf'>('teks');
  const [pages, setPages] = useState<HTMLCanvasElement[] | null>(null);
  const [busy, setBusy] = useState(false);
  const master = group.variants[0];
  const ps = review.analysis.paras.filter((p) => p.part === 'word/document.xml' && p.index >= variant.para_first && p.index <= variant.para_last && p.text.trim());
  const loadPdf = async () => {
    setBusy(true);
    try { const r = await api.importer.variantPdf(review.summary.id, variant.id); setPages(await renderPages(r.pdf, 1)); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-3"><div className="font-semibold text-navy-900">Pratinjau {variant.label}</div><Button size="icon" variant="ghost" aria-label="Tutup" onClick={onClose}><X size={16} /></Button></div>
        <div className="flex gap-2 border-b px-3 py-2 text-xs">
          <button className={cn('rounded-full px-3 py-1 font-medium', tab === 'teks' ? 'bg-navy-800 text-white' : 'bg-slate-200')} onClick={() => setTab('teks')}>Teks & struktur</button>
          <button className={cn('rounded-full px-3 py-1 font-medium', tab === 'pdf' ? 'bg-navy-800 text-white' : 'bg-slate-200')} onClick={() => { setTab('pdf'); if (!pages && libreoffice) void loadPdf(); }}>Tampilan halaman</button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'teks' && (
            <div className="space-y-1 rounded bg-slate-50 p-3 text-sm">
              {ps.map((p) => {
                const info = review.variant_map[p.key];
                const specific = variant.id !== master.id && info && !info.inherits;
                const masterOnly = variant.id === master.id && group.variants.slice(1).every((v) => v.align.every(([m]) => m !== p.index));
                return <div key={p.key} className={cn('whitespace-pre-wrap rounded px-1', (specific || masterOnly) && 'bg-amber-100')}>{p.text}{(specific || masterOnly) && <span className="ml-2 rounded bg-amber-200 px-1 text-[10px]">khusus varian</span>}</div>;
              })}
            </div>
          )}
          {tab === 'pdf' && (!libreoffice ? <p className="text-sm text-slate-500">Tampilan halaman membutuhkan LibreOffice terpasang. Pratinjau teks tetap tersedia; Microsoft Word tetap acuan akhir.</p>
            : busy ? <p className="text-sm text-slate-500">Merender…</p>
            : <div className="space-y-3">{pages?.map((c, i) => <img key={i} alt={`Halaman ${i + 1}`} src={c.toDataURL()} className="w-full border border-slate-300 shadow" />)}</div>)}
        </div>
      </div>
    </div>
  );
}

/** Variant Manager: master tunggal, varian-variannya, perbedaan, konfirmasi, dan penggantian nama. */
export function VariantPanel({ review, edits, setEdits, ensureSaved, reload }: {
  review: ImportReview; edits: Record<number, Record<string, string>>; setEdits: (v: Record<number, Record<string, string>>) => void;
  ensureSaved: () => Promise<boolean>; reload: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [preview, setPreview] = useState<{ g: VariantGroup; v: VariantItem } | null>(null);
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [lo, setLo] = useState(false);
  const [reg, setReg] = useState<Awaited<ReturnType<typeof api.importer.variantRegistry>> | null>(null);
  useEffect(() => { api.importer.capabilities().then((c) => setLo(c.libreoffice)).catch(() => undefined); api.importer.variantRegistry(review.summary.id).then(setReg).catch(() => undefined); }, [review.summary.id, review.summary.updated_at]);
  if (!review.variant_groups.length) return null;

  const decide = async (g: VariantGroup, d: 'confirm' | 'reject') => {
    if (d === 'reject' && !(await confirm({ title: 'Perlakukan sebagai satu template?', message: 'Halaman tidak digabung atau dibuang: seluruh halaman tetap ada di template, dan saran isian untuk halaman kedua dikembalikan. Deteksi varian dimatikan untuk impor ini.', confirmLabel: 'Tolak varian' }))) return;
    if (!(await ensureSaved())) return;
    try { await api.importer.variantDecision(review.summary.id, g.group_no, d); toast(d === 'confirm' ? 'Dikonfirmasi: konfigurasi isian dipakai bersama oleh semua varian.' : 'Varian ditolak; dokumen diperlakukan sebagai satu template.', 'success'); reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 font-semibold text-navy-900"><Layers size={16} /> Varian template</div>
      {review.variant_groups.map((g) => {
        const labelOf = (v: VariantItem) => edits[g.group_no]?.[v.id] ?? v.label;
        return (
          <Card key={g.group_no} className={cn('space-y-2 p-3 text-xs', g.status === 'confirm' && 'border-amber-300 bg-amber-50')}>
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold text-navy-900">Master: {review.name}</span><Badge tone={STATUS[g.status].tone}>{STATUS[g.status].label}</Badge><Badge>{Math.round(g.similarity * 100)}% mirip</Badge></div>
            <div className="text-slate-600">{g.reason}</div>
            {g.notes.map((n, i) => <div key={i} className="text-amber-800">{n}</div>)}
            <div className="space-y-2">
              {g.variants.map((v, i) => (
                <div key={v.id} className="rounded border border-slate-200 bg-white p-2">
                  <div className="flex items-center gap-2">
                    <Badge tone="navy">{v.letter}</Badge>
                    <Input className="h-7 text-xs" value={labelOf(v)} aria-label={`Nama varian ${v.letter}`} onChange={(e) => setEdits({ ...edits, [g.group_no]: { ...(edits[g.group_no] ?? {}), [v.id]: e.target.value } })} />
                    <Button size="icon" variant="ghost" aria-label="Pratinjau" title="Pratinjau varian" onClick={() => setPreview({ g, v })}><Eye size={14} /></Button>
                    {i > 0 && <Button size="icon" variant="ghost" aria-label="Bandingkan" title="Bandingkan dengan master" onClick={() => setDiffFor(diffFor === v.id ? null : v.id)}><GitCompare size={14} /></Button>}
                  </div>
                  {v.summary && <div className="mt-1 truncate text-slate-500" title={v.summary}>{v.summary}</div>}
                  {diffFor === v.id && (
                    <table className="mt-2 w-full border-collapse text-[11px]"><thead><tr className="bg-slate-100 text-left"><th className="p-1">Bagian</th><th className="p-1">{g.variants[0].letter} (master)</th><th className="p-1">{v.letter}</th><th className="p-1" /></tr></thead>
                      <tbody>{v.diffs.map((d, k) => (
                        <tr key={k} className="border-t border-slate-100 align-top"><td className="p-1">{d.where}</td><td className="p-1">{d.master || '—'}</td><td className="p-1">{d.variant || '—'}</td>
                          <td className="p-1"><Badge tone={d.shared ? 'green' : 'amber'}>{d.shared ? 'isian bersama' : 'khusus varian'}</Badge></td></tr>
                      ))}{!v.diffs.length && <tr><td colSpan={4} className="p-1 text-slate-500">Identik dengan master (duplikat).</td></tr>}</tbody></table>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {g.status === 'confirm' && g.selectable && <Button size="sm" onClick={() => decide(g, 'confirm')}>Konfirmasi sebagai varian</Button>}
              <Button size="sm" variant="outline" onClick={() => decide(g, 'reject')}>Perlakukan sebagai satu template</Button>
            </div>
          </Card>
        );
      })}
      {reg && <div className="rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">Registrasi: master {reg.master_templates} · kategori {reg.document_categories} · varian {reg.template_variants} · konfigurasi isian bersama {reg.shared_placeholder_configurations} · duplikat di halaman varian {reg.duplicated_in_variants}. Pewarisan: {review.inherited_count} isian turunan memakai pemetaan master.</div>}
      {preview && <PreviewDialog review={review} group={preview.g} variant={preview.v} libreoffice={lo} onClose={() => setPreview(null)} />}
    </div>
  );
}
