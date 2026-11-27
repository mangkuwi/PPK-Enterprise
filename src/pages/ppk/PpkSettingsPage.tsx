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
import { PASSWORD_RULE, validPassword } from '@shared/numbering';

const defOf = (k: MasterKey) => MASTERS[k] as MasterDef;

export default function PpkSettingsPage() {
  const { can } = usePpkAccess();
  // Tiga tab saja; sembilan jenis data master dipilih lewat daftar agar tab tidak bertumpuk dua baris.
  const [picked, setTab] = useState<'accounts' | 'master' | 'tax' | null>(null);
  const [master, setMaster] = useState<MasterKey>('programs');
  type T = 'accounts' | 'master' | 'tax';
  const tabs: Array<[T, string]> = [...(can('accounts') ? [['accounts', 'Akun Staf'] as [T, string]] : []), ['master', 'Data Master'], ['tax', 'Tarif Pajak']];
  const tab = picked ?? tabs[0][0]; // hak akses dimuat belakangan: tab pertama mengikuti hak akses
  return (
    <Page>
      <PpkGate>
        <PageHeader title="Pengaturan PPK" subtitle="Akun staf, data master, dan tarif pajak modul PPK. Data tidak dihapus; nonaktifkan bila tidak dipakai lagi." />
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
          <div className="flex gap-1" role="tablist">
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={cn('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-navy-800 text-navy-900' : 'border-transparent text-slate-500 hover:text-slate-800')}>{label}</button>
            ))}
          </div>
          {tab === 'master' && <label className="mb-2 flex items-center gap-2 text-sm text-slate-600">Jenis data
            <Select className="w-56" value={master} onChange={(e) => setMaster(e.target.value as MasterKey)}>{MASTER_KEYS.map((k) => <option key={k} value={k}>{defOf(k).label}</option>)}</Select></label>}
        </div>
        {tab === 'accounts' ? <AccountsTab canAdmin={can('roles')} /> : tab === 'tax' ? <TaxTab /> : <MasterTab key={master} k={master} canEdit={can('master')} />}
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

/** Akun staf: Admin PPK dan Pejabat PPK membuat akun, mengatur peran, mereset kata sandi, dan menonaktifkan. */
function AccountsTab({ canAdmin }: { canAdmin: boolean }) {
  const { toast } = useFeedback();
  const { access } = usePpkAccess();
  const users = useAsync(() => api.ppk.users(), []);
  const [name, setName] = useState(''); const [pw, setPw] = useState(''); const [role, setRole] = useState<PpkRole>('staf');
  const [resetFor, setResetFor] = useState<string | null>(null); const [newPw, setNewPw] = useState('');
  const roles = PPK_ROLES.filter((r) => canAdmin || r !== 'admin');
  const act = async (f: () => Promise<unknown>, ok: string) => { try { await f(); toast(ok, 'success'); users.reload(); return true; } catch (e) { toast(errMsg(e), 'error'); return false; } };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validPassword(pw)) return toast(PASSWORD_RULE, 'error');
    if (await act(() => api.ppk.accounts.create(name, pw, role), `Akun ${name.trim()} dibuat. Sampaikan kata sandinya langsung ke staf.`)) { setName(''); setPw(''); }
  };
  const reset = async (id: string) => {
    if (!validPassword(newPw)) return toast(PASSWORD_RULE, 'error');
    if (await act(() => api.ppk.accounts.resetPassword(id, newPw), 'Kata sandi direset. Sampaikan langsung ke staf.')) { setResetFor(null); setNewPw(''); }
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <form className="flex flex-wrap items-start gap-3" onSubmit={create}>
          <Field label="Nama staf" required><Input className="w-56" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Kata sandi awal" hint={PASSWORD_RULE} required><Input className="w-48" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Peran PPK" required><Select className="w-44" value={role} onChange={(e) => setRole(e.target.value as PpkRole)}>{roles.map((r) => <option key={r} value={r}>{PPK_ROLE_LABEL[r]}</option>)}</Select></Field>
          <Button className="mt-5" type="submit" disabled={!name.trim() || !pw}><Plus size={16} /> Buat akun</Button>
        </form>
      </Card>
      {users.error && <Empty>{users.error}</Empty>}
      {!!users.data?.length && (
        <Card className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Pengguna</th><th className="px-3 py-2 text-left">Peran PPK</th><th className="px-3 py-2 text-left">Kata sandi</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Tindakan</th></tr></thead>
            <tbody>{users.data.map((u) => {
              const self = u.id === access?.user_id;
              const locked = !canAdmin && (u.app_role === 'admin' || u.ppk_role === 'admin');
              return (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{u.name}{self && <span className="text-xs text-slate-500"> (Anda)</span>}</td>
                  <td className="px-3 py-2">{u.app_role === 'admin' ? <span>{PPK_ROLE_LABEL.admin} <span className="text-xs text-slate-500">(administrator aplikasi)</span></span> : locked || self ? (u.ppk_role ? PPK_ROLE_LABEL[u.ppk_role] : 'Tanpa akses') : (
                    <Select className="w-40" value={u.ppk_role ?? ''} onChange={(e) => void act(() => api.ppk.setRole(u.id, (e.target.value || null) as PpkRole | null), 'Peran diperbarui.')} aria-label={`Peran PPK ${u.name}`}>
                      <option value="">Tanpa akses</option>{roles.map((r) => <option key={r} value={r}>{PPK_ROLE_LABEL[r]}</option>)}</Select>)}</td>
                  <td className="px-3 py-2">{u.has_pin ? <Badge tone="green">Ada</Badge> : <Badge tone="amber">Belum, tidak bisa masuk</Badge>}</td>
                  <td className="px-3 py-2">{u.is_active ? 'Aktif' : <Badge>Nonaktif</Badge>}</td>
                  <td className="px-3 py-2 text-right">{!locked && !self && <div className="flex flex-wrap items-center justify-end gap-2">
                    {resetFor === u.id ? <>
                      <Input className="w-40" type="password" autoComplete="new-password" aria-label={`Kata sandi baru ${u.name}`} value={newPw} onChange={(e) => setNewPw(e.target.value)} autoFocus />
                      <Button size="sm" disabled={!newPw} onClick={() => void reset(u.id)}>Simpan</Button>
                      <Button size="sm" variant="outline" onClick={() => setResetFor(null)}>Batal</Button>
                    </> : <Button size="sm" variant="outline" onClick={() => { setResetFor(u.id); setNewPw(''); }}>Reset kata sandi</Button>}
                    <Button size="sm" variant="outline" onClick={() => void act(() => api.ppk.accounts.setActive(u.id, !u.is_active), u.is_active ? `Akun ${u.name} dinonaktifkan.` : `Akun ${u.name} diaktifkan.`)}>{u.is_active ? 'Nonaktifkan' : 'Aktifkan'}</Button>
                  </div>}</td>
                </tr>);
            })}
            </tbody>
          </table>
        </Card>
      )}
      <p className="text-xs text-slate-500">Admin PPK: semua termasuk akun administrator. Pejabat PPK: data, master, dan akun staf. Staf Input: data. Pembaca: lihat saja. Akun nonaktif tidak bisa masuk; riwayatnya tetap tersimpan. Semua perubahan akun tercatat di log audit.</p>
    </div>
  );
}
