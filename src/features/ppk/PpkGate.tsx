import { Component, useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Empty } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useActor } from '@/features/numbering/NumberingContext';
import { useAsync } from '@/hooks/useAsync';
import { api } from '@/services/api';
import { usePpkAccess, PPK_SESSION_EVENT } from './usePpkAccess';
import { ServerLogin } from './ServerLogin';

/** Menampilkan isi halaman PPK hanya bila pengguna punya izin baca; memberi tahu bila PIN belum diatur untuk mengubah data. */
export function PpkGate({ children }: { children: ReactNode }) {
  const { access, loading, error } = usePpkAccess();
  const { openLogin } = useActor();
  const status = useAsync(() => api.ppk.server.status(), []);
  const { reload } = status;
  useEffect(() => { window.addEventListener(PPK_SESSION_EVENT, reload); return () => window.removeEventListener(PPK_SESSION_EVENT, reload); }, [reload]);
  if (loading) return <Empty>Memuat hak akses…</Empty>;
  const server = status.data?.mode === 'server' ? status.data : null;
  if (server && (error || status.data?.error)) return <Empty><p className="mb-1 font-medium text-red-700">{status.data?.error ?? error}</p>
    <p className="mb-3 text-sm">Data PPK tidak dapat dibuka tanpa server. Data di server tetap aman.</p><Link to="/ppk/server" className="text-sm underline">Pengaturan server</Link></Empty>;
  if (!access && server) return <ServerLogin host={`${server.conf?.host}:${server.conf?.port}`} />;
  if (!access) return <Empty><p className="mb-3">Masuk sebagai pengguna untuk membuka modul PPK.</p><Button onClick={openLogin}>Masuk</Button></Empty>;
  if (!access.perms.includes('read')) return <Empty>Anda ({access.user_name}) belum memiliki peran di modul PPK. Minta administrator menambahkannya di Pengaturan PPK → Akun Staf.</Empty>;
  return <>
    {access.perms.length > 1 && !access.has_pin && (
      <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        Akun {access.user_name} belum punya kata sandi, jadi data PPK hanya bisa dilihat.{' '}
        <Link to="/penomoran/pengaturan?tab=users" className="font-semibold underline">Atur kata sandi sekarang</Link>
      </div>
    )}
    <PpkErrorBoundary>{children}</PpkErrorBoundary>
  </>;
}

/** Galat tak terduga di halaman PPK tidak boleh mengosongkan seluruh aplikasi; data tetap aman di database. */
class PpkErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error('[PPK]', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Empty>
        <p className="mb-1 font-medium text-red-700">Halaman ini mengalami galat: {this.state.error.message}</p>
        <p className="mb-3 text-sm">Data yang sudah tersimpan tidak terpengaruh. Kirim pesan ini ke pengembang bila terulang.</p>
        <Button onClick={() => this.setState({ error: null })}>Coba lagi</Button>
      </Empty>
    );
  }
}
