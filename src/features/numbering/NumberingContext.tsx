import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { KeyRound, LogIn, LogOut, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { api } from '@/services/api';
import { useAsync } from '@/hooks/useAsync';
import { ServerLogin } from '@/features/ppk/ServerLogin';
import { notifyPpkSession, PPK_SESSION_EVENT } from '@/features/ppk/usePpkAccess';
import { PASSWORD_RULE, validPassword, type Actor, type AppUser } from '@shared/numbering';

interface Ctx { actor: Actor | null; users: AppUser[]; isAdmin: boolean; refresh: () => Promise<void>; openLogin: () => void; /** Nama akun server PPK yang sedang masuk (mode server), untuk tombol Profil. */ serverUser: string | null }
const NumberingCtx = createContext<Ctx | null>(null);

export function useActor(): Ctx {
  const c = useContext(NumberingCtx);
  if (!c) throw new Error('useActor harus berada di dalam NumberingProvider');
  return c;
}

/** Pengguna aktif. Mode lokal: layar Masuk wajib sebelum aplikasi terbuka. Mode server: masuk dengan akun server PPK. */
export function NumberingProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [setup, setSetup] = useState(false);
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);
  const server = useAsync(() => api.ppk.server.status(), []);
  const reloadServer = server.reload;
  useEffect(() => { window.addEventListener(PPK_SESSION_EVENT, reloadServer); return () => window.removeEventListener(PPK_SESSION_EVENT, reloadServer); }, [reloadServer]);

  const refresh = useCallback(async () => {
    try { const r = await api.numbering.whoami(); setActor(r.actor); setUsers(r.users); setSetup(r.setup); } finally { setReady(true); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // Server tidak terjangkau: aplikasi tetap terbuka (dokumen lokal), halaman PPK menampilkan galat server.
  const srv = server.data?.mode === 'server' && !server.data.error ? server.data : null;
  const serverUser = srv?.session?.name ?? null;
  const value = useMemo(() => ({ actor, users, isAdmin: actor?.role === 'admin', refresh, openLogin: () => setLogin(true), serverUser }), [actor, users, refresh, serverUser]);
  const gate = !ready || server.loading ? <p className="text-sm text-slate-500">Memuat…</p>
    : srv && !srv.session ? <ServerLogin host={`${srv.conf?.host}:${srv.conf?.port}`} />
    : !srv && setup && actor ? <SetupPassword actor={actor} onDone={refresh} />
    : !actor && users.length > 0 ? <LoginForm />
    : null;
  return (
    <NumberingCtx.Provider value={value}>
      {gate ? <div className="flex h-full items-center justify-center bg-slate-100 p-4"><div className="w-full max-w-sm"><h1 className="mb-4 text-center text-lg font-semibold text-navy-900">Masuk</h1>{gate}</div></div> : <>
        {children}
        <LoginDialog open={login} server={!!srv} onClose={() => setLogin(false)} />
      </>}
    </NumberingCtx.Provider>
  );
}

/** Layar Masuk (mode lokal): pilih nama, ketik kata sandi. */
function LoginForm() {
  const { users, refresh } = useActor();
  const { toast } = useFeedback();
  const [uid, setUid] = useState(users[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const a = await api.numbering.login(uid, pin); setPin(''); await refresh(); notifyPpkSession(); toast(`Masuk sebagai ${a.name}.`, 'success'); }
    catch (err) { toast(errMsg(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <Field label="Pengguna" required><Select value={uid} onChange={(e) => setUid(e.target.value)} required>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
      <Field label="Kata sandi" required><Input type="password" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus required /></Field>
      <p className="text-xs text-slate-500">Lupa kata sandi? Minta administrator atau Pejabat PPK meresetnya.</p>
      <div className="flex justify-end"><Button type="submit" disabled={busy || !uid || !pin}><LogIn size={16} /> Masuk</Button></div>
    </form>
  );
}

/** Pertama kali (belum ada kata sandi sama sekali): administrator membuat kata sandi sebelum aplikasi terbuka. */
function SetupPassword({ actor, onDone }: { actor: Actor; onDone: () => Promise<void> }) {
  const { toast } = useFeedback();
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false);
  const bad = !validPassword(pw) ? PASSWORD_RULE : pw !== pw2 ? 'Ulangi kata sandi belum sama.' : '';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); if (bad) return toast(bad, 'error'); setBusy(true);
    try { await api.numbering.setPin(actor.id, pw); await onDone(); toast('Kata sandi dibuat. Mulai sekarang setiap staf masuk dengan akunnya sendiri.', 'success'); }
    catch (err) { toast(errMsg(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <p className="text-sm text-slate-600">Buat kata sandi untuk <b>{actor.name}</b>. Setelah itu aplikasi selalu meminta masuk, dan akun staf dibuat di Pengaturan PPK → Akun Staf.</p>
      <Field label="Kata sandi baru" hint={PASSWORD_RULE} required><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required /></Field>
      <Field label="Ulangi kata sandi" required><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></Field>
      <div className="flex justify-end"><Button type="submit" disabled={busy || !pw || !pw2}><KeyRound size={16} /> Simpan kata sandi</Button></div>
    </form>
  );
}

/** Jendela akun: ganti pengguna (mode lokal), ubah kata sandi sendiri, keluar. */
function LoginDialog({ open, server, onClose }: { open: boolean; server: boolean; onClose: () => void }) {
  const { users, actor, refresh } = useActor();
  const { toast } = useFeedback();
  const [uid, setUid] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [change, setChange] = useState(false);
  const [oldPw, setOldPw] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  useEffect(() => { if (open) { setUid(actor?.id ?? users[0]?.id ?? ''); setPin(''); setChange(false); setOldPw(''); setPw(''); setPw2(''); } }, [open, actor, users]);
  const chosen = users.find((u) => u.id === uid);
  const run = async (f: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await f(); await refresh(); notifyPpkSession(); toast(ok, 'success'); onClose(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  const switchUser = () => run(() => api.numbering.login(uid, pin || undefined), `Masuk sebagai ${chosen?.name ?? ''}.`);
  const logout = () => run(() => (server ? api.ppk.server.logout() : api.numbering.logout()), 'Anda sudah keluar.');
  const savePw = () => {
    if (!validPassword(pw)) return toast(PASSWORD_RULE, 'error');
    if (pw !== pw2) return toast('Ulangi kata sandi belum sama.', 'error');
    return run(() => api.ppk.accounts.changeOwn(oldPw, pw), 'Kata sandi diganti.');
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent title={change ? 'Ubah kata sandi' : 'Akun'} description={server ? 'Anda masuk dengan akun server PPK.' : 'Pengguna menentukan hak akses dan dicatat pada riwayat.'}
        footer={change
          ? <><Button variant="outline" onClick={() => setChange(false)}>Kembali</Button><Button onClick={savePw} disabled={busy || !oldPw || !pw}><KeyRound size={16} /> Simpan</Button></>
          : <><Button variant="outline" onClick={logout} disabled={busy}><LogOut size={16} /> Keluar</Button><Button variant="outline" onClick={() => setChange(true)}><KeyRound size={16} /> Ubah kata sandi</Button>
            {!server && <Button onClick={switchUser} disabled={busy || !uid || uid === actor?.id}><LogIn size={16} /> Ganti pengguna</Button>}</>}>
        {change ? (
          <div className="space-y-3">
            <Field label="Kata sandi lama"><Input type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoFocus /></Field>
            <Field label="Kata sandi baru" hint={PASSWORD_RULE}><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Ulangi kata sandi baru"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          </div>
        ) : !server ? (
          <div className="space-y-3">
            <Field label="Pengguna"><Select value={uid} onChange={(e) => setUid(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role === 'admin' ? 'Administrator' : 'Operator'}</option>)}</Select></Field>
            {chosen?.has_pin && uid !== actor?.id && <Field label="Kata sandi"><Input type="password" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void switchUser(); }} autoFocus /></Field>}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function UserBadge() {
  const { actor, openLogin } = useActor();
  return (
    <button onClick={openLogin} className="flex w-full items-center gap-2 border-t border-navy-700 px-5 py-2 text-left text-xs text-slate-300 hover:bg-navy-800" title="Ganti pengguna">
      <UserCircle2 size={16} /> <span className="truncate">{actor ? `${actor.name} · ${actor.role === 'admin' ? 'Admin' : 'Operator'}` : 'Belum masuk'}</span>
    </button>
  );
}
