import { useEffect, useState } from 'react';
import { Page } from '@/components/layout/Page';
import { Badge, Card, PageHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { formatBytes } from '@/lib/utils';
import { ServerLogin } from '@/features/ppk/ServerLogin';
import { WebAccessCard } from '@/features/ppk/WebAccessCard';
import { notifyPpkSession, usePpkAccess } from '@/features/ppk/usePpkAccess';
import { api, type PpkServerConf } from '@/services/api';

/** Server PPK bersama (PostgreSQL di LAN). Modul dokumen dan penomoran tetap di komputer masing-masing. */
export default function ServerPage() {
  const { toast, confirm } = useFeedback();
  const st = useAsync(() => api.ppk.server.status(), []);
  const { can } = usePpkAccess();
  const [f, setF] = useState<PpkServerConf>({ host: '', port: 5432, database: 'ppk', user: 'ppk_app', password: '' });
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const s = st.data;
  useEffect(() => { if (s?.conf) setF((x) => ({ ...x, ...s.conf, password: '' })); }, [s?.conf]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast(ok, 'success'); st.reload(); notifyPpkSession(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const set = (k: keyof PpkServerConf) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === 'port' ? Number(e.target.value) : e.target.value });
  const empty = s?.server && !s.server.users && !s.server.data_rows;
  const host = s?.conf ? `${s.conf.host}:${s.conf.port}/${s.conf.database}` : '';

  return (
    <Page>
      <PageHeader title="Server PPK" subtitle="Pakai satu database PPK bersama untuk beberapa komputer di jaringan kantor (LAN). Dokumen dan penomoran tetap di komputer masing-masing." />
      <WebAccessCard />
      {s && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            Data PPK komputer ini: {s.mode === 'server' ? <Badge tone="navy">Server {host}</Badge> : <Badge>Lokal (berkas di komputer ini)</Badge>}
            {s.conf && (s.error ? <Badge tone="red">Tidak terhubung</Badge> : s.server?.schema != null ? <Badge tone="green">Terhubung, versi data {s.server.schema}</Badge> : <Badge tone="amber">Terhubung, database kosong</Badge>)}
            {s.session && <span>Masuk sebagai <b>{s.session.name}</b></span>}
          </div>
          {s.error && <p className="mt-2 text-red-700" role="alert">{s.error}</p>}
        </Card>
      )}

      {s?.mode === 'lokal' && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 font-semibold">1. Alamat server</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Alamat server (IP/nama)" required><Input value={f.host} onChange={set('host')} placeholder="192.168.1.10" /></Field>
            <Field label="Port" required><Input type="number" value={f.port} onChange={set('port')} /></Field>
            <Field label="Database" required><Input value={f.database} onChange={set('database')} /></Field>
            <Field label="Pengguna database" required><Input value={f.user} onChange={set('user')} /></Field>
            <Field label="Kata sandi" hint={s.conf ? 'Kosongkan bila tidak diganti' : undefined}><Input type="password" autoComplete="off" value={f.password} onChange={set('password')} /></Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" disabled={busy} onClick={() => run(async () => { const r = await api.ppk.server.test(f); toast(r.schema == null ? 'Terhubung. Database masih kosong.' : `Terhubung. ${r.users} pengguna, ${r.data_rows} data PPK.`, 'success'); }, 'Uji selesai.')}>Uji koneksi</Button>
            <Button disabled={busy} onClick={() => run(() => api.ppk.server.configure(f), 'Alamat server disimpan.')}>Simpan</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Hanya administrator aplikasi ber-PIN. Kata sandi disimpan terenkripsi oleh sistem operasi. Cara memasang server: docs/LAN-SERVER.md.</p>
        </Card>
      )}

      {s?.mode === 'lokal' && s.conf && s.server && (
        <Card className="mb-4 p-4">
          <h2 className="mb-3 font-semibold">2. Mulai memakai server</h2>
          {empty ? (
            <div className="space-y-3 text-sm">
              <p>Database server masih kosong. Pilih salah satu (data hanya pernah disalin ke server kosong, jadi tidak ada yang tertimpa):</p>
              <div className="flex flex-wrap items-end gap-2">
                <Button disabled={busy} onClick={async () => {
                  if (await confirm({ title: 'Pindahkan data PPK ke server?', message: 'Seluruh data PPK, pengguna, dan log audit PPK komputer ini disalin ke server dalam satu transaksi, lalu jumlah baris dan total rupiah dicocokkan. Berkas lokal tidak dihapus, tetapi sesudah ini perubahan hanya dicatat di server.', confirmLabel: 'Pindahkan' }))
                    await run(() => api.ppk.server.setup('copy'), 'Data PPK sudah dipindahkan ke server dan diperiksa.');
                }}>Pindahkan data PPK komputer ini ke server</Button>
                <span className="text-slate-400">atau</span>
                <Field label="PIN administrator server baru" className="w-48"><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
                <Button variant="outline" disabled={busy || !pin} onClick={() => run(() => api.ppk.server.setup('fresh', pin), 'Server baru siap. Masuk dengan PIN tadi.')}>Server baru tanpa data</Button>
                <Button variant="outline" disabled={busy} onClick={() => run(async () => { const r = await api.ppk.server.restore(); if (r.canceled) throw new Error('Dibatalkan.'); }, 'Backup server dipulihkan ke server kosong.')}>Pulihkan backup server</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <p>Server sudah berisi {s.server.users} pengguna dan {s.server.data_rows} data PPK.</p>
              <Button disabled={busy} onClick={() => run(() => api.ppk.server.setup('join'), 'Komputer ini sekarang memakai server PPK.')}>Gunakan server ini</Button>
            </div>
          )}
        </Card>
      )}

      {s?.mode === 'server' && !s.session && !s.error && <div className="mb-4"><ServerLogin host={host} /></div>}

      {s?.mode === 'server' && (
        <Card className="mb-4 p-4 text-sm">
          <div className="flex flex-wrap gap-2">
            {s.session && <Button variant="outline" onClick={() => run(() => api.ppk.server.logout(), 'Keluar dari server.')}>Keluar dari server</Button>}
            {can('roles') && <Button variant="outline" disabled={busy} onClick={() => run(async () => { const r = await api.ppk.server.backup(); toast(`Backup ${formatBytes(r.size)}: ${r.path}`, 'success'); }, 'Backup server selesai.')}>Backup server sekarang</Button>}
            <Button variant="ghost" disabled={busy} onClick={async () => {
              if (await confirm({ title: 'Kembali ke data lokal?', message: 'Komputer ini berhenti memakai server dan membuka lagi data PPK lokal yang lama. Perubahan yang dicatat di server tidak ikut ke data lokal.', confirmLabel: 'Kembali ke lokal', destructive: true }))
                await run(() => api.ppk.server.useLocal(), 'Komputer ini memakai data PPK lokal.');
            }}>Kembali ke data lokal</Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Backup otomatis harian (Pengaturan) juga menyimpan salinan server di folder backup/otomatis selama aplikasi terbuka.</p>
        </Card>
      )}

      {s?.mode === 'server' && s.session && can('roles') && <ServerUsers />}
    </Page>
  );
}

