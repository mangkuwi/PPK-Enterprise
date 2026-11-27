import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, ImagePlus, IndentDecrease, IndentIncrease, Italic, List, ListOrdered,
  Redo2, Search, SeparatorHorizontal, Sparkles, Strikethrough, Table2, Underline as UnderlineIcon, Undo2
} from 'lucide-react';
import { FontSize, Indent, NdImage, NdTable, PageBreak, PlaceholderHighlight, SearchReplace, findMatches } from './extensions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { api } from '@/services/api';
import { cn, imageNaturalWidth, readFileAsDataUrl } from '@/lib/utils';
import { FONT_FAMILIES, FONT_SIZES } from '@shared/settings';
import { FONT_FALLBACK } from '@shared/docFonts';

const MOD = /Mac/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';
import type { Layout, TipTapNode } from '@shared/types';
import type { AiAction } from '@shared/ai-guard';

export interface RichEditorProps {
  content: TipTapNode;
  onChange: (json: TipTapNode) => void;
  layout: Layout;
  aiEnabled?: boolean;
  onEditor?: (e: Editor) => void;
  compact?: boolean;
}

function TB({ active, disabled, onClick, title, children }: { active?: boolean; disabled?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={cn('inline-flex h-8 min-w-8 items-center justify-center rounded px-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40', active && 'bg-navy-100 text-navy-800')}>
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px bg-slate-300" />;

const AI_LABEL: Record<string, string> = { improve: 'Perbaiki bahasa', formalize: 'Formalkan (bahasa kedinasan)', tidy: 'Rapikan paragraf', summarize: 'Ringkas' };

export function RichEditor({ content, onChange, layout, aiEnabled, onEditor, compact }: RichEditorProps) {
  const { toast, confirm } = useFeedback();
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState('');
  const [replace, setReplace] = useState('');
  const [tableOpen, setTableOpen] = useState(false);
  const [dims, setDims] = useState({ rows: 3, cols: 3 });
  const [aiMenu, setAiMenu] = useState(false);
  const [aiResult, setAiResult] = useState<{ text: string; warnings: string[]; from: number; to: number } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const extensions = useMemo(() => [
    StarterKit.configure({ blockquote: false, codeBlock: false, code: false, horizontalRule: false, heading: { levels: [1, 2, 3] } }),
    Underline, TextStyle, FontFamily, FontSize, Indent, PageBreak,
    TextAlign.configure({ types: ['paragraph', 'heading'] }),
    NdTable.configure({ resizable: true }), TableRow, TableCell, TableHeader,
    NdImage.configure({ inline: false, allowBase64: true }),
    PlaceholderHighlight, SearchReplace
  ], []);

  const editor = useEditor({
    extensions,
    content: content as any,
    editorProps: { attributes: { spellcheck: 'true' } },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as TipTapNode)
  });

  useEffect(() => { if (editor && onEditor) onEditor(editor); }, [editor, onEditor]);
  useEffect(() => { if (editor) editor.commands.setSearch(findOpen ? find : ''); }, [editor, find, findOpen]);

  if (!editor) return null;

  const matchCount = findOpen && find ? findMatches(editor.state.doc, find).length : 0;
  const curSize = (editor.getAttributes('textStyle').fontSize as string | undefined) ?? `${layout.fontSize}pt`;
  const curFont = (editor.getAttributes('textStyle').fontFamily as string | undefined) ?? '';
  const inTable = editor.isActive('table');
  const tableNode = inTable ? editor.getAttributes('table') : null;

  const insertImage = async (file: File) => {
    try {
      const src = await readFileAsDataUrl(file);
      const natural = await imageNaturalWidth(src);
      editor.chain().focus().insertContent({ type: 'image', attrs: { src, width: Math.min(natural, 480) } }).run();
    } catch (e) { toast(errMsg(e), 'error'); }
  };

  const runAi = async (action: AiAction) => {
    setAiMenu(false);
    const { from, to } = editor.state.selection;
    if (from === to) { toast('Pilih teks yang akan diproses AI terlebih dahulu.', 'info'); return; }
    const text = editor.state.doc.textBetween(from, to, '\n');
    const ok = await confirm({
      title: 'Kirim teks ke layanan AI?',
      message: 'Teks terpilih akan dikirim ke endpoint AI yang Anda konfigurasi di Pengaturan. Jangan kirim informasi rahasia jika layanan tidak dipercaya. Lanjutkan?',
      confirmLabel: 'Ya, kirim'
    });
    if (!ok) return;
    setAiBusy(true);
    try {
      const r = await api.ai.run(action, text);
      setAiResult({ ...r, from, to });
    } catch (e) { toast(errMsg(e), 'error'); } finally { setAiBusy(false); }
  };

  const applyAi = () => {
    if (!aiResult) return;
    const paras = aiResult.text.split(/\n{1,}/).filter(Boolean).map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] }));
    editor.chain().focus().insertContentAt({ from: aiResult.from, to: aiResult.to }, paras).run();
    setAiResult(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white px-2 py-1">
        <TB title={`Urungkan (${MOD}Z)`} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 size={16} /></TB>
        <TB title={`Ulangi (${MOD === '⌘' ? '⌘⇧Z' : 'Ctrl+Y'})`} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 size={16} /></TB>
        <Sep />
        <Select aria-label="Font" className="h-8 w-40 py-0 text-xs" value={curFont.replace(/["']/g, '')}
          onChange={(e) => (e.target.value ? editor.chain().focus().setFontFamily(e.target.value).run() : editor.chain().focus().unsetFontFamily().run())}>
          <option value="">Font dokumen ({layout.fontFamily})</option>
          {FONT_FAMILIES.map((f) => <option key={f} value={f}>{f}</option>)}
        </Select>
        <Select aria-label="Ukuran font" className="h-8 w-20 py-0 text-xs" value={curSize}
          onChange={(e) => editor.chain().focus().setFontSize(e.target.value).run()}>
          {[...new Set([...FONT_SIZES.map((s) => `${s}pt`), curSize])].map((s) => <option key={s} value={s}>{parseFloat(s)}</option>)}
        </Select>
        <Sep />
        <TB title={`Tebal (${MOD}B)`} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={16} /></TB>
        <TB title={`Miring (${MOD}I)`} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={16} /></TB>
        <TB title={`Garis bawah (${MOD}U)`} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={16} /></TB>
        <TB title="Coret" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={16} /></TB>
        <Sep />
        <TB title="Rata kiri" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={16} /></TB>
        <TB title="Rata tengah" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={16} /></TB>
        <TB title="Rata kanan" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={16} /></TB>
        <TB title="Rata kiri-kanan" active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}><AlignJustify size={16} /></TB>
        <Sep />
        <TB title="Daftar berpoin" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={16} /></TB>
        <TB title="Daftar bernomor" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={16} /></TB>
        <TB title="Tambah indentasi" onClick={() => (editor.isActive('listItem') ? editor.chain().focus().sinkListItem('listItem').run() : editor.chain().focus().indent().run())}><IndentIncrease size={16} /></TB>
        <TB title="Kurangi indentasi" onClick={() => (editor.isActive('listItem') ? editor.chain().focus().liftListItem('listItem').run() : editor.chain().focus().outdent().run())}><IndentDecrease size={16} /></TB>
        <Sep />
        <TB title="Sisipkan tabel" onClick={() => setTableOpen(true)}><Table2 size={16} /></TB>
        <TB title="Sisipkan gambar" onClick={() => fileRef.current?.click()}><ImagePlus size={16} /></TB>
        <TB title="Sisipkan pemisah halaman" onClick={() => editor.chain().focus().setPageBreak().run()}><SeparatorHorizontal size={16} /></TB>
        <TB title="Cari & ganti" active={findOpen} onClick={() => setFindOpen((v) => !v)}><Search size={16} /></TB>
        {aiEnabled && (
          <div className="relative">
            <TB title="Asisten AI (opsional)" onClick={() => setAiMenu((v) => !v)}><Sparkles size={16} className={aiBusy ? 'animate-pulse text-amber-600' : 'text-navy-700'} /></TB>
            {aiMenu && (
              <div className="absolute left-0 top-9 z-30 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
                {(Object.keys(AI_LABEL) as AiAction[]).map((a) => (
                  <button key={a} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => runAi(a)}>{AI_LABEL[a]}</button>
                ))}
              </div>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/bmp" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void insertImage(f); e.target.value = ''; }} />
      </div>

      {inTable && (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1 text-xs">
          <span className="mr-1 font-semibold text-slate-600">Tabel:</span>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().addRowAfter().run()}>+ Baris</Button>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().deleteRow().run()}>− Baris</Button>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Kolom</Button>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().deleteColumn().run()}>− Kolom</Button>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().mergeCells().run()}>Gabung sel</Button>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().splitCell().run()}>Pisah sel</Button>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Baris judul</Button>
          <Button size="sm" variant="outline" onClick={() => editor.chain().focus().updateAttributes('table', { borderless: !tableNode?.borderless }).run()}>
            {tableNode?.borderless ? 'Tampilkan garis' : 'Tanpa garis'}
          </Button>
          <Button size="sm" variant="destructive" onClick={() => editor.chain().focus().deleteTable().run()}>Hapus tabel</Button>
        </div>
      )}
      {editor.isActive('image') && (
        <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1 text-xs">
          <span className="font-semibold text-slate-600">Lebar gambar (px):</span>
          <Input type="number" className="h-7 w-24" min={20} max={900} value={editor.getAttributes('image').width ?? ''}
            onChange={(e) => editor.chain().focus().updateAttributes('image', { width: Number(e.target.value) || null }).run()} />
        </div>
      )}
      {findOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
          <Input className="h-8 w-48" placeholder="Cari…" value={find} onChange={(e) => setFind(e.target.value)} />
          <Input className="h-8 w-48" placeholder="Ganti dengan…" value={replace} onChange={(e) => setReplace(e.target.value)} />
          <span className="text-xs text-slate-500">{find ? `${matchCount} ditemukan` : ''}</span>
          <Button size="sm" variant="outline" onClick={() => editor.commands.findNext(-1)}>Sebelumnya</Button>
          <Button size="sm" variant="outline" onClick={() => editor.commands.findNext(1)}>Berikutnya</Button>
          <Button size="sm" variant="outline" onClick={() => editor.commands.replaceCurrent(replace)}>Ganti</Button>
          <Button size="sm" onClick={() => editor.commands.replaceAll(replace)}>Ganti semua</Button>
        </div>
      )}

      <div className={cn('paper-wrap', compact && 'py-3')}>
        <div className="paper" style={{
          padding: `${layout.marginTop}mm ${layout.marginRight}mm ${layout.marginBottom}mm ${layout.marginLeft}mm`,
          fontFamily: FONT_FALLBACK[layout.fontFamily] ?? `'${layout.fontFamily}', Arial, sans-serif`, fontSize: `${layout.fontSize}pt`, lineHeight: layout.lineHeight
        }}>
          <EditorContent editor={editor} />
        </div>
      </div>

      <Dialog open={tableOpen} onOpenChange={setTableOpen}>
        <DialogContent title="Sisipkan tabel" footer={<>
          <Button variant="outline" onClick={() => setTableOpen(false)}>Batal</Button>
          <Button onClick={() => { editor.chain().focus().insertTable({ rows: dims.rows, cols: dims.cols, withHeaderRow: true }).run(); setTableOpen(false); }}>Sisipkan</Button>
        </>}>
          <div className="flex gap-4">
            <label className="text-sm">Baris<Input type="number" min={1} max={30} value={dims.rows} onChange={(e) => setDims({ ...dims, rows: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} /></label>
            <label className="text-sm">Kolom<Input type="number" min={1} max={10} value={dims.cols} onChange={(e) => setDims({ ...dims, cols: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} /></label>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!aiResult} onOpenChange={(o) => { if (!o) setAiResult(null); }}>
        {aiResult && (
          <DialogContent title="Hasil asisten AI" description="Tinjau hasil sebelum dipakai. AI tidak boleh mengarang nomor, dasar hukum, nama, tanggal, atau nilai anggaran."
            footer={<><Button variant="outline" onClick={() => setAiResult(null)}>Buang</Button><Button onClick={applyAi}>Ganti teks terpilih</Button></>}>
            {aiResult.warnings.length > 0 && (
              <ul className="mb-3 list-disc rounded border border-amber-300 bg-amber-50 py-2 pl-7 pr-3 text-sm text-amber-900">
                {aiResult.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <pre className="whitespace-pre-wrap rounded bg-slate-50 p-3 text-sm">{aiResult.text}</pre>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
