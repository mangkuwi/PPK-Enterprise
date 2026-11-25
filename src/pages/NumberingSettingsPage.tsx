import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Page } from '@/components/layout/Page';
import { Button } from '@/components/ui/button';
import { Badge, Card, Empty, PageHeader } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useActor } from '@/features/numbering/NumberingContext';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { FORMAT_TOKENS, REGISTER_LABEL, renderNumber, validateFormat, type Register, type Role } from '@shared/numbering';
import { cn } from '@/lib/utils';

const TABS = [['register', 'Format & nomor'], ['map', 'Pemetaan'], ['users', 'Pengguna'], ['audit', 'Audit'], ['imports', 'Riwayat impor']] as const;
type Tab = (typeof TABS)[number][0];

export default function NumberingSettingsPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') as Tab : 'register'));
  const { isAdmin, actor } = useActor();
  return (
    <Page>
      <PageHeader title="Pengaturan Penomoran" subtitle={isAdmin ? 'Perubahan konfigurasi dicatat. Nomor yang sudah terbit tidak berubah.' : `Anda masuk sebagai ${actor?.name ?? '—'} (operator): pengaturan hanya dapat dilihat.`} />
      <div className="mb-4 flex flex-wrap gap-2">{TABS.map(([k, l]) => <Button key={k} size="sm" variant={tab === k ? 'default' : 'outline'} onClick={() => setTab(k)}>{l}</Button>)}</div>
      {tab === 'register' && <RegisterTab admin={isAdmin} />}
      {tab === 'map' && <MapTab admin={isAdmin} />}
      {tab === 'users' && <UsersTab admin={isAdmin} />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'imports' && <ImportsTab />}
    </Page>
  );
}

function RegisterTab({ admin }: { admin: boolean }) {
  const regs = useAsync(() => api.numbering.registers(), []);
  const [sel, setSel] = useState('');
  const reg = regs.data?.find((r) => r.id === sel) ?? regs.data?.[0];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{regs.data?.map((r) => <Button key={r.id} size="sm" variant={reg?.id === r.id ? 'default' : 'outline'} onClick={() => setSel(r.id)}>{r.name}</Button>)}</div>
      {reg && <><ConfigCard key={reg.id} reg={reg} admin={admin} onSaved={regs.reload} /><CounterCard key={`c${reg.id}`} reg={reg} admin={admin} /><HistoryCard key={`h${reg.id}`} reg={reg} /></>}
    </div>
  );
}

