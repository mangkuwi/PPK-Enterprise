import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LogIn, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { api } from '@/services/api';
import type { Actor, AppUser } from '@shared/numbering';

interface Ctx { actor: Actor | null; users: AppUser[]; isAdmin: boolean; refresh: () => Promise<void>; openLogin: () => void }
const NumberingCtx = createContext<Ctx | null>(null);

export function useActor(): Ctx {
  const c = useContext(NumberingCtx);
  if (!c) throw new Error('useActor harus berada di dalam NumberingProvider');
  return c;
}

/** Pengguna aktif untuk penomoran. Bila semua pengguna memakai PIN, aplikasi meminta masuk lebih dulu. */
export function NumberingProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [ready, setReady] = useState(false);
  const [login, setLogin] = useState(false);

  const refresh = useCallback(async () => {
    try { const r = await api.numbering.whoami(); setActor(r.actor); setUsers(r.users); } finally { setReady(true); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const value = useMemo(() => ({ actor, users, isAdmin: actor?.role === 'admin', refresh, openLogin: () => setLogin(true) }), [actor, users, refresh]);
  const mustLogin = ready && !actor && users.length > 0;
  return (
    <NumberingCtx.Provider value={value}>
      {children}
      <LoginDialog open={login || mustLogin} required={mustLogin} onClose={() => setLogin(false)} />
    </NumberingCtx.Provider>
  );
}

function LoginDialog({ open, required, onClose }: { open: boolean; required: boolean; onClose: () => void }) {
  const { users, actor, refresh } = useActor();
  const { toast } = useFeedback();
  const [uid, setUid] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setUid(actor?.id ?? users[0]?.id ?? ''); setPin(''); } }, [open, actor, users]);
  const chosen = users.find((u) => u.id === uid);
  const submit = async () => {
    setBusy(true);
    try { const a = await api.numbering.login(uid, pin || undefined); await refresh(); toast(`Masuk sebagai ${a.name}.`, 'success'); onClose(); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !required) onClose(); }}>
      <DialogContent title="Pilih pengguna" description="Pengguna menentukan hak akses penomoran dan dicatat pada riwayat nomor."
        footer={<>{!required && <Button variant="outline" onClick={onClose}>Batal</Button>}<Button onClick={submit} disabled={busy || !uid}><LogIn size={16} /> Masuk</Button></>}>
        <div className="space-y-3">
          <Field label="Pengguna"><Select value={uid} onChange={(e) => setUid(e.target.value)}>{users.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.role === 'admin' ? 'Administrator' : 'Operator'}</option>)}</Select></Field>
          {chosen?.has_pin && <Field label="PIN"><Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} autoFocus /></Field>}
        </div>
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
