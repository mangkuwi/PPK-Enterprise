import { useEffect, useState } from 'react';
import { Badge, Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { errMsg, useFeedback } from '@/components/ui/feedback';
import { useAsync } from '@/hooks/useAsync';
import { api, isWeb } from '@/services/api';

/** Nyalakan alamat web agar HP/laptop lain di jaringan kantor bisa membuka aplikasi lewat browser. Hanya di komputer server. */
export function WebAccessCard() {
  const { toast } = useFeedback();
  const st = useAsync(() => api.web.status(), []);
  const [port, setPort] = useState(8080);
  const [busy, setBusy] = useState(false);
  const s = st.data;
  useEffect(() => { if (s) setPort(s.port); }, [s?.port]); // eslint-disable-line react-hooks/exhaustive-deps
  if (isWeb() || !s) return null;
  const apply = async (enabled: boolean) => {
    setBusy(true);
    try {
      const r = await api.web.set(enabled, port); st.reload();
      if (r.error) toast(r.error, 'error'); else toast(enabled ? 'Akses web menyala.' : 'Akses web dimatikan.', 'success');
    } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <Card className="mb-4 p-4 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <b className="text-navy-900">Akses lewat browser (HP & laptop lain)</b>
        {s.running ? <Badge tone="green">Menyala</Badge> : <Badge>Mati</Badge>}
        {s.running && <span className="text-slate-500">{s.sessions} browser tersambung</span>}
      </div>
      <p className="mb-3 text-slate-500">Rekan kerja di jaringan Wi-Fi/LAN kantor yang sama membuka alamat di bawah dengan browser, lalu masuk dengan akun staf dan kata sandinya sendiri. Komputer ini harus tetap menyala dan aplikasi tetap terbuka. Pilih, simpan, dan cetak berkas hanya bisa dari komputer ini.</p>
      {s.running && s.urls.length > 0 && (
        <div className="mb-3 space-y-1">{s.urls.map((u) => <div key={u} className="select-all rounded bg-blue-50 px-3 py-2 font-mono text-base font-semibold text-blue-800">{u}</div>)}</div>
      )}
      {s.running && s.urls.length === 0 && <p className="mb-3 text-amber-700">Komputer ini belum tersambung ke jaringan mana pun.</p>}
      {s.error && <p className="mb-3 text-red-700">{s.error}</p>}
      {s.needs_password && <p className="mb-3 text-amber-700">Buat kata sandi administrator dulu sebelum menyalakan akses web.</p>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Port" className="w-28"><Input type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} /></Field>
        {s.running
          ? <><Button variant="outline" disabled={busy} onClick={() => apply(true)}>Mulai ulang</Button><Button variant="outline" disabled={busy} onClick={() => apply(false)}>Matikan</Button></>
          : <Button disabled={busy || s.needs_password} onClick={() => apply(true)}>Nyalakan akses web</Button>}
      </div>
    </Card>
  );
}