function ServerUsers() {
  const { toast } = useFeedback();
  const users = useAsync(() => api.ppk.users(), []);
  const [name, setName] = useState(''); const [pin, setPin] = useState('');
  const [pinFor, setPinFor] = useState<string | null>(null); const [newPin, setNewPin] = useState('');
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); users.reload(); } catch (e) { toast(errMsg(e), 'error'); } };
  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold">Pengguna server</h2>
      <table className="mb-3 w-full text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr><th className="px-3 py-2 text-left">Nama</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left" /></tr></thead>
        <tbody>{users.data?.map((u) => (
          <tr key={u.id} className="border-t border-slate-100">
            <td className="px-3 py-2">{u.name}{u.app_role === 'admin' && <span className="text-xs text-slate-500"> (administrator)</span>}</td>
            <td className="px-3 py-2">{u.is_active ? (u.has_pin ? <Badge tone="green">Aktif</Badge> : <Badge tone="amber">Belum ber-PIN</Badge>) : <Badge>Nonaktif</Badge>}</td>
            <td className="space-x-2 px-3 py-2 text-right">
              {pinFor === u.id ? <>
                <Input className="inline-block w-32" type="password" inputMode="numeric" aria-label={`PIN baru ${u.name}`} value={newPin} onChange={(e) => setNewPin(e.target.value)} />
                <Button size="sm" disabled={!newPin} onClick={() => act(async () => { await api.ppk.server.setPin(u.id, newPin); setPinFor(null); setNewPin(''); }, 'PIN diganti.')}>Simpan PIN</Button>
              </> : <Button size="sm" variant="outline" onClick={() => { setPinFor(u.id); setNewPin(''); }}>Ganti PIN</Button>}
              <Button size="sm" variant="ghost" onClick={() => act(() => api.ppk.server.setActive(u.id, !u.is_active), u.is_active ? 'Pengguna dinonaktifkan.' : 'Pengguna diaktifkan.')}>{u.is_active ? 'Nonaktifkan' : 'Aktifkan'}</Button>
            </td>
          </tr>))}
        </tbody>
      </table>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void act(async () => { await api.ppk.server.createUser(name, pin); setName(''); setPin(''); }, 'Pengguna ditambahkan. Atur perannya di Pengaturan PPK → Peran Pengguna.'); }}>
        <Field label="Nama pengguna baru"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="PIN"><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} /></Field>
        <Button type="submit" disabled={!name || !pin}>Tambah</Button>
      </form>
    </Card>
  );
}
