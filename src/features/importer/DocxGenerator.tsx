import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { NumberBanner, NumberedField } from '@/features/numbering/NumberedField';
import { useNumbering } from '@/features/numbering/useNumbering';
import { api } from '@/services/api';
import { todayISO } from '@shared/date';
import type { DocxTemplateInfo } from '@shared/importer';
import type { Settings, Template, TemplateField } from '@shared/types';

type Rows = Record<string, Array<Record<string, string>>>;

function initial(fields: TemplateField[], s: Settings): Record<string, string> {
  const v: Record<string, string> = {};
  for (const f of fields) {
    let d = f.default_value;
    if (f.type === 'date' && !d) d = todayISO();
    if (!d && f.key === 'PENGIRIM') d = s.sender_identity;
    if (!d && f.key === 'NAMA_PEJABAT') d = s.official_name;
    if (!d && f.key === 'JABATAN_PEJABAT') d = s.official_title;
    v[f.key] = d ?? '';
  }
  return v;
}

/** Formulir untuk template hasil impor Word (kind='docx'): isian + tabel baris berulang. Hasil = DOCX asli yang diisi. */
export function DocxGenerator({ tpl, settings, onBack }: { tpl: Template; settings: Settings; onBack: () => void }) {
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [info, setInfo] = useState<DocxTemplateInfo | null>(null);
  const [values, setValues] = useState(() => initial(tpl.fields, settings));
  const [rows, setRows] = useState<Rows>({});
  const [busy, setBusy] = useState(false);
  const [ai, setAi] = useState({ instructions: '', references: '' });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const numbering = useNumbering(tpl.id, values.TANGGAL_SURAT);
  const nctx = numbering.ctx; const nrec = numbering.record;
  useEffect(() => {
    if (!nctx?.register) return;
    if (!nrec) { setValues((v) => { const n = { ...v }; for (const k of nctx.own_keys) n[k] = ''; return n; }); return; }
    setValues((v) => { const n = { ...v }; for (const k of nctx.own_keys) n[k] = nrec.number_text; if (nctx.date_key) n[nctx.date_key] = nrec.number_date; return n; });
  }, [nctx, nrec]);
  const aiOn = settings.ai_enabled === 'true' && tpl.fields.some((f) => f.type === 'textarea' || f.type === 'richtext');

  useEffect(() => {
    api.importer.docxInfo(tpl.id).then((i) => { setInfo(i); if (i) setRows(Object.fromEntries(i.groups.map((g) => [g.name, g.default_rows.map((r) => ({ ...r }))]))); }).catch((e) => toast(errMsg(e), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl.id]);

  const draft = async () => {
    if (!ai.instructions.trim()) { toast('Tulis instruksi untuk AI terlebih dahulu.', 'error'); return; }
    setAiBusy(true);
    try {
      const r = await api.importer.aiDraft({ templateId: tpl.id, title: values.PERIHAL || tpl.name, recipient: values.TUJUAN_SURAT ?? '', subject: values.PERIHAL ?? '', instructions: ai.instructions, references: ai.references });
      setValues((v) => ({ ...v, ...r.values }));
      setAiNotes([...r.missing.map((k) => `${k}: ada informasi yang belum tersedia ([ISI_...]) — lengkapi sebelum Generate.`), ...r.warnings, ...r.dropped.map((k) => `Kunci "${k}" diabaikan: bukan area isi yang boleh diisi AI.`)]);
      toast('Draf AI dimasukkan ke formulir. Tinjau dan edit sebelum Generate.', 'success');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setAiBusy(false); }
  };

  // Varian: pilihan pengguna menentukan halaman yang dibuat; isian khusus varian lain disembunyikan.
  const variantKeys = new Set((info?.variants ?? []).map((v) => v.field_key));
  const chosen = new Set((info?.variants ?? []).map((v) => values[v.field_key] || v.default_label));
  const visible = (f: TemplateField) => { const r = info?.restricted[f.key]; return !r || r.some((l) => chosen.has(l)); };
  const shownFields = tpl.fields.filter((f) => !variantKeys.has(f.key) && visible(f));

  const generate = async () => {
    if (numbering.loading || numbering.error || (nctx?.register && !nrec)) { toast('Nomor resmi belum dipilih. Pilih nomor Tersedia dari Bank Nomor (isian nomor), atau buat nomor di menu Bank Nomor.', 'error'); return; }
    const auto = new Set([...(nctx?.own_keys ?? []), ...(nctx?.date_key ? [nctx.date_key] : [])]);
    const missing = shownFields.filter((f) => f.required && !auto.has(f.key) && !(values[f.key] ?? '').trim());
    if (missing.length) { toast(`Isian wajib belum terisi: ${missing.map((m) => m.label).join(', ')}`, 'error'); return; }
    const all: Record<string, string> = { ...values };
    for (const [g, list] of Object.entries(rows)) all[`@${g}`] = JSON.stringify(list);
    const iso = nrec ? nrec.number_date : /^\d{4}-\d{2}-\d{2}$/.test(values.TANGGAL_SURAT ?? '') ? values.TANGGAL_SURAT : todayISO();
    setBusy(true);
    try {
      const d = await api.importer.generate({
        templateId: tpl.id, title: (values.PERIHAL || tpl.name).slice(0, 300), values: all, categoryId: tpl.category_id, templateName: tpl.name, docDate: iso,
        letterNumber: nrec?.number_text ?? values.NOMOR_SURAT ?? '', recipient: values.TUJUAN_SURAT ?? '', subject: values.PERIHAL ?? '',
        ...(nrec ? { number_record_id: nrec.id, number_refs: numbering.refList } : {})
      });
      numbering.markUsed();
      toast('Dokumen Word dibuat dari template. Format asli dipertahankan.', 'success');
      navigate(`/documents/${d.id}`, { replace: true });
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div><div className="text-lg font-semibold text-navy-900">{tpl.name}</div><div className="text-sm text-slate-500">Template dari dokumen Word — tata letak, font, kop, dan tabel mengikuti dokumen asli.</div></div>
        <Button variant="outline" size="sm" onClick={onBack}>Ganti template</Button>
      </div>
      {aiOn && (
        <div className="mb-4 rounded border border-navy-200 bg-navy-50/40 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-navy-900"><Bot size={16} /> Susun isi dengan AI (opsional)</div>
          <p className="mb-2 text-xs text-slate-600">AI hanya mengisi kolom teks panjang. Yang dikirim hanya teks di bawah dan isian formulir (tujuan, perihal) — bukan berkas Word. Kop, tabel, nomor, tanggal, dan pejabat tidak disentuh.</p>
          <div className="grid gap-2 md:grid-cols-2">
            <Textarea className="min-h-[70px]" placeholder="Instruksi: apa yang ingin disampaikan…" value={ai.instructions} onChange={(e) => setAi({ ...ai, instructions: e.target.value })} />
            <Textarea className="min-h-[70px]" placeholder="Referensi pendukung (tempel teks, opsional)…" value={ai.references} onChange={(e) => setAi({ ...ai, references: e.target.value })} />
          </div>
          <Button size="sm" className="mt-2" onClick={draft} disabled={aiBusy}><Sparkles size={14} /> {aiBusy ? 'Menyusun…' : 'Susun isi'}</Button>
          {aiNotes.length > 0 && <ul className="mt-2 space-y-1 text-xs text-amber-900">{aiNotes.map((n, i) => <li key={i} className="rounded border border-amber-300 bg-amber-50 p-1">{n}</li>)}</ul>}
        </div>
      )}
      <NumberBanner n={numbering} />
      {info?.variants.map((v) => (
        <div key={v.field_key} className="mb-4 rounded border border-navy-200 bg-navy-50/40 p-3">
          <div className="mb-1 text-sm font-semibold text-navy-900">{v.label}</div>
          <p className="mb-2 text-xs text-slate-600">Template ini punya beberapa varian halaman dengan isian bersama yang sama. Pilih salah satu; hanya varian terpilih yang dimuat ke dokumen, tanpa membuat kategori atau template baru.</p>
          <div className="grid gap-2 md:grid-cols-2">
            {v.options.map((o) => {
              const on = (values[v.field_key] || v.default_label) === o.label;
              return (
                <label key={o.id} className={`flex cursor-pointer items-start gap-2 rounded border p-2 text-sm ${on ? 'border-navy-500 bg-white shadow-sm' : 'border-slate-200 bg-white/60'}`}>
                  <input type="radio" name={v.field_key} className="mt-1" checked={on} onChange={() => setValues((s) => ({ ...s, [v.field_key]: o.label }))} />
                  <span><span className="font-medium text-navy-900">{o.label}</span>{o.summary && <span className="block text-xs text-slate-500">{o.summary}</span>}</span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {shownFields.map((f) => (
          <Field key={f.key} label={f.label} required={f.required} hint={!f.required ? 'Opsional — paragraf dihapus bila dikosongkan' : undefined}
            className={f.type === 'textarea' || f.type === 'richtext' ? 'md:col-span-2' : ''}>
            <NumberedField field={f} value={values[f.key] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} n={numbering} />
          </Field>
        ))}
      </div>
      {info?.groups.map((g) => {
        const cols = g.columns.filter((c) => !c.auto_number);
        const list = rows[g.name] ?? [];
        const upd = (i: number, k: string, v: string) => setRows((r) => ({ ...r, [g.name]: (r[g.name] ?? []).map((x, j) => (j === i ? { ...x, [k]: v } : x)) }));
        return (
          <div key={g.name} className="mt-5">
            <div className="mb-1 text-sm font-semibold text-navy-900">{g.label}</div>
            <div className="overflow-auto rounded border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="w-10 px-2 py-1 text-left">#</th>{cols.map((c) => <th key={c.key} className="px-2 py-1 text-left">{c.label}</th>)}<th className="w-10" /></tr></thead>
                <tbody>{list.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 text-xs text-slate-500">{i + 1}</td>
                    {cols.map((c) => <td key={c.key} className="p-1"><Input value={r[c.key] ?? ''} onChange={(e) => upd(i, c.key, e.target.value)} /></td>)}
                    <td><Button size="icon" variant="ghost" aria-label="Hapus baris" onClick={() => setRows((x) => ({ ...x, [g.name]: (x[g.name] ?? []).filter((_, j) => j !== i) }))}><Trash2 size={14} /></Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setRows((x) => ({ ...x, [g.name]: [...(x[g.name] ?? []), Object.fromEntries(cols.map((c) => [c.key, '']))] }))}><Plus size={14} /> Tambah baris</Button>
          </div>
        );
      })}
      <div className="mt-5 flex gap-2 border-t border-slate-200 pt-4">
        <Button onClick={generate} disabled={busy}><Sparkles size={16} /> {busy ? 'Membuat…' : 'Generate Document'}</Button>
        <Button variant="outline" onClick={() => setValues(initial(tpl.fields, settings))}><RotateCcw size={16} /> Reset Form</Button>
      </div>
    </Card>
  );
}
