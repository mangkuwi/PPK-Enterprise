import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { cn } from '@/lib/utils';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PpkGate } from '@/features/ppk/PpkGate';
import { api } from '@/services/api';
import { MASTERS, MASTER_KEYS, type MasterDef, type MasterKey, type MasterRow } from '@shared/ppk/master';
import { PPK_ROLES, PPK_ROLE_LABEL, type PpkRole } from '@shared/ppk/access';

type Tab = MasterKey | 'roles' | 'tax';
const defOf = (k: MasterKey) => MASTERS[k] as MasterDef;

export default function PpkSettingsPage() {
  const [tab, setTab] = useState<Tab>('programs');
  const { can } = usePpkAccess();
  const tabs: Array<[Tab, string]> = [...MASTER_KEYS.map((k) => [k, defOf(k).label] as [Tab, string]), ['tax', 'Tarif Pajak'], ...(can('roles') ? [['roles', 'Peran Pengguna'] as [Tab, string]] : [])];
  return (
    <Page>
      <PpkGate>
        <PageHeader title="Pengaturan PPK" subtitle="Data master dipakai semua modul PPK. Data tidak dihapus; nonaktifkan bila tidak dipakai lagi." />
        <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
          {tabs.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-navy-800 text-navy-900' : 'border-transparent text-slate-500 hover:text-slate-800')}>{label}</button>
          ))}
        </div>
        {tab === 'roles' ? <RolesTab /> : tab === 'tax' ? <TaxTab /> : <MasterTab key={tab} k={tab} canEdit={can('master')} />}
      </PpkGate>
    </Page>
  );
}

function MasterTab({ k, canEdit }: { k: MasterKey; canEdit: boolean }) {
  const d = defOf(k);
  const rows = useAsync(() => api.ppk.masterList(k), [k]);
  const refKeys = [...new Set(d.fields.filter((f) => f.ref).map((f) => f.ref as MasterKey))];
  const refs = useAsync(async () => Object.fromEntries(await Promise.all(refKeys.map(async (r) => [r, await api.ppk.masterList(r)] as const))), [k]);
  const [edit, setEdit] = useState<MasterRow | 'new' | null>(null);
  const show = (f: MasterDef['fields'][number], r: MasterRow) => {
    const v = r[f.key];
    if (f.type === 'bool') return v ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>;
    if (f.ref) { const ref = refs.data?.[f.ref]?.find((x) => x.id === v); return ref ? String(ref[defOf(f.ref as MasterKey).display]) : '—'; }
    return v === null || v === '' ? '—' : String(v);
  };
  return (
    <div>
      {canEdit && <div className="mb-3 flex justify-end"><Button onClick={() => setEdit('new')}><Plus size={16} />Tambah {d.label}</Button></div>}
      {rows.error && <Empty>{rows.error}</Empty>}
      {rows.data && !rows.data.length && <Empty>Belum ada data {d.label.toLowerCase()}.</Empty>}
      {!!rows.data?.length && (
        <Card className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr>{d.fields.map((f) => <th key={f.key} className="px-3 py-2 text-left">{f.label}</th>)}{canEdit && <th className="px-3 py-2 text-right">Aksi</th>}</tr></thead>
            <tbody>{rows.data.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                {d.fields.map((f) => <td key={f.key} className="px-3 py-2">{show(f, r)}</td>)}
                {canEdit && <td className="px-3 py-2 text-right"><Button size="icon" variant="ghost" aria-label="Ubah" title="Ubah" onClick={() => setEdit(r)}><Pencil size={15} /></Button></td>}
              </tr>))}
            </tbody>
          </table>
        </Card>
      )}
      {edit && <MasterDialog k={k} row={edit === 'new' ? null : edit} refs={refs.data ?? {}} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); rows.reload(); }} />}
    </div>
  );
}

