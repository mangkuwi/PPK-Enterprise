import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CheckCheck, Download, FilePlus2, GitCompare, History, Lock, LockOpen, Plus, RefreshCw, Save, Table2 } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { MappingEditor, STATUS_LABEL_MAP, TYPE_LABEL } from '@/features/importer/MappingEditor';
import { ParaText, selectionInPara } from '@/features/importer/ParaText';
import { CompareView } from '@/features/importer/CompareView';
import { VariantPanel } from '@/features/importer/VariantPanel';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { fieldKeyOk, isApplied, snakeName, type CompareView as CV, type GroupRec, type ImportReview, type MappingRec } from '@shared/importer';
import { inferType } from '@shared/placeholder';

type Tab = 'review' | 'compare';

export default function ImporterReviewPage() {
  const { id } = useParams();
  const rv = useAsync(() => api.importer.review(id!), [id]);
  if (rv.loading) return <Page><p className="text-sm text-slate-500">Memuat hasil analisis…</p></Page>;
  if (rv.error || !rv.data) return <Page><Empty>{rv.error ?? 'Data impor tidak ditemukan.'}</Empty></Page>;
  return <ReviewBody key={rv.data.summary.id + rv.data.summary.updated_at} initial={rv.data} reload={rv.reload} />;
}

