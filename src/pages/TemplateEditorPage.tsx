import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Editor } from '@tiptap/react';
import { ArrowLeft, Save } from 'lucide-react';
import { RichEditor } from '@/features/editor/RichEditor';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty } from '@/components/ui/card';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { useSettings } from '@/hooks/useSettings';
import { api } from '@/services/api';
import { EMPTY_DOC } from '@/lib/utils';
import { fieldsFromDoc } from '@shared/placeholder';
import { FONT_FAMILIES } from '@shared/settings';
import type { FieldType, ImportedTemplate, Layout, TemplateField, TipTapNode } from '@shared/types';

const PRESETS = ['NOMOR_SURAT', 'TUJUAN_SURAT', 'PENGIRIM', 'TANGGAL', 'PERIHAL', 'LOKASI', 'WAKTU', 'AGENDA', 'LATAR_BELAKANG', 'MAKSUD_SURAT', 'PENUTUP', 'NAMA_PEJABAT', 'JABATAN_PEJABAT'];
const TYPE_LABEL: Record<FieldType, string> = { text: 'Teks', textarea: 'Teks panjang', date: 'Tanggal', select: 'Dropdown', richtext: 'Rich text', number: 'Angka' };

export default function TemplateEditorPage() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const imported = (useLocation().state as { imported?: ImportedTemplate } | null)?.imported;
  const [showBanner, setShowBanner] = useState(!!imported);
  const { toast } = useFeedback();
  const { layout: defaultLayout } = useSettings();
  const cats = useAsync(() => api.categories(), []);
  const loaded = useAsync(() => (id ? api.templates.get(id) : Promise.resolve(null)), [id]);

  const [name, setName] = useState(imported?.name ?? '');
  const [description, setDescription] = useState(imported?.description ?? '');
  const [categoryId, setCategoryId] = useState<string>('');
  const [active, setActive] = useState(true);
  const [header, setHeader] = useState(imported?.header_text ?? '');
  const [footer, setFooter] = useState(imported?.footer_text ?? '');
  const [layout, setLayout] = useState<Layout>(imported?.layout ?? defaultLayout);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [custom, setCustom] = useState('');
  const [saving, setSaving] = useState(false);
  const contentRef = useRef<TipTapNode>(imported?.content ?? (EMPTY_DOC as unknown as TipTapNode));
  const editorRef = useRef<Editor | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [ready, setReady] = useState(isNew);

  useEffect(() => {
    const t = loaded.data;
    if (!t) return;
    setName(t.name); setDescription(t.description); setCategoryId(t.category_id ?? ''); setActive(t.is_active);
    setHeader(t.header_text); setFooter(t.footer_text); setLayout(t.layout); setFields(t.fields);
    contentRef.current = t.content; setReady(true);
  }, [loaded.data]);

  useEffect(() => {
    if (!imported || categoryId || !cats.data) return;
    const n = imported.name.toLowerCase();
    const hit = cats.data.find((c) => c.code !== 'DOK' && n.includes(c.name.toLowerCase()));
    if (hit) setCategoryId(hit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cats.data]);

  const onChange = useCallback((json: TipTapNode) => {
    contentRef.current = json;
    clearTimeout(timer.current);
    // Deteksi placeholder otomatis; konfigurasi field yang sudah diubah dipertahankan per key.
    timer.current = setTimeout(() => setFields((prev) => fieldsFromDoc(json, prev)), 300);
  }, []);

  useEffect(() => { if (ready) setFields((prev) => fieldsFromDoc(contentRef.current, prev)); }, [ready]);

  const patchField = (key: string, patch: Partial<TemplateField>) => setFields((fs) => fs.map((f) => (f.key === key ? { ...f, ...patch } : f)));

  const insert = (key: string) => {
    const k = key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) { toast('Nama placeholder harus diawali huruf (A–Z, angka, garis bawah).', 'error'); return; }
    editorRef.current?.chain().focus().insertContent(`[${k}]`).run();
  };

  const save = async () => {
    if (!name.trim()) { toast('Nama template wajib diisi.', 'error'); return; }
    const bad = fields.find((f) => f.type === 'select' && f.options.length === 0);
    if (bad) { toast(`Field "${bad.label}" bertipe dropdown tetapi belum memiliki pilihan.`, 'error'); return; }
    setSaving(true);
    try {
      await api.templates.save({
        id, category_id: categoryId || null, name: name.trim(), description, content: contentRef.current,
        header_text: header, footer_text: footer, layout, is_active: active, fields
      });
      toast('Template tersimpan.', 'success');
      navigate('/templates');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setSaving(false); }
  };

  if (!isNew && loaded.error) return <div className="p-6"><Empty>{loaded.error}</Empty></div>;
  if (!ready) return <div className="p-6 text-sm text-slate-500">Memuat template…</div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate('/templates')}><ArrowLeft size={16} /> Kembali</Button>
        <h1 className="flex-1 text-lg font-bold text-navy-900">{isNew ? 'Template Baru' : 'Edit Template'}</h1>
        <Button onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Menyimpan…' : 'Simpan Template'}</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {imported && showBanner && (
            <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <b>Template diimpor dari Word.</b> Tinjau hasilnya, lalu ubah teks yang akan berganti-ganti menjadi placeholder
                  (pilih teks → ketik nama di kolom di bawah → <i>Sisipkan</i>). Template belum tersimpan sampai Anda menekan <b>Simpan Template</b>.
                  <ul className="mt-1 list-disc pl-5 text-xs">{imported.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </div>
                <button className="shrink-0 text-xs font-semibold underline" onClick={() => setShowBanner(false)}>Tutup</button>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-xs">
            <span className="font-semibold text-slate-600">Sisipkan placeholder:</span>
            <Select className="h-8 w-52 py-0 text-xs" value="" onChange={(e) => e.target.value && insert(e.target.value)}>
              <option value="">Pilih umum…</option>{PRESETS.map((p) => <option key={p} value={p}>[{p}]</option>)}
            </Select>
            <Input className="h-8 w-44 text-xs" placeholder="NAMA_BARU" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { insert(custom); setCustom(''); } }} />
            <Button size="sm" variant="outline" onClick={() => { insert(custom); setCustom(''); }}>Sisipkan</Button>
            <span className="text-slate-500">Teks yang dipilih di editor akan diganti. Sintaks lanjutan: <code>[?OPSIONAL]</code> · <code>[KEY|textarea]</code> · <code>[KEY|select:A,B|default=A]</code></span>
          </div>
          <RichEditor content={contentRef.current} onChange={onChange} layout={layout} onEditor={(e) => { editorRef.current = e; }} />
        </div>
        <aside className="w-[380px] shrink-0 space-y-4 overflow-auto border-l border-slate-200 bg-white p-4">
          <Field label="Nama template" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Kategori"><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">— Tanpa kategori —</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Deskripsi"><Textarea className="min-h-[56px]" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Switch checked={active} onChange={setActive} label="Template aktif (tampil di Buat Dokumen)" />
          <Field label="Header"><Textarea className="min-h-[48px]" value={header} onChange={(e) => setHeader(e.target.value)} /></Field>
          <Field label="Footer"><Textarea className="min-h-[48px]" value={footer} onChange={(e) => setFooter(e.target.value)} /></Field>
          <Card className="space-y-2 p-3">
            <div className="text-sm font-semibold text-navy-900">Font & Margin</div>
            <Select value={layout.fontFamily} onChange={(e) => setLayout({ ...layout, fontFamily: e.target.value })}>
              {[...new Set([layout.fontFamily, ...FONT_FAMILIES])].map((f) => <option key={f}>{f}</option>)}</Select>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label>Ukuran (pt)<Input type="number" value={layout.fontSize} onChange={(e) => setLayout({ ...layout, fontSize: Number(e.target.value) || 12 })} /></label>
              <label>Spasi baris<Input type="number" step={0.05} value={layout.lineHeight} onChange={(e) => setLayout({ ...layout, lineHeight: Number(e.target.value) || 1.15 })} /></label>
              <label>Atas (mm)<Input type="number" value={layout.marginTop} onChange={(e) => setLayout({ ...layout, marginTop: Number(e.target.value) || 0 })} /></label>
              <label>Bawah (mm)<Input type="number" value={layout.marginBottom} onChange={(e) => setLayout({ ...layout, marginBottom: Number(e.target.value) || 0 })} /></label>
              <label>Kiri (mm)<Input type="number" value={layout.marginLeft} onChange={(e) => setLayout({ ...layout, marginLeft: Number(e.target.value) || 0 })} /></label>
              <label>Kanan (mm)<Input type="number" value={layout.marginRight} onChange={(e) => setLayout({ ...layout, marginRight: Number(e.target.value) || 0 })} /></label>
            </div>
            <Switch checked={layout.showPageNumber} onChange={(v) => setLayout({ ...layout, showPageNumber: v })} label="Nomor halaman" />
          </Card>
          <div>
            <div className="mb-2 flex items-center justify-between text-sm font-semibold text-navy-900">Isian terdeteksi <Badge tone="navy">{fields.length}</Badge></div>
            {fields.length === 0 && <p className="text-sm text-slate-500">Belum ada placeholder. Ketik <code>[NAMA_FIELD]</code> pada isi template.</p>}
            <div className="space-y-2">
              {fields.map((f) => (
                <Card key={f.key} className="space-y-1.5 p-2.5">
                  <div className="flex items-center justify-between"><code className="text-xs font-bold text-navy-800">[{f.key}]</code>
                    <Switch checked={f.required} onChange={(v) => patchField(f.key, { required: v })} label="Wajib" /></div>
                  <Input placeholder="Label" value={f.label} onChange={(e) => patchField(f.key, { label: e.target.value })} />
                  <div className="grid grid-cols-2 gap-2">
                    <Select value={f.type} onChange={(e) => patchField(f.key, { type: e.target.value as FieldType })}>
                      {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
                    <Input placeholder="Nilai bawaan" value={f.default_value} onChange={(e) => patchField(f.key, { default_value: e.target.value })} />
                  </div>
                  {f.type === 'select' && <Input key={f.key} placeholder="Pilihan dipisah koma: Biasa, Segera" defaultValue={f.options.join(', ')}
                    onBlur={(e) => patchField(f.key, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />}
                </Card>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