function MasterDialog({ k, row, refs, onClose, onSaved }: { k: MasterKey; row: MasterRow | null; refs: Record<string, MasterRow[]>; onClose: () => void; onSaved: () => void }) {
  const d = defOf(k);
  const { toast } = useFeedback();
  const [v, setV] = useState<Record<string, string | number | boolean | null>>(() =>
    Object.fromEntries(d.fields.map((f) => [f.key, row ? (f.type === 'bool' ? !!row[f.key] : row[f.key] ?? '') : f.type === 'bool' ? true : f.type === 'number' ? new Date().getFullYear() : ''])));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.ppk.masterSave(k, row ? { ...v, id: row.id } : v); toast(`${d.label} disimpan.`, 'success'); onSaved(); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={`${row ? 'Ubah' : 'Tambah'} ${d.label}`}
        footer={<><Button variant="outline" onClick={onClose}>Batal</Button><Button disabled={busy} onClick={save}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></>}>
        <div className="space-y-3">
          {d.fields.map((f) => {
            const val = v[f.key];
            const set = (x: string | number | boolean | null) => setV({ ...v, [f.key]: x });
            if (f.type === 'bool') return <Switch key={f.key} checked={!!val} onChange={set} label={f.label} />;
            return (
              <Field key={f.key} label={f.label} required={f.required} hint={f.hint}>
                {f.type === 'select' ? (
                  <Select value={String(val ?? '')} onChange={(e) => set(e.target.value)}><option value="">— Pilih —</option>{f.options!.map((o) => <option key={o} value={o}>{o}</option>)}</Select>
                ) : f.type === 'ref' ? (
                  <Select value={String(val ?? '')} onChange={(e) => set(e.target.value)}><option value="">— Pilih —</option>
                    {(refs[f.ref!] ?? []).map((r) => <option key={r.id} value={r.id}>{String(r.code ?? '')} {String(r[defOf(f.ref as MasterKey).display] ?? '')}</option>)}</Select>
                ) : (
                  <Input type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'} value={String(val ?? '')}
                    onChange={(e) => set(f.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)} />
                )}
              </Field>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaxTab() {
  const rates = useAsync(() => api.ppk.taxRates(), []);
  const pct = (bp: number) => `${(bp / 100).toLocaleString('id-ID')}%`;
  return (
    <div>
      <Card className="overflow-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Berlaku sejak</th><th className="px-3 py-2 text-left">PPN</th><th className="px-3 py-2 text-left">PPh 23</th><th className="px-3 py-2 text-left">Keterangan</th></tr></thead>
          <tbody>{rates.data?.map((r) => (
            <tr key={r.id} className="border-t border-slate-100"><td className="px-3 py-2">{r.valid_from}</td><td className="px-3 py-2">{pct(r.ppn_bp)}</td><td className="px-3 py-2">{pct(r.pph23_bp)}</td><td className="px-3 py-2">{r.note}</td></tr>))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">DPP = nilai bruto ÷ (1 + tarif PPN). FP 02 memungut PPN dan PPh 23; FP 04 hanya PPh 23. Angka final mengikuti faktur pajak. Perubahan tarif ditambahkan bersama modul tagihan.</p>
    </div>
  );
}

function RolesTab() {
  const { toast } = useFeedback();
  const users = useAsync(() => api.ppk.users(), []);
  const change = async (id: string, role: string) => {
    try { await api.ppk.setRole(id, (role || null) as PpkRole | null); toast('Peran diperbarui.', 'success'); users.reload(); } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <div>
      {users.error && <Empty>{users.error}</Empty>}
      {!!users.data?.length && (
        <Card className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Pengguna</th><th className="px-3 py-2 text-left">Peran PPK</th><th className="px-3 py-2 text-left">PIN</th><th className="px-3 py-2 text-left">Status</th></tr></thead>
            <tbody>{users.data.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">{u.app_role === 'admin' ? <span>{PPK_ROLE_LABEL.admin} <span className="text-xs text-slate-500">(administrator aplikasi)</span></span> : (
                  <Select className="w-48" value={u.ppk_role ?? ''} onChange={(e) => change(u.id, e.target.value)} aria-label={`Peran PPK ${u.name}`}>
                    <option value="">Tanpa akses</option>{PPK_ROLES.map((r) => <option key={r} value={r}>{PPK_ROLE_LABEL[r]}</option>)}</Select>)}</td>
                <td className="px-3 py-2">{u.has_pin ? <Badge tone="green">PIN aktif</Badge> : <Badge tone="amber">tanpa PIN, hanya baca</Badge>}</td>
                <td className="px-3 py-2">{u.is_active ? 'Aktif' : 'Nonaktif'}</td>
              </tr>))}
            </tbody>
          </table>
        </Card>
      )}
      <p className="mt-3 text-xs text-slate-500">Admin PPK: semua termasuk peran. Pejabat PPK: data dan master. Staf Input: data. Pembaca: lihat saja. Pengguna baru dan PIN diatur di Administrasi → Register Lainnya & Impor → Pengaturan → Pengguna, atau di halaman Server PPK bila memakai server.</p>
    </div>
  );
}
