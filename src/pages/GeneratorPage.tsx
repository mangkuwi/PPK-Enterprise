import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, RotateCcw, Sparkles, Star } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Workbench, type Draft } from '@/features/documents/Workbench';
import { DocxGenerator } from '@/features/importer/DocxGenerator';
import { NumberBanner, NumberedField } from '@/features/numbering/NumberedField';
import { useNumbering } from '@/features/numbering/useNumbering';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { api } from '@/services/api';
import { cn } from '@/lib/utils';
import { todayISO } from '@shared/date';
import { buildDocumentHtml } from '@shared/render';
import { generateContent, replaceInString } from '@shared/placeholder';
import type { Settings, Template, TemplateField, TipTapNode } from '@shared/types';

function initialValues(fields: TemplateField[], s: Settings): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of fields) {
    let d = f.default_value;
    if (f.type === 'date' && (d === 'today' || (!d && f.key === 'TANGGAL'))) d = todayISO();
    if (!d && f.key === 'PENGIRIM') d = s.sender_identity;
    if (!d && f.key === 'NAMA_PEJABAT') d = s.official_name;
    if (!d && f.key === 'JABATAN_PEJABAT') d = s.official_title;
    v[f.key] = d ?? '';
  }
  return v;
}

interface Result { content: TipTapNode; key: number; draft: Draft }