function ReviewBody({ initial, reload }: { initial: ImportReview; reload: () => void }) {
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const cats = useAsync(() => api.categories(), []);
  const [mappings, setMappings] = useState<MappingRec[]>(initial.analysis.mappings);
  const [groups, setGroups] = useState<GroupRec[]>(initial.analysis.groups);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [categoryId, setCategoryId] = useState<string | null>(initial.summary.category_id);
  const [selected, setSelected] = useState<string | null>(null);
  const [prot, setProt] = useState<string[]>(initial.protected_keys);
  const [vEdits, setVEdits] = useState<Record<number, Record<string, string>>>({});
  const toggleProt = (key: string) => { setProt((l) => (l.includes(key) ? l.filter((k) => k !== key) : [...l, key])); setDirty(true); };
  const [tab, setTab] = useState<Tab>('review');
  const [cmp, setCmp] = useState<CV | null>(null);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<{ key: string; start: number; end: number; text: string } | null>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const [sp] = useSearchParams();
  useEffect(() => { if (sp.get('tab') === 'compare') { api.importer.compare(initial.summary.id).then((c) => { setCmp(c); setTab('compare'); }).catch((e) => toast(errMsg(e), 'error')); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const a = initial.analysis;
  const selMap = mappings.find((m) => m.id === selected) ?? null;

  const patch = (mid: string, p: Partial<MappingRec>) => { setMappings((l) => l.map((m) => (m.id === mid ? { ...m, ...p } : m))); setDirty(true); };
  const input = () => ({ id: initial.summary.id, mappings, groups, name, description, category_id: categoryId, protected_keys: prot,
    variant_edits: Object.entries(vEdits).map(([g, labels]) => ({ group_no: Number(g), labels: labels as Record<string, string> })) });

  const detected = mappings.filter((m) => m.status === 'auto' || m.status === 'confirmed' || m.status === 'manual');
  const needConfirm = mappings.filter((m) => m.status === 'confirm');
  const rejected = mappings.filter((m) => m.status === 'rejected');
  const pendingGroups = groups.filter((g) => g.status === 'confirm');

  const paraByKey = useMemo(() => new Map(a.paras.map((p) => [p.key, p])), [a.paras]);
  const byPart = useMemo(() => {
    const out = new Map<string, typeof a.paras>();
    for (const p of a.paras) (out.get(p.part_label) ?? out.set(p.part_label, []).get(p.part_label)!).push(p);
    return [...out];
  }, [a.paras]);

  const confirmAll = () => {
    setMappings((l) => l.map((m) => (m.status === 'confirm' ? { ...m, status: 'confirmed' } : m)));
    setGroups((l) => l.map((g) => (g.status === 'confirm' ? { ...g, status: 'confirmed' } : g)));
    setDirty(true);
  };

  const addManual = () => {
    if (!sel) return;
    const p = paraByKey.get(sel.key);
    if (!p) return;
    const clash = mappings.some((m) => m.part === p.part && m.para_index === p.index && m.status !== 'rejected' && sel.start < m.end && sel.end > m.start);
    if (clash) { toast('Pilihan bertumpuk dengan isian lain. Tolak/hapus isian tersebut terlebih dahulu.', 'error'); return; }
    const base = snakeName(sel.text.split(/\s+/).slice(0, 3).join(' ')) || 'ISIAN';
    const m: MappingRec = {
      id: crypto.randomUUID(), part: p.part, para_index: p.index, start: sel.start, end: sel.end, source_text: sel.text, placeholder_name: base,
      label: base.replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase()), field_type: sel.text.length > 90 ? 'textarea' : inferType(base),
      default_value: sel.text, required: true, options: [], confidence: 1, status: 'manual', reason: 'Dipilih manual oleh pengguna.'
    };
    setMappings((l) => [...l, m]); setSelected(m.id); setSel(null); setDirty(true);
    window.getSelection()?.removeAllRanges();
  };

  const validate = (): string | null => {
    for (const m of mappings) if (m.status !== 'rejected' && !fieldKeyOk(m.placeholder_name)) return `Nama placeholder "${m.placeholder_name}" tidak valid.`;
    if (!name.trim()) return 'Nama template wajib diisi.';
    return null;
  };

  const save = async (): Promise<boolean> => {
    const bad = validate(); if (bad) { toast(bad, 'error'); return false; }
    setBusy('save');
    try { await api.importer.saveReview(input()); setDirty(false); toast('Hasil review tersimpan.', 'success'); return true; }
    catch (e) { toast(errMsg(e), 'error'); return false; } finally { setBusy(''); }
  };

  const saveTemplate = async () => {
    const bad = validate(); if (bad) { toast(bad, 'error'); return; }
    if (initial.variant_groups.some((g) => g.selectable && g.status === 'confirm')) { toast('Ada halaman mirip yang menunggu keputusan: konfirmasi sebagai varian atau perlakukan sebagai satu template (panel Varian).', 'error'); return; }
    if (needConfirm.length + pendingGroups.length) {
      const ok = await confirm({ title: 'Masih ada saran belum dikonfirmasi', confirmLabel: 'Simpan, abaikan saran',
        message: `${needConfirm.length} isian dan ${pendingGroups.length} tabel belum dikonfirmasi. Saran yang belum dikonfirmasi TIDAK dipakai dan tetap menjadi teks statis.` });
      if (!ok) return;
    }
    setBusy('tpl');
    try {
      const r = await api.importer.saveTemplate(input());
      setDirty(false);
      toast('Template Word tersimpan dan siap dipakai di menu Buat Dokumen.', 'success', { label: 'Gunakan', run: () => navigate(`/generator?template=${r.templateId}`) });
      reload();
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
  };

  const openCompare = async () => {
    if (dirty && !(await save())) return;
    setBusy('cmp');
    try { setCmp(await api.importer.compare(initial.summary.id)); setTab('compare'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
  };

  const reanalyze = async () => {
    if (!(await confirm({ title: 'Analisis ulang?', message: 'Seluruh pemetaan saat ini diganti hasil analisis baru dari berkas sumber.', confirmLabel: 'Analisis ulang' }))) return;
    try { await api.importer.reanalyze(initial.summary.id); toast('Analisis ulang selesai.', 'success'); setDirty(false); reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const downloadOriginal = async () => {
    try { const r = await api.importer.saveOriginal(initial.summary.id); if (!r.canceled) toast(`Sumber asli disimpan: ${r.path}`, 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  };

  const nameInUse = (n: string) => mappings.some((m) => m.id !== selected && m.status !== 'rejected' && m.placeholder_name === n);

  const Row = ({ m }: { m: MappingRec }) => (
    <button onClick={() => { setSelected(m.id); setTab('review'); }}
      className={cn('flex w-full items-start gap-2 rounded border p-2 text-left text-xs hover:bg-slate-50', selected === m.id ? 'border-navy-500 bg-navy-50' : 'border-slate-200')}>
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono font-semibold text-navy-900">{m.required ? '' : '?'}{m.placeholder_name}</div>
        <div className="truncate text-slate-500">{m.source_text}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-slate-500">{TYPE_LABEL[m.field_type]}</div>
        <Badge tone={isApplied(m) ? 'green' : m.status === 'rejected' ? 'red' : 'amber'}>{Math.round(m.confidence * 100)}% · {STATUS_LABEL_MAP[m.status]}</Badge>
      </div>
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200 bg-white px-5 py-3">
        <PageHeader title="Review Mapping" subtitle={`Sumber: ${initial.summary.original_filename} · berkas asli tidak pernah diubah`}
          actions={<>
            <Button size="sm" variant="outline" onClick={reanalyze}><RefreshCw size={14} /> Analisis ulang</Button>
            <Button size="sm" variant="outline" onClick={downloadOriginal}><Download size={14} /> Sumber asli</Button>
            <Button size="sm" variant="outline" onClick={openCompare} disabled={!!busy}><GitCompare size={14} /> Bandingkan</Button>
            <Button size="sm" variant="outline" onClick={confirmAll} disabled={!needConfirm.length && !pendingGroups.length}><CheckCheck size={14} /> Konfirmasi semua</Button>
            <Button size="sm" variant="outline" onClick={save} disabled={!!busy}><Save size={14} /> Simpan review</Button>
            <Button size="sm" onClick={saveTemplate} disabled={!!busy}><FilePlus2 size={14} /> Simpan sebagai Template</Button>
          </>} />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Nama template"><Input value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} /></Field>
          <Field label="Kategori">
            <Select value={categoryId ?? ''} onChange={(e) => { setCategoryId(e.target.value || null); setDirty(true); }}>
              <option value="">— Tanpa kategori —</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Deskripsi"><Input value={description} onChange={(e) => { setDescription(e.target.value); setDirty(true); }} /></Field>
        </div>
        <div className="mt-2 flex gap-2 text-xs">
          <button className={cn('rounded-full px-3 py-1 font-medium', tab === 'review' ? 'bg-navy-800 text-white' : 'bg-slate-200')} onClick={() => setTab('review')}>Review</button>
          <button className={cn('rounded-full px-3 py-1 font-medium', tab === 'compare' ? 'bg-navy-800 text-white' : 'bg-slate-200')} onClick={openCompare}>Template Preview / Perbandingan</button>
          {dirty && <Badge tone="navy">Belum disimpan</Badge>}
        </div>
      </div>

      {tab === 'compare' && cmp ? <div className="min-h-0 flex-1 overflow-auto p-5"><CompareView data={cmp} /></div> : (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_340px]">
          {/* Panel kiri: dokumen */}
          <div className="relative min-h-0 overflow-auto border-r border-slate-200 bg-slate-100 p-4" ref={leftRef}
            onMouseUp={() => setSel(leftRef.current ? selectionInPara(leftRef.current) : null)}>
            <div className="mb-2 text-xs text-slate-500">Teks yang disorot hijau = otomatis/terkonfirmasi, kuning = perlu konfirmasi. Blok teks lalu klik <b>Jadikan isian</b> untuk pemetaan manual.</div>
            {sel && <div className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded border border-navy-300 bg-white p-2 text-xs shadow"><span className="truncate">“{sel.text}”</span><Button size="sm" onClick={addManual}><Plus size={14} /> Jadikan isian</Button></div>}
            {byPart.map(([label, ps]) => (
              <div key={label} className="mb-4">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                <div className="space-y-1 rounded bg-white p-4 shadow-sm">
                  {ps.map((p) => (
                    <div key={p.key} data-para={p.key} data-text={p.text}
                      className={cn('whitespace-pre-wrap rounded px-1 text-sm leading-relaxed', p.static_reason && 'bg-slate-50 text-slate-500', p.table && 'border-l-2 border-slate-200 pl-2',
                        p.align === 'center' && 'text-center', p.align === 'right' && 'text-right', p.bold && 'font-semibold')}>
                      <ParaText para={p} mappings={mappings} selectedId={selected} onSelect={setSelected} />
                      {p.has_drawing && <span className="ml-1 text-[10px] text-slate-400">[gambar]</span>}
                      {initial.variant_map[p.key] && <span className={cn('ml-2 rounded px-1 text-[10px]', initial.variant_map[p.key].inherits ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800')} title={initial.variant_map[p.key].inherits ? 'Mewarisi pemetaan dari paragraf sejajar di master' : 'Wilayah khusus varian; dipertahankan apa adanya'}>{initial.variant_map[p.key].letter} · {initial.variant_map[p.key].inherits ? 'diwarisi' : 'khusus varian'}</span>}
                      {p.part === 'word/document.xml' && <button type="button" title={prot.includes(p.key) ? 'Terkunci (terlindungi) — klik untuk membuka' : 'Kunci paragraf ini agar tidak bisa dijadikan isian'} onClick={() => toggleProt(p.key)} className={cn('ml-2 inline-flex align-middle', prot.includes(p.key) ? 'text-red-600' : 'text-slate-300 hover:text-slate-500')}>{prot.includes(p.key) ? <Lock size={12} /> : <LockOpen size={12} />}</button>}
                      {p.static_reason && <span className="ml-2 rounded bg-slate-200 px-1 text-[10px] text-slate-600">{p.static_reason}</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Panel tengah: hasil deteksi */}
          <div className="min-h-0 space-y-4 overflow-auto border-r border-slate-200 bg-white p-4">
            <section>
              <div className="mb-1 flex items-center justify-between text-sm font-semibold text-navy-900">Terdeteksi otomatis <Badge tone="green">{detected.length}</Badge></div>
              <div className="space-y-1">{detected.map((m) => <Row key={m.id} m={m} />)}{!detected.length && <p className="text-xs text-slate-500">Belum ada.</p>}</div>
            </section>
            <section>
              <div className="mb-1 flex items-center justify-between text-sm font-semibold text-navy-900">Perlu konfirmasi <Badge tone="amber">{needConfirm.length + pendingGroups.length}</Badge></div>
              <div className="space-y-1">{needConfirm.map((m) => <Row key={m.id} m={m} />)}
                {pendingGroups.map((g) => (
                  <div key={g.id} className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                    <div className="flex items-center gap-2 font-semibold text-navy-900"><Table2 size={14} /> Tabel berulang {g.name}</div>
                    <div className="text-slate-600">{g.reason}</div>
                    <div className="mt-1 flex gap-2">
                      <Button size="sm" onClick={() => { setGroups((l) => l.map((x) => (x.id === g.id ? { ...x, status: 'confirmed' } : x))); setDirty(true); }}>Jadikan baris berulang</Button>
                      <Button size="sm" variant="outline" onClick={() => { setGroups((l) => l.map((x) => (x.id === g.id ? { ...x, status: 'rejected' } : x))); setDirty(true); }}>Biarkan statis</Button>
                    </div>
                  </div>
                ))}
                {!needConfirm.length && !pendingGroups.length && <p className="text-xs text-slate-500">Tidak ada.</p>}</div>
            </section>
            <section>
              <div className="mb-1 flex items-center justify-between text-sm font-semibold text-navy-900">Tidak terdeteksi / ditolak <Badge tone="slate">{rejected.length + groups.filter((g) => g.status === 'rejected').length}</Badge></div>
              <div className="space-y-1">{rejected.map((m) => <Row key={m.id} m={m} />)}
                {groups.filter((g) => g.status === 'rejected').map((g) => <div key={g.id} className="flex items-center justify-between rounded border border-slate-200 p-2 text-xs">Tabel {g.name} (statis)<Button size="sm" variant="outline" onClick={() => { setGroups((l) => l.map((x) => (x.id === g.id ? { ...x, status: 'confirm' } : x))); setDirty(true); }}>Tinjau</Button></div>)}
              </div>
              <p className="mt-2 text-xs text-slate-500">Teks lain yang tidak disorot dianggap tetap. Untuk menjadikannya isian, blok teks di panel kiri.</p>
            </section>
            {groups.filter((g) => g.status === 'confirmed' || g.status === 'manual').map((g) => (
              <section key={g.id} className="rounded border border-emerald-300 bg-emerald-50 p-2 text-xs">
                <div className="font-semibold text-navy-900">Baris berulang: {g.name}</div>
                <div className="text-slate-600">Kolom: {g.columns.map((c) => c.label).join(', ')} · {g.default_rows.length} baris contoh</div>
                <Button size="sm" variant="outline" className="mt-1" onClick={() => { setGroups((l) => l.map((x) => (x.id === g.id ? { ...x, status: 'rejected' } : x))); setDirty(true); }}>Jadikan statis</Button>
              </section>
            ))}
          </div>

          {/* Panel kanan: editor / info */}
          <div className="min-h-0 overflow-auto bg-slate-50 p-4">
            {selMap ? <MappingEditor m={selMap} nameInUse={nameInUse} onChange={(p) => patch(selMap.id, p)}
              onDelete={() => { setMappings((l) => l.filter((x) => x.id !== selMap.id)); setSelected(null); setDirty(true); }} /> : (
              <div className="space-y-3 text-sm">
                <VariantPanel review={initial} edits={vEdits} setEdits={(v) => { setVEdits(v); setDirty(true); }} ensureSaved={async () => (dirty ? save() : true)} reload={reload} />
                <div className="font-semibold text-navy-900">Informasi dokumen</div>
                <Card className="space-y-1 p-3 text-xs">
                  <div>Ukuran kertas: {a.doc.page.width_mm}×{a.doc.page.height_mm} mm</div>
                  <div>Margin (a/k/b/kr): {a.doc.page.margin_top}/{a.doc.page.margin_right}/{a.doc.page.margin_bottom}/{a.doc.page.margin_left} mm</div>
                  <div>Font: {a.doc.fonts.map((f) => f.name).join(', ') || '—'}</div>
                  <div>Paragraf {a.doc.paragraphs} · Tabel {a.doc.tables} · Gambar {a.doc.images.length} · Header {a.doc.headers} · Footer {a.doc.footers}</div>
                  <div>Kop surat: {a.doc.has_kop ? 'terdeteksi' : 'tidak terdeteksi'}</div>
                </Card>
                <div className="font-semibold text-navy-900">Riwayat versi template</div>
                <Card className="space-y-1 p-3 text-xs">
                  {initial.versions.length === 0 && <div className="text-slate-500">Belum disimpan sebagai template.</div>}
                  {initial.versions.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1 last:border-0">
                      <div><div className="font-medium">v{v.version_no} {v.current && <Badge tone="green">aktif</Badge>}</div><div className="text-slate-500">{v.note} · {v.mapping_count} isian · {new Date(v.created_at).toLocaleString('id-ID')}</div></div>
                      {!v.current && <Button size="sm" variant="outline" onClick={async () => { if (!(await confirm({ title: `Pulihkan versi ${v.version_no}?`, message: 'Pemetaan versi itu dimuat kembali dan disimpan sebagai versi baru. Riwayat tidak dihapus; dokumen lama tidak terpengaruh.', confirmLabel: 'Pulihkan' }))) return; try { await api.importer.restoreVersion(initial.summary.id, v.id); toast(`Versi ${v.version_no} dipulihkan sebagai versi baru.`, 'success'); reload(); } catch (e) { toast(errMsg(e), 'error'); } }}><History size={12} /> Pulihkan</Button>}
                    </div>
                  ))}
                </Card>
                <div className="font-semibold text-navy-900">Catatan</div>
                <ul className="space-y-1 text-xs">{a.warnings.map((w, i) => <li key={i} className={cn('rounded border p-2', w.level === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white')}>{w.message}</li>)}</ul>
                <p className="text-xs text-slate-500">Pilih isian pada daftar atau klik teks yang disorot untuk mengedit.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
