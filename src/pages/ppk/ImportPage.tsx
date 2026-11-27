import { useEffect, useState } from 'react';
import { FileSpreadsheet, Save } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PpkGate } from '@/features/ppk/PpkGate';
import { rp, useFiscalYears } from '@/features/ppk/inputs';
import { api } from '@/services/api';
import type { ImportIssue, PpkImportReport } from '@shared/ppk/import';

const LEVEL_TONE = { galat: 'red', peringatan: 'amber', info: 'slate' } as const;
const COUNTS: Array<[keyof PpkImportReport['counts'], string]> = [
  ['budget_lines', 'Baris anggaran baru'], ['budget_lines_existing', 'Baris anggaran sudah ada'], ['vendors', 'Penyedia baru'], ['vendors_existing', 'Penyedia sudah ada'],
  ['contracts', 'Kontrak baru'], ['contracts_existing', 'Kontrak dilewati (sudah ada)'], ['addendums', 'Addendum / PKS lanjutan'],
  ['bills_verified', 'Tagihan terverifikasi'], ['bills_draft', 'Tagihan draf (data belum lengkap)'], ['bills_failed', 'Tagihan gagal'],
  ['units', 'Unit baru'], ['activities', 'Kegiatan baru'], ['accounts', 'Akun MAK baru']
];

export default function ImportPage() {
  const { can } = usePpkAccess();
  const { toast, confirm } = useFeedback();
  const { years, id: fyId, setId: setFy } = useFiscalYears();
  const programs = useAsync(() => api.ppk.masterList('programs'), []);
  const [programId, setProgramId] = useState('');
  const [file, setFile] = useState<{ token: string; file_name: string } | null>(null);
  const [report, setReport] = useState<PpkImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!programId && programs.data?.length) setProgramId(String(programs.data[0].id)); }, [programs.data, programId]);

  const run = async (token: string, commit: boolean) => {
    setBusy(true);
    try { setReport(await api.ppk.import.run(token, fyId, programId, commit)); if (commit) { setFile(null); toast('Impor tersimpan.', 'success'); } }
    catch (e) { toast(errMsg(e), 'error'); }
    finally { setBusy(false); }
  };
  const pick = async () => {
    try {
      const r = await api.ppk.import.pick();
      if (r.canceled) return;
      setFile(r); setReport(null); await run(r.token, false);
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  const save = async () => {
    if (!file || !report) return;
    const ok = await confirm({ title: 'Simpan impor?', confirmLabel: 'Simpan impor',
      message: `${report.counts.contracts} kontrak, ${report.counts.addendums} addendum, dan ${report.counts.bills_verified + report.counts.bills_draft} tagihan (${rp(report.counts.billed)}) akan dicatat. Data yang sudah ada tidak ditimpa. Tagihan yang tersimpan hanya bisa dibatalkan dengan alasan, tidak dihapus.` });
    if (ok) await run(file.token, true);
  };
  const ready = !!fyId && !!programId && can('master');
  const groups = (['galat', 'peringatan', 'info'] as const).map((l) => [l, (report?.issues ?? []).filter((i) => i.level === l)] as [ImportIssue['level'], ImportIssue[]]);

  return (
    <Page>
      <PpkGate>
        <PageHeader title="Impor Excel" subtitle="Pindahkan spreadsheet PPK lama (ringkasan pagu + rincian kontrak/tagihan per lembar). Selalu dipratinjau dulu; tidak ada yang disimpan sebelum Anda menekan Simpan."
          actions={<>
            <Button variant="outline" onClick={pick} disabled={!ready || busy}><FileSpreadsheet size={16} />{file ? 'Ganti berkas' : 'Pilih berkas Excel'}</Button>
            {report && !report.committed && <Button onClick={save} disabled={busy}><Save size={16} />Simpan impor</Button>}
          </>} />
        {!can('master') && <Empty>Impor memerlukan peran Admin PPK.</Empty>}
        <div className="mb-4 grid max-w-2xl grid-cols-2 gap-3">
          <Field label="Tahun anggaran" required>
            <Select value={fyId} onChange={(e) => { setFy(e.target.value); setReport(null); }}>{years.map((y) => <option key={y.id} value={y.id}>TA {y.year}</option>)}</Select>
          </Field>
          <Field label="Program" required hint="Kegiatan dari MAK dibuat di bawah program ini bila belum ada.">
            <Select value={programId} onChange={(e) => { setProgramId(e.target.value); setReport(null); }}>
              {(programs.data ?? []).map((p) => <option key={String(p.id)} value={String(p.id)}>{String(p.code)} {String(p.name)}</option>)}
            </Select>
          </Field>
        </div>
        {file && report && !busy && !report.committed && (
          <div className="mb-3 flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => run(file.token, false)}>Pratinjau ulang</Button></div>
        )}
        {busy && <Empty>Memproses {file?.file_name}…</Empty>}
        {report && !busy && <>
          <Card className="mb-4 p-4">
            <div className="mb-3 flex items-center gap-2 font-semibold text-navy-900">
              {report.committed ? <Badge tone="green">Tersimpan</Badge> : <Badge tone="amber">Pratinjau, belum disimpan</Badge>}
              <span>{file?.file_name}</span><span className="ml-auto tabular-nums">Total tagihan {rp(report.counts.billed)}</span>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
              {COUNTS.map(([k, label]) => <div key={k} className="flex justify-between"><span className="text-slate-600">{label}</span><span className="tabular-nums">{report.counts[k]}</span></div>)}
            </div>
            <p className="mt-3 text-xs text-slate-500">Pembayaran (SP2D/FO) dan alokasi dana kontrak tidak ada di spreadsheet, jadi tidak diimpor. Catat di halaman Tagihan dan Kontrak.</p>
          </Card>
          <Card className="mb-4 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600"><tr>
                <th className="px-3 py-2 text-left">Lembar</th><th className="px-3 py-2 text-left">Penyedia</th><th className="px-3 py-2 text-left">Nomor kontrak</th>
                <th className="px-3 py-2 text-right">Tagihan</th><th className="px-3 py-2 text-right">Nilai</th><th className="px-3 py-2 text-left">Status</th>
              </tr></thead>
              <tbody>{report.chains.map((c) => (
                <tr key={`${c.sheet}:${c.row}`} className="border-t border-slate-100">
                  <td className="whitespace-nowrap px-3 py-2">{c.sheet} <span className="text-xs text-slate-500">baris {c.row}</span></td>
                  <td className="px-3 py-2">{c.vendor}</td><td className="px-3 py-2">{c.contract_number}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.bills}</td><td className="px-3 py-2 text-right tabular-nums">{rp(c.billed)}</td>
                  <td className="px-3 py-2"><Badge tone={c.status === 'baru' ? 'green' : c.status === 'galat' ? 'red' : 'slate'}>{c.status}</Badge></td>
                </tr>))}
              </tbody>
            </table>
          </Card>
          {groups.map(([level, items]) => !!items.length && (
            <Card key={level} className="mb-4 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold"><Badge tone={LEVEL_TONE[level]}>{level}</Badge>{items.length} catatan</div>
              <ul className="space-y-1 text-sm">{items.map((i, n) => <li key={n}><span className="text-slate-500">{i.sheet}{i.row ? ` baris ${i.row}` : ''}:</span> {i.message}</li>)}</ul>
            </Card>
          ))}
        </>}
      </PpkGate>
    </Page>
  );
}
