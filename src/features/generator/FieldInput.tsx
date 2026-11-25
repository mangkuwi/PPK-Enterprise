import { Input, Select, Textarea } from '@/components/ui/form';
import { MiniRichEditor } from '@/features/editor/MiniRichEditor';
import type { TemplateField } from '@shared/types';

export function FieldInput({ field, value, onChange }: { field: TemplateField; value: string; onChange: (v: string) => void }) {
  switch (field.type) {
    case 'textarea': return <Textarea value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'richtext': return <MiniRichEditor value={value} onChange={onChange} />;
    case 'date': return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'number': return <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {!field.required || !field.options.includes(value) ? <option value="">— pilih —</option> : null}
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    default: return <Input value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