export default function GeneratorPage() {
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const { settings, kop } = useSettings();
  const { toast, confirm } = useFeedback();
  const cats = useAsync(() => api.categories(), []);
  const tpls = useAsync(() => api.templates.list({ activeOnly: true }), []);
  const [catId, setCatId] = useState('');
  const [tpl, setTpl] = useState<Template | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const numbering = useNumbering(tpl && tpl.kind !== 'docx' ? tpl.id : null, values.TANGGAL);
  const nctx = numbering.ctx; const nrec = numbering.record;
  // Isian bernomor/tanggal diisi dari register (bukan diketik).
  useEffect(() => {
    if (!nctx?.register) return;
    if (!nrec) { setValues((v) => { const n = { ...v }; for (const k of nctx.own_keys) n[k] = ''; return n; }); return; }
    setValues((v) => {
      const n = { ...v };
      for (const k of nctx.own_keys) n[k] = nrec.number_text;
      if (nctx.date_key) n[nctx.date_key] = nrec.number_date;
      return n;
    });
  }, [nctx, nrec]);

  const pick = async (id: string) => {
    try { const t = await api.templates.get(id); setTpl(t); setValues(initialValues(t.fields, settings)); setResult(null); } catch (e) { toast(errMsg(e), 'error'); }
  };

  useEffect(() => {
    const code = sp.get('cat');
    if (code && cats.data) setCatId(cats.data.find((c) => c.code === code)?.id ?? '');
  }, [sp, cats.data]);
  useEffect(() => { const t = sp.get('template'); if (t) void pick(t); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [sp]);

  const regCode = sp.get('register');
  const maps = useAsync(() => (regCode ? Promise.all([api.numbering.registers(), api.numbering.mappings()]) : Promise.resolve(null)), [regCode]);
  const regTpl = useMemo(() => {
    if (!regCode || !maps.data) return null;
    const [regs, m] = maps.data; const rid = regs.find((r) => r.code === regCode)?.id;
    const byTpl = new Map(m.templates.map((t) => [t.id, t.register_id])); const byCat = new Map(m.categories.map((c) => [c.category_id, c.register_id]));
    return (t: { id: string; category_id: string | null }) => (byTpl.get(t.id) ?? byCat.get(t.category_id ?? '') ?? null) === rid;
  }, [regCode, maps.data]);
  const visible = useMemo(() => (tpls.data ?? []).filter((t) => (!catId || t.category_id === catId) && (!regTpl || regTpl(t))), [tpls.data, catId, regTpl]);

  const build = (t: Template): { content: TipTapNode; draft: Draft; unresolved: string[]; removed: string[] } => {
    const r = generateContent(t.content, t.fields, values);
    const iso = nrec ? nrec.number_date : /^\d{4}-\d{2}-\d{2}$/.test(values.TANGGAL ?? '') ? values.TANGGAL : todayISO();
    return {
      content: r.content, unresolved: r.unresolved, removed: r.removedOptional,
      draft: {
        template_id: t.id, template_name: t.name, category_id: t.category_id, title: (values.PERIHAL || t.name).slice(0, 300),
        letter_number: nrec?.number_text ?? values.NOMOR_SURAT ?? '', recipient: values.TUJUAN_SURAT ?? '', subject: values.PERIHAL ?? '', doc_date: iso, status: 'draft',
        header_text: replaceInString(t.header_text, t.fields, values), footer_text: replaceInString(t.footer_text, t.fields, values),
        layout: t.layout, form_values: values, use_kop: true,
        ...(nrec ? { number_record_id: nrec.id, number_refs: numbering.refList } : {})
      }
    };
  };

  const generate = () => {
    if (!tpl) return;
    if (numbering.loading || numbering.error || (nctx?.register && !nrec)) { toast('Nomor resmi belum dipilih. Pilih nomor Tersedia dari Bank Nomor Dokumen (isian nomor), atau buat nomor di menu Bank Nomor Dokumen.', 'error'); return; }
    const b = build(tpl);
    setResult({ content: b.content, draft: b.draft, key: Date.now() });
    const parts = [`Dokumen berhasil dibuat dari template "${tpl.name}".`];
    if (b.unresolved.length) parts.push(`${b.unresolved.length} placeholder wajib belum terisi dan ditandai kuning: ${b.unresolved.map((k) => `[${k}]`).join(', ')}.`);
    if (b.removed.length) parts.push(`Placeholder opsional dikosongkan: ${b.removed.map((k) => `[${k}]`).join(', ')}.`);
    toast(parts.join(' '), b.unresolved.length ? 'info' : 'success');
  };

  const regenerate = async () => {
    if (!tpl || !result) return;
    if (!(await confirm({ title: 'Regenerate dokumen?', message: 'Isi dokumen dibuat ulang dari template dan formulir. Perubahan manual pada editor akan hilang.', confirmLabel: 'Regenerate' }))) return;
    const b = build(tpl);
    setResult((r) => ({ content: b.content, draft: r!.draft, key: Date.now() }));
    toast('Dokumen dibuat ulang.', 'success');
  };

  const backToForm = async () => {
    if (!(await confirm({ title: 'Kembali ke formulir?', message: 'Pastikan dokumen sudah disimpan; perubahan yang belum disimpan akan hilang.', confirmLabel: 'Kembali' }))) return;
    setResult(null);
  };

  const showTemplatePreview = () => tpl && setPreview(buildDocumentHtml({ title: tpl.name, content: tpl.content, layout: tpl.layout, kop, mode: 'preview' }));

  if (result && tpl) {
    return (
      <Workbench initial={result.draft} content={result.content} contentKey={result.key}
        onSaved={(r) => { numbering.markUsed(); navigate(`/documents/${r.id}`, { replace: true }); }} onRegenerate={regenerate} onEditForm={backToForm} />
    );
  }

  return (
    <Page>
      <PageHeader title="Buat Dokumen" subtitle="Pilih kategori → pilih template → isi informasi → Generate Document." />
      <ol className="mb-5 flex gap-2 text-xs font-medium">
        {['1. Kategori', '2. Template', '3. Isi informasi', '4. Hasil & edit'].map((s, i) => (
          <li key={s} className={cn('rounded-full px-3 py-1', (tpl ? 2 : 1) >= i ? 'bg-navy-800 text-white' : 'bg-slate-200 text-slate-600')}>{s}</li>
        ))}
      </ol>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant={catId ? 'outline' : 'default'} onClick={() => setCatId('')}>Semua</Button>
        {cats.data?.map((c) => <Button key={c.id} size="sm" variant={catId === c.id ? 'default' : 'outline'} onClick={() => setCatId(c.id)}>{c.name}</Button>)}
      </div>

      {!tpl && (visible.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((t) => (
            <button key={t.id} onClick={() => pick(t.id)} className="text-left">
              <Card className="h-full p-4 transition hover:border-navy-400 hover:shadow">
                <div className="flex items-center justify-between"><Badge tone="navy">{t.category_name}</Badge>{t.is_favorite && <Star size={14} className="fill-amber-400 text-amber-500" />}</div>
                <div className="mt-2 font-semibold text-navy-900">{t.name}</div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{t.description || 'Tanpa deskripsi.'}</p>
                <div className="mt-2 text-xs text-slate-400">{t.field_count} isian</div>
              </Card>
            </button>
          ))}
        </div>
      ) : <Empty>Belum ada template aktif pada kategori ini. Buat template di menu Template.</Empty>)}

      {tpl && tpl.kind === 'docx' && <DocxGenerator key={tpl.id} tpl={tpl} settings={settings} onBack={() => setTpl(null)} />}

      {tpl && tpl.kind !== 'docx' && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div><div className="text-lg font-semibold text-navy-900">{tpl.name}</div><div className="text-sm text-slate-500">{tpl.description}</div></div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={showTemplatePreview}><Eye size={14} /> Pratinjau template</Button>
              <Button variant="outline" size="sm" onClick={() => setTpl(null)}>Ganti template</Button>
            </div>
          </div>
          <NumberBanner n={numbering} />
          {tpl.fields.length === 0 ? <Empty>Template ini tidak memiliki placeholder. Dokumen akan dibuat sama dengan isi template.</Empty> : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {tpl.fields.map((f) => (
                <Field key={f.key} label={f.label} required={f.required} hint={!f.required ? 'Opsional — dikosongkan bila tidak diisi' : undefined}
                  className={f.type === 'textarea' || f.type === 'richtext' ? 'md:col-span-2' : ''}>
                  <NumberedField field={f} value={values[f.key] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} n={numbering} />
                </Field>
              ))}
            </div>
          )}
          <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
            <Button onClick={generate}><Sparkles size={16} /> Generate Document</Button>
            <Button variant="outline" onClick={() => setValues(initialValues(tpl.fields, settings))}><RotateCcw size={16} /> Reset Form</Button>
          </div>
        </Card>
      )}

      <Dialog open={preview !== null} onOpenChange={(o) => { if (!o) setPreview(null); }}>
        {preview !== null && <DialogContent wide title="Pratinjau template" className="h-[90vh]"><iframe title="Pratinjau" sandbox="" srcDoc={preview} className="h-[70vh] w-full rounded border" /></DialogContent>}
      </Dialog>
    </Page>
  );
}
