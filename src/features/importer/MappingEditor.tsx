import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Field, Input, Select, Switch, Textarea } from '@/components/ui/form';
import { fieldKeyOk, type MappingRec } from '@shared/importer';
import type { FieldType } from '@shared/types';

export const TYPE_LABEL: Record<FieldType, string> = { text: 'Teks', textarea: 'Teks panjang', date: 'Tanggal', select: 'Dropdown', richtext: 'Rich text', number: 'Angka' };
export const STATUS_LABEL_MAP = { auto: 'Otomatis', confirm: 'Perlu konfirmasi', confirmed: 'Dikonfirmasi', manual: 'Manual', rejected: 'Ditolak' } as const;

export function MappingEditor({ m, onChange, onDelete, nameInUse }: { m: MappingRec; onChange: (patch: Partial<MappingRec>) => void; onDelete: () => void; nameInUse: (name: string) => boolean }) {
  const bad = !fieldKeyOk(m.placeholder_name);
  const reused = !bad && nameInUse(m.placeholder_name);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-navy-900">Edit isian</div>
        <Badge tone={m.status === 'confirm' ? 'amber' : m.status === 'rejected' ? 'red' : 'green'}>{STATUS_LABEL_MAP[m.status]} · {Math.round(m.confidence * 100)}%</Badge>
      </div>
      <div className="rounded border border-slate-200 bg-slate-50 p-2 text-xs"><span className="font-semibold">Teks asli:</span> {m.source_text}</div>
      <Field label="Nama placeholder" hint={bad ? 'Huruf besar, angka, garis bawah; diawali huruf (mis. TANGGAL_SURAT).' : reused ? 'Nama sama dengan isian lain → nilainya dipakai bersama di semua tempat.' : undefined}>
        <Input value={m.placeholder_name} className={bad ? 'border-red-400' : ''} onChange={(e) => onChange({ placeholder_name: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
      </Field>
      <Field label="Label formulir"><Input value={m.label} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      <Field label="Tipe">
        <Select value={m.field_type} onChange={(e) => onChange({ field_type: e.target.value as FieldType })}>
          {(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </Select>
      </Field>
      {m.field_type === 'select' && (
        <Field label="Pilihan (satu per baris)"><Textarea className="min-h-[70px]" value={m.options.join('\n')} onChange={(e) => onChange({ options: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></Field>
      )}
      <Field label="Nilai awal" hint={m.field_type === 'date' ? 'Format yyyy-mm-dd bila tanggal.' : undefined}>
        {m.field_type === 'textarea' || m.field_type === 'richtext' ? <Textarea value={m.default_value} onChange={(e) => onChange({ default_value: e.target.value })} /> : <Input value={m.default_value} onChange={(e) => onChange({ default_value: e.target.value })} />}
      </Field>
      <Switch checked={m.required} onChange={(v) => onChange({ required: v })} label="Wajib diisi (jika tidak: opsional, paragraf dihapus bila kosong)" />
      <p className="text-xs text-slate-500">{m.reason}</p>
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3">
        {m.status !== 'rejected' && (m.status === 'confirm' || m.status === 'auto') && <Button size="sm" onClick={() => onChange({ status: 'confirmed' })}>Konfirmasi</Button>}
        {m.status !== 'rejected' ? <Button size="sm" variant="outline" onClick={() => onChange({ status: 'rejected' })}>Tolak (tetap teks statis)</Button>
          : <Button size="sm" variant="outline" onClick={() => onChange({ status: 'confirmed' })}>Pulihkan</Button>}
        {m.status === 'manual' && <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 size={14} /> Hapus</Button>}
      </div>
    </div>
  );
}
