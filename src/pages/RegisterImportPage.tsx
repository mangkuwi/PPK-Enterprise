import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, FileSpreadsheet } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useActor } from '@/features/numbering/NumberingContext';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { IMPORT_FIELDS, REGISTER_PATH, type ImportCommitInput, type ImportField, type ImportPreview, type ImportReport, type ImportResult } from '@shared/numbering';

type Mapping = Partial<Record<ImportField, number>>;

/** Wizard: pilih berkas → petakan kolom → validasi (duplikat/celah/konflik) → konfirmasi → impor atomik (rollback bila gagal). */
export default function RegisterImportPage() {
  const [sp] = useSearchParams();
  const { toast } = useFeedback();
  const { isAdmin } = useActor();
  const regs = useAsync(() => api.numbering.registers(), []);
  const [regId, setRegId] = useState('');
  useEffect(() => { if (regs.data && !regId) setRegId(regs.data.find((r) => r.code === sp.get('register'))?.id ?? regs.data.find((r) => r.code === 'BERITA_ACARA')?.id ?? regs.data[0]?.id ?? ''); }, [regs.data, sp, regId]);
  const reg = regs.data?.find((r) => r.id === regId);
  const [file, setFile] = useState<{ token: string; name: string } | null>(null);
  const [pv, setPv] = useState<ImportPreview | null>(null);
  const [map, setMap] = useState<Mapping>({});
  const [report, setReport] = useState<ImportReport | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [skipDup, setSkipDup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const input = (): ImportCommitInput => ({
    register_id: regId, sheet: pv!.sheet, header_row: pv!.header_row, mapping: map, skip_duplicates: skipDup, confirm_gaps: confirm, file_name: file!.name,
  });
  const pick = async () => {
    try {
      const r = await api.numbering.importPick();
      if (r.canceled) return;
      setFile({ token: r.token, name: r.file_name }); setPv(r.preview); setMap(r.preview.mapping); setReport(null); setResult(null); setConfirm(false);
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  const reload = async (sheet?: string, header?: number) => {
    if (!file) return;
    try { const p = await api.numbering.importPreview(file.token, sheet, header); setPv(p); setMap(p.mapping); setReport(null); } catch (e) { toast(errMsg(e), 'error'); }
  };
  const validate = async () => {
    setBusy(true);
    try {
      const r = await api.numbering.importValidate(file!.token, input());
      setReport(r);
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try { const r = await api.numbering.importCommit(file!.token, input()); setResult(r); toast(`${r.imported} nomor diimpor.`, 'success'); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };

  if (!isAdmin) return <Page><PageHeader title="Impor Register dari Excel" /><Empty>Impor hanya dapat dilakukan administrator. Ganti pengguna dari menu di kiri bawah.</Empty></Page>;
  const noKey = map.seq == null && map.number == null;
  return (
    <Page>
      <PageHeader title="Impor Register dari Excel" subtitle="Memindahkan nomor historis ke register tanpa mengubah nomor aslinya, lalu menetapkan nomor urut berikutnya."
        actions={reg && <Link to={`/register/${REGISTER_PATH[reg.code]}`}><Button variant="outline" size="sm">Ke register {reg.name}</Button></Link>} />
      <Card className="mb-4 p-4">
        <div className="grid items-end gap-3 md:grid-cols-3">
          <Field label="Register tujuan"><Select value={regId} onChange={(e) => { setRegId(e.target.value); setReport(null); }}>{regs.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
          <div><Button onClick={pick}><FileSpreadsheet size={16} /> Pilih berkas Excel (.xlsx)</Button></div>
          {file && <div className="text-sm text-slate-600">Berkas: <b>{file.name}</b></div>}
        </div>
        {reg && <p className="mt-2 text-xs text-slate-500">Format nomor register: <span className="font-mono">{reg.prefix}{reg.format}{reg.suffix}</span>. Nomor pada berkas dicatat apa adanya; tahun diambil dari tanggal/nomor/nama lembar.</p>}
      </Card>

      {pv && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 font-semibold text-navy-900">1. Pemetaan kolom</h2>
          <div className="mb-3 grid gap-3 md:grid-cols-3">
            <Field label="Lembar"><Select value={pv.sheet} onChange={(e) => reload(e.target.value)}>{pv.sheets.map((s) => <option key={s}>{s}</option>)}</Select></Field>
            <Field label="Baris judul kolom"><Input type="number" min={1} value={pv.header_row} onChange={(e) => reload(pv.sheet, Number(e.target.value) || 1)} /></Field>
            <div className="self-end text-sm text-slate-500">{pv.total_rows} baris data</div>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label}>
                <Select value={map[f.key] ?? ''} onChange={(e) => { setMap({ ...map, [f.key]: e.target.value === '' ? undefined : Number(e.target.value) }); setReport(null); }}>
                  <option value="">— tidak dipakai —</option>{pv.headers.map((h, i) => <option key={i} value={i}>{h || `(kolom ${i + 1})`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          {noKey && <div className="mt-2 text-sm text-red-700">Petakan minimal kolom Nomor urut atau Nomor lengkap.</div>}
          <div className="mt-3 overflow-auto rounded border border-slate-200">
            <table className="w-full text-xs"><thead className="bg-slate-50"><tr>{pv.headers.map((h, i) => <th key={i} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{pv.sample.map((r, i) => <tr key={i} className="border-t border-slate-100">{r.map((c, j) => <td key={j} className="px-2 py-1">{c}</td>)}</tr>)}</tbody></table>
          </div>
          <div className="mt-3"><Button onClick={validate} disabled={busy || noKey}>Validasi (tanpa menyimpan)</Button></div>
        </Card>
      )}

      {report && (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 font-semibold text-navy-900">2. Laporan validasi</h2>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <Badge tone="slate">{report.total_rows} baris</Badge><Badge tone="green">{report.valid_rows} valid</Badge><Badge tone={report.errors.length ? 'red' : 'slate'}>{report.errors.length} kesalahan</Badge>
            <Badge tone={report.warnings.length ? 'amber' : 'slate'}>{report.warnings.length} peringatan</Badge><Badge tone={report.duplicates.length ? 'amber' : 'slate'}>{report.duplicates.length} duplikat</Badge>
          </div>
          {report.errors.length > 0 && <Issues title="Kesalahan (harus diperbaiki di Excel, atau lewati duplikat)" tone="red" items={report.errors.map((e) => `Baris ${e.row}: ${e.message}`)} />}
          {report.warnings.length > 0 && <Issues title="Peringatan" tone="amber" items={report.warnings.map((e) => `Baris ${e.row}: ${e.message}`)} />}
          {report.duplicates.length > 0 && (
            <label className="mb-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
              <input type="checkbox" className="mt-1" checked={skipDup} onChange={(e) => { setSkipDup(e.target.checked); setReport(null); }} /> Lewati baris duplikat (nomor yang sudah ada tidak diubah). Validasi ulang setelah mengubah pilihan ini.
            </label>
          )}
          <div className="mb-3 rounded border border-slate-200 p-3 text-sm">
            <div className="font-medium text-navy-900">Admin review: {report.daily_rows} nomor berformat harian (DDSS) menentukan urutan · {report.legacy_rows} nomor lama dipertahankan apa adanya</div>
            <div className="text-slate-600">Tahun: {report.years.map((y) => `${y.year} (${y.count})`).join(', ') || '—'} · {report.days_total} tanggal memiliki nomor harian. Urutan harian ditentukan dari nomor tertinggi per tanggal, bukan dari baris terakhir berkas.</div>
            {report.days.filter((d) => d.gap_count > 0).slice(0, 40).map((d) => (
              <div key={d.date} className="mt-1 text-amber-800"><AlertTriangle className="mr-1 inline" size={14} />{d.date}: celah nomor ({d.gap_count}): {d.gaps.slice(0, 20).join(', ')}{d.gap_count > 20 ? ', …' : ''} — berikutnya {d.suggested_next}</div>
            ))}
          </div>
          {report.requires_confirmation && (
            <label className="mb-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
              <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> Saya telah memeriksa celah/konflik nomor di atas dan mengonfirmasi bahwa nomor tetap dicatat apa adanya.
            </label>
          )}
          <p className="mb-3 text-xs text-slate-500">Impor berjalan dalam satu transaksi: bila ada kegagalan, tidak ada nomor yang tersimpan. Nomor yang diimpor berstatus Terbit dan tidak dapat dihapus.</p>
          <Button onClick={commit} disabled={busy || !report.ok || (report.requires_confirmation && !confirm)}>Impor {report.valid_rows} nomor</Button>
        </Card>
      )}

      {result && (
        <Card className="border-emerald-300 p-4">
          <div className="flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle2 size={18} /> {result.imported} nomor berhasil diimpor, {result.skipped} dilewati.</div>
          <div className="mt-1 text-sm text-slate-600">Penghitung harian diperbarui untuk {result.days_updated} tanggal; nomor yang diimpor tidak diubah.</div>
        </Card>
      )}
    </Page>
  );
}

function Issues({ title, items, tone }: { title: string; items: string[]; tone: 'red' | 'amber' }) {
  return (
    <details className={`mb-3 rounded border p-2 text-sm ${tone === 'red' ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`} open={tone === 'red'}>
      <summary className="cursor-pointer font-medium">{title} ({items.length})</summary>
      <ul className="mt-1 max-h-48 list-disc overflow-auto pl-5">{items.slice(0, 200).map((t, i) => <li key={i}>{t}</li>)}</ul>
    </details>
  );
}
