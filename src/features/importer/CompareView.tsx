import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Badge, Card } from '@/components/ui/card';
import type { CompareView as CV } from '@shared/importer';

const Diff = ({ rows, empty }: { rows: CV['adapted_diff']; empty: string }) => (
  <div className="max-h-[52vh] space-y-2 overflow-auto text-xs">
    {rows.length === 0 && <p className="text-slate-500">{empty}</p>}
    {rows.map((d, i) => (
      <div key={i} className="rounded border border-slate-200 p-2">
        {d.before && <div className="whitespace-pre-wrap text-slate-500 line-through decoration-slate-300">{d.before}</div>}
        {d.after && <div className="whitespace-pre-wrap font-medium text-navy-900">{d.after}</div>}
      </div>
    ))}
  </div>
);

export function CompareView({ data }: { data: CV }) {
  const warns = data.report.notes.filter((n) => n.level === 'warn');
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          {data.report.format_preserved ? <Badge tone="green"><CheckCircle2 size={12} className="mr-1" /> Format dokumen terjaga</Badge> : <Badge tone="amber"><AlertTriangle size={12} className="mr-1" /> Ada perubahan format — periksa catatan</Badge>}
          <Badge>{data.report.identical_entries} berkas internal identik byte-per-byte</Badge>
          <Badge>{data.adapted_tokens.length} placeholder pada template</Badge>
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {data.report.notes.length === 0 && <li className="text-slate-500">Tidak ada catatan.</li>}
          {data.report.notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2">{n.level === 'warn' ? <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" /> : <Info size={15} className="mt-0.5 shrink-0 text-navy-500" />}<span>{n.message}</span></li>
          ))}
        </ul>
        {data.unmapped.length > 0 && <p className="mt-2 text-xs text-slate-500">{data.unmapped.length} paragraf panjang belum dipetakan (dianggap teks tetap).</p>}
        {warns.length === 0 && <p className="mt-2 text-xs text-emerald-700">Tidak ada peringatan.</p>}
      </Card>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="p-3"><div className="mb-2 text-sm font-semibold text-navy-900">1. Original (sumber, tidak diubah)</div>
          <div className="max-h-[52vh] space-y-1 overflow-auto text-xs">
            {data.original_paras.filter((p) => p.part === 'word/document.xml').map((p) => (
              <div key={p.key} className="whitespace-pre-wrap rounded px-1 text-slate-700">{p.text || ' '}{p.static_reason && <span className="ml-1 text-[10px] text-slate-400">[{p.static_reason}]</span>}</div>
            ))}
          </div></Card>
        <Card className="p-3"><div className="mb-2 text-sm font-semibold text-navy-900">2. Adapted (template dengan placeholder)</div><Diff rows={data.adapted_diff} empty="Belum ada bagian yang diganti placeholder." /></Card>
        <Card className="p-3"><div className="mb-2 text-sm font-semibold text-navy-900">3. Generated (nilai awal diisi kembali)</div><Diff rows={data.generated_diff} empty="Identik dengan sumber — pembuatan dokumen mereproduksi sumber dengan setia." /></Card>
      </div>
      <Card className="p-3">
        <div className="mb-2 text-sm font-semibold text-navy-900">Struktur per bagian dokumen (sebelum → sesudah)</div>
        <table className="w-full text-left text-xs"><thead><tr className="text-slate-500"><th>Bagian</th><th>Paragraf</th><th>Tabel</th><th>Baris</th><th>Gambar</th><th>Format XML</th></tr></thead>
          <tbody>{data.report.parts.map((p) => (
            <tr key={p.label} className="border-t border-slate-100"><td className="py-1">{p.label}</td><td>{p.paragraphs.join(' → ')}</td><td>{p.tables.join(' → ')}</td><td>{p.rows.join(' → ')}</td><td>{p.drawings.join(' → ')}</td><td>{p.signature_equal ? 'identik' : 'berbeda'}</td></tr>
          ))}</tbody></table>
      </Card>
    </div>
  );
}
