import { useMemo } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import { Bold, Italic, List, ListOrdered, Underline as U } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Editor kecil untuk field bertipe "Rich text". Nilai disimpan sebagai JSON TipTap (string). */
export function MiniRichEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const initial = useMemo(() => {
    try { const j = JSON.parse(value); if (j?.type === 'doc') return j; } catch { /* teks biasa */ }
    return value ? { type: 'doc', content: value.split('\n').map((l) => ({ type: 'paragraph', content: l ? [{ type: 'text', text: l }] : undefined })) } : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const editor = useEditor({
    extensions: [StarterKit.configure({ blockquote: false, codeBlock: false, code: false, horizontalRule: false, heading: false }), Underline],
    content: initial as any,
    onUpdate: ({ editor: e }) => onChange(e.isEmpty ? '' : JSON.stringify(e.getJSON()))
  });
  if (!editor) return null;
  const B = ({ on, active, children, title }: { on: () => void; active: boolean; children: React.ReactNode; title: string }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={on}
      className={cn('rounded p-1 text-slate-600 hover:bg-slate-100', active && 'bg-navy-100 text-navy-800')}>{children}</button>
  );
  return (
    <div className="rounded-md border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-navy-500">
      <div className="flex gap-1 border-b border-slate-200 px-1 py-0.5">
        <B title="Tebal" on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}><Bold size={14} /></B>
        <B title="Miring" on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><Italic size={14} /></B>
        <B title="Garis bawah" on={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')}><U size={14} /></B>
        <B title="Poin" on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}><List size={14} /></B>
        <B title="Nomor" on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}><ListOrdered size={14} /></B>
      </div>
      <EditorContent editor={editor} className="min-h-[90px] px-3 py-2 text-sm [&_.ProseMirror]:min-h-[70px] [&_.ProseMirror]:outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5" />
    </div>
  );
}
