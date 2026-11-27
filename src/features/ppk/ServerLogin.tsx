import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { notifyPpkSession } from './usePpkAccess';

/** Masuk ke server PPK bersama. Semua pengguna server wajib ber-PIN. */
export function ServerLogin({ host }: { host: string }) {
  const { toast } = useFeedback();
  const users = useAsync(() => api.ppk.server.users(), []);
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api.ppk.server.login(userId, pin); setPin(''); notifyPpkSession(); } catch (err) { toast(errMsg(err), 'error'); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-3 rounded-lg border border-slate-200 bg-white p-5 text-left">
      <p className="text-sm text-slate-600">Data PPK disimpan di server <b>{host}</b>. Masuk dengan pengguna server.</p>
      {users.error && <p className="text-sm text-red-700" role="alert">{users.error}</p>}
      <Field label="Pengguna" required>
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} required><option value="">— Pilih —</option>
          {users.data?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
      </Field>
      <Field label="PIN" required><Input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} required /></Field>
      <div className="flex items-center justify-between">
        <Link to="/ppk/server" className="text-xs text-slate-500 underline">Pengaturan server</Link>
        <Button type="submit" disabled={busy || !userId || !pin}>Masuk</Button>
      </div>
    </form>
  );
}