function ConfigCard({ reg, admin, onSaved }: { reg: Register; admin: boolean; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [v, setV] = useState({ name: reg.name, format: reg.format, prefix: reg.prefix, suffix: reg.suffix, seq_length: String(reg.seq_length), initial_sequence: String(reg.initial_sequence), keys: reg.placeholder_keys.join(', '), is_active: reg.is_active, reason: '' });
  const spec = { format: v.format, prefix: v.prefix, suffix: v.suffix, seq_length: Number(v.seq_length) };
  const err = validateFormat(spec);
  const sample = (() => { if (err) return ''; try { return renderNumber(spec, Math.max(1, Number(v.initial_sequence) || 1), `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15`); } catch { return ''; } })();
  const save = async () => {
    try {
      await api.numbering.updateRegister(reg.id, { name: v.name, format: v.format, prefix: v.prefix, suffix: v.suffix, seq_length: Number(v.seq_length), initial_sequence: Number(v.initial_sequence),
        placeholder_keys: v.keys.split(',').map((k) => k.trim()).filter(Boolean), is_active: v.is_active }, v.reason);
      toast('Konfigurasi disimpan.', 'success'); setV({ ...v, reason: '' }); onSaved();
    } catch (e) { toast(errMsg(e), 'error'); }
  };
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-navy-900">Format nomor — {REGISTER_LABEL[reg.code]}</h2><Switch checked={v.is_active} onChange={(x) => setV({ ...v, is_active: x })} label="Register aktif" /></div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Nama register"><Input disabled={!admin} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Kunci placeholder terisi nomor" hint="Pisahkan dengan koma. Yang pertama = kunci utama untuk rujukan dari register lain."><Input disabled={!admin} value={v.keys} onChange={(e) => setV({ ...v, keys: e.target.value })} /></Field>
        <Field label="Format" className="md:col-span-2" hint={`Variabel: ${FORMAT_TOKENS.map((t) => `{${t}}`).join(' ')}. Contoh bawaan hanyalah ilustrasi; sesuaikan dengan pola nomor instansi.`}><Input disabled={!admin} className="font-mono" value={v.format} onChange={(e) => setV({ ...v, format: e.target.value })} /></Field>
        <Field label="Awalan (prefix)"><Input disabled={!admin} value={v.prefix} onChange={(e) => setV({ ...v, prefix: e.target.value })} /></Field>
        <Field label="Akhiran (suffix)"><Input disabled={!admin} value={v.suffix} onChange={(e) => setV({ ...v, suffix: e.target.value })} /></Field>
        <Field label="Panjang nomor urut" hint="2 → 01–99 per tanggal (DDSS). Perpanjang (mis. 3) bila 99 tidak cukup; nomor lama tidak berubah."><Input disabled={!admin} type="number" min={1} max={10} value={v.seq_length} onChange={(e) => setV({ ...v, seq_length: e.target.value })} /></Field>
        <Field label="Nomor urut awal tiap tahun"><Input disabled={!admin} type="number" min={1} value={v.initial_sequence} onChange={(e) => setV({ ...v, initial_sequence: e.target.value })} /></Field>
        <Field label="Alasan perubahan (dicatat)"><Input disabled={!admin} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
      <div className={cn('mt-3 rounded border p-2 text-sm', err ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50')}>{err ?? <>Pratinjau: <span className="font-mono">{sample}</span></>}</div>
      {admin && <div className="mt-3"><Button onClick={save} disabled={!!err}>Simpan konfigurasi</Button></div>}
    </Card>
  );
}

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const LONG_MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const longDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return m >= 1 && m <= 12 ? `${d} ${LONG_MONTHS[m - 1]} ${y}` : iso; };

function CounterCard({ reg, admin }: { reg: Register; admin: boolean }) {
  const { toast, confirm } = useFeedback();
  const [date, setDate] = useState(todayStr());
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const info = useAsync(() => (valid ? api.numbering.next(reg.id, date) : Promise.resolve(null)), [reg.id, date, reg.updated_at]);
  const [next, setNext] = useState('');
  useEffect(() => { if (info.data) setNext(String(info.data.suggested)); }, [info.data]);
  const apply = async () => {
    const n = Number(next);
    const run = async (c: boolean) => { await api.numbering.setNext(reg.id, date, n, c); toast(`Nomor urut berikutnya tanggal ${longDate(date)} ditetapkan ${n}.`, 'success'); info.reload(); };
    try { await run(false); } catch (e) {
      if (/perlu konfirmasi/i.test(errMsg(e)) && (await confirm({ title: 'Konfirmasi nomor urut', message: errMsg(e), confirmLabel: 'Ya, tetapkan' }))) { try { await run(true); } catch (e2) { toast(errMsg(e2), 'error'); } }
      else toast(errMsg(e), 'error');
    }
  };
  const d = info.data;
  return (
    <Card className="p-4">
      <h2 className="mb-1 font-semibold text-navy-900">Penomoran harian</h2>
      <div className="mb-3 text-sm text-slate-600">Format penomoran: <span className="font-mono font-semibold">{d?.format_label ?? '…'}</span> — hari dokumen + urutan harian per kategori; urutan kembali ke 01 setiap tanggal berganti.</div>
      <div className="grid items-end gap-3 md:grid-cols-4">
        <Field label="Tanggal dokumen"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Nomor urut tertinggi tercatat"><Input readOnly className="bg-slate-100" value={d?.max_seq ?? '—'} /></Field>
        <Field label="Nomor urut berikutnya"><Input disabled={!admin || !!d?.full} type="number" min={1} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
        {admin && <Button onClick={apply} disabled={!valid || !!d?.full}>Tetapkan</Button>}
      </div>
      {d && <div className="mt-3 space-y-1 text-sm">
        <div>Tanggal: <b>{longDate(d.date)}</b> · Nomor tersedia berikutnya: <span className="font-mono font-semibold">{d.preview ?? '—'}</span> {d.has_imported && <Badge tone="navy">ada data impor</Badge>} <span className="text-slate-500">(sisa {d.remaining} dari {d.limit})</span></div>
        {d.full && <div className="rounded border border-red-300 bg-red-50 p-2 text-red-800">Batas nomor harian tercapai (1–{d.limit}). Tidak ada nomor baru untuk tanggal ini. Administrator perlu memperpanjang panjang nomor urut pada konfigurasi format, atau pilih tanggal lain.</div>}
        {d.gap_count > 0 && <div className="text-amber-800">Celah nomor ({d.gap_count}): {d.gaps.slice(0, 30).join(', ')}{d.gap_count > 30 ? ', …' : ''}</div>}
        {d.conflicts.map((c) => <div key={c} className="text-amber-800">{c}</div>)}
        {!d.gap_count && !d.conflicts.length && !d.full && <div className="text-slate-500">Tidak ada celah atau konflik pada tanggal ini.</div>}
      </div>}
    </Card>
  );
}

function HistoryCard({ reg }: { reg: Register }) {
  const h = useAsync(() => api.numbering.configHistory(reg.id), [reg.id, reg.updated_at]);
  return (
    <Card className="p-4">
      <h2 className="mb-2 font-semibold text-navy-900">Riwayat konfigurasi</h2>
      {!h.data?.length ? <Empty>Belum ada perubahan konfigurasi.</Empty> : (
        <ul className="space-y-2 text-sm">{h.data.map((x) => (
          <li key={x.id} className="rounded border border-slate-200 p-2">
            <div className="text-xs text-slate-500">{x.changed_at.slice(0, 16).replace('T', ' ')} · {x.changed_by_name}{x.reason ? ` · ${x.reason}` : ''}</div>
            {Object.keys(x.next).map((k) => <div key={k} className="font-mono text-xs"><span className="text-slate-500">{k}:</span> <span className="text-red-700 line-through">{JSON.stringify((x.old as Record<string, unknown>)[k])}</span> → <span className="text-emerald-700">{JSON.stringify((x.next as Record<string, unknown>)[k])}</span></div>)}
          </li>))}
        </ul>)}
    </Card>
  );
}

function MapTab({ admin }: { admin: boolean }) {
  const { toast } = useFeedback();
  const regs = useAsync(() => api.numbering.registers(), []);
  const m = useAsync(() => api.numbering.mappings(), []);
  const set = async (fn: () => Promise<unknown>) => { try { await fn(); m.reload(); toast('Pemetaan disimpan.', 'success'); } catch (e) { toast(errMsg(e), 'error'); } };
  const opts = (cur: string | null, on: (v: string | null) => void) => (
    <Select disabled={!admin} value={cur ?? ''} onChange={(e) => on(e.target.value || null)}><option value="">— tanpa register —</option>{regs.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-4"><h2 className="mb-1 font-semibold text-navy-900">Kategori → register</h2><p className="mb-3 text-xs text-slate-500">Template dalam kategori ini memakai nomor dari register terpilih.</p>
        <table className="w-full text-sm"><tbody>{m.data?.categories.map((c) => <tr key={c.category_id} className="border-t border-slate-100"><td className="py-1.5 pr-2">{c.category_name}</td><td className="w-56">{opts(c.register_id, (v) => set(() => api.numbering.setCategoryMap(c.category_id, v)))}</td></tr>)}</tbody></table></Card>
      <Card className="p-4"><h2 className="mb-1 font-semibold text-navy-900">Template → register (menimpa kategori)</h2><p className="mb-3 text-xs text-slate-500">Kosongkan untuk mengikuti kategori.</p>
        <div className="max-h-[60vh] overflow-auto"><table className="w-full text-sm"><tbody>{m.data?.templates.map((t) => <tr key={t.id} className="border-t border-slate-100"><td className="py-1.5 pr-2">{t.name}<div className="text-xs text-slate-400">{t.category_name ?? 'Tanpa kategori'}</div></td><td className="w-56">{opts(t.register_id, (v) => set(() => api.numbering.setTemplateMap(t.id, v)))}</td></tr>)}</tbody></table></div></Card>
    </div>
  );
}

function UsersTab({ admin }: { admin: boolean }) {
  const { toast } = useFeedback();
  const { refresh } = useActor();
  const users = useAsync(() => api.numbering.users(), []);
  const [n, setN] = useState({ name: '', role: 'operator' as Role, pin: '' });
  const [pinFor, setPinFor] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState('');
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); users.reload(); void refresh(); } catch (e) { toast(errMsg(e), 'error'); } };
  return (
    <div className="space-y-4">
      <Card className="overflow-auto">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Nama</th><th className="px-3 py-2 text-left">Peran</th><th className="px-3 py-2 text-left">PIN</th><th className="px-3 py-2 text-left">Aktif</th><th /></tr></thead>
          <tbody>{users.data?.map((u) => (
            <tr key={u.id} className="border-t border-slate-100"><td className="px-3 py-2">{u.name}</td>
              <td className="px-3 py-2"><Select disabled={!admin} value={u.role} onChange={(e) => run(() => api.numbering.updateUser({ id: u.id, role: e.target.value as Role }), 'Peran diperbarui.')}><option value="operator">Operator</option><option value="admin">Administrator</option></Select></td>
              <td className="px-3 py-2">{u.has_pin ? <Badge tone="green">PIN aktif</Badge> : <Badge>tanpa PIN</Badge>}</td>
              <td className="px-3 py-2"><Switch checked={u.is_active} onChange={(x) => admin && run(() => api.numbering.updateUser({ id: u.id, is_active: x }), 'Status diperbarui.')} label={u.is_active ? 'Aktif' : 'Nonaktif'} /></td>
              <td className="px-3 py-2 text-right">{admin && <Button size="sm" variant="outline" onClick={() => { setPin(''); setPinFor({ id: u.id, name: u.name }); }}>Atur PIN</Button>}</td></tr>))}
          </tbody></table>
      </Card>
      <Dialog open={!!pinFor} onOpenChange={(o) => { if (!o) setPinFor(null); }}>
        {pinFor && <DialogContent title={`Atur PIN — ${pinFor.name}`} description="4–12 digit angka. Kosongkan lalu simpan untuk menghapus PIN."
          footer={<><Button variant="outline" onClick={() => setPinFor(null)}>Batal</Button><Button onClick={() => run(async () => { await api.numbering.setPin(pinFor.id, pin.trim() || null); setPinFor(null); }, 'PIN diperbarui.')}>Simpan</Button></>}>
          <Field label="PIN baru"><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus /></Field>
        </DialogContent>}
      </Dialog>
      {admin && <Card className="p-4"><h2 className="mb-3 font-semibold text-navy-900">Tambah pengguna</h2>
        <div className="grid items-end gap-3 md:grid-cols-4">
          <Field label="Nama"><Input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></Field>
          <Field label="Peran"><Select value={n.role} onChange={(e) => setN({ ...n, role: e.target.value as Role })}><option value="operator">Operator</option><option value="admin">Administrator</option></Select></Field>
          <Field label="PIN (opsional)"><Input type="password" inputMode="numeric" value={n.pin} onChange={(e) => setN({ ...n, pin: e.target.value })} /></Field>
          <Button onClick={() => run(async () => { await api.numbering.createUser({ name: n.name, role: n.role, pin: n.pin || null }); setN({ name: '', role: 'operator', pin: '' }); }, 'Pengguna ditambahkan.')}>Tambah</Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">Operator dapat memesan, menerbitkan, dan membatalkan nomor miliknya. Administrator mengelola konfigurasi, impor, nomor awal, dan pelepasan reservasi kedaluwarsa. Aplikasi ini lokal/offline; PIN melindungi dari salah pakai, bukan pengganti keamanan komputer.</p>
      </Card>}
    </div>
  );
}

function AuditTab() {
  const [q, setQ] = useState('');
  const a = useAsync(() => api.numbering.audit({ search: q || undefined }), [q]);
  return (
    <div className="space-y-3">
      <Input placeholder="Cari pengguna, aksi, atau detail…" value={q} onChange={(e) => setQ(e.target.value)} />
      <Card className="overflow-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Waktu</th><th className="px-3 py-2 text-left">Pengguna</th><th className="px-3 py-2 text-left">Aksi</th><th className="px-3 py-2 text-left">Detail</th></tr></thead>
        <tbody>{a.data?.map((r) => <tr key={r.id} className="border-t border-slate-100 align-top"><td className="whitespace-nowrap px-3 py-1.5 text-xs">{r.at.slice(0, 19).replace('T', ' ')}</td><td className="px-3 py-1.5">{r.actor_name}</td><td className="px-3 py-1.5 font-mono text-xs">{r.action}</td><td className="max-w-xl break-words px-3 py-1.5 text-xs text-slate-600">{JSON.stringify(r.detail)}</td></tr>)}</tbody></table>
        {!a.data?.length && <div className="p-4"><Empty>Tidak ada log.</Empty></div>}
      </Card>
    </div>
  );
}

function ImportsTab() {
  const i = useAsync(() => api.numbering.imports(), []);
  const regs = useAsync(() => api.numbering.registers(), []);
  return (
    <Card className="overflow-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Waktu</th><th className="px-3 py-2 text-left">Register</th><th className="px-3 py-2 text-left">Berkas</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-right">Baris</th><th className="px-3 py-2 text-left">Oleh</th></tr></thead>
      <tbody>{i.data?.map((r) => <tr key={r.id} className="border-t border-slate-100"><td className="px-3 py-1.5 text-xs">{r.created_at.slice(0, 16).replace('T', ' ')}</td><td className="px-3 py-1.5">{regs.data?.find((x) => x.id === r.register_id)?.name}</td><td className="px-3 py-1.5">{r.filename} <span className="text-xs text-slate-400">({r.sheet})</span></td>
        <td className="px-3 py-1.5"><Badge tone={r.status === 'committed' ? 'green' : 'red'}>{r.status === 'committed' ? 'Berhasil' : 'Dibatalkan'}</Badge></td><td className="px-3 py-1.5 text-right">{r.imported_rows}/{r.total_rows}</td><td className="px-3 py-1.5">{r.created_by_name}</td></tr>)}</tbody></table>
      {!i.data?.length && <div className="p-4"><Empty>Belum ada impor.</Empty></div>}
    </Card>
  );
}
