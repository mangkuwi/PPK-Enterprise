import { Component, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Empty } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useActor } from '@/features/numbering/NumberingContext';
import { usePpkAccess } from './usePpkAccess';

/** Menampilkan isi halaman PPK hanya bila pengguna punya izin baca; memberi tahu bila PIN belum diatur untuk mengubah data. */
export function PpkGate({ children }: { children: ReactNode }) {
  const { access, loading } = usePpkAccess();
  const { openLogin } = useActor();
  if (loading) return <Empty>Memuat hak akses…</Empty>;
  if (!access) return <Empty><p className="mb-3">Masuk sebagai pengguna untuk membuka modul PPK.</p><Button onClick={openLogin}>Masuk</Button></Empty>;
  if (!access.perms.includes('read')) return <Empty>Anda ({access.user_name}) belum memiliki peran di modul PPK. Minta administrator menambahkannya di Pengaturan PPK → Peran Pengguna.</Empty>;
  return <>
    {access.perms.length > 1 && !access.has_pin && (
      <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
        Pengguna {access.user_name} belum ber-PIN, jadi data PPK hanya bisa dilihat.{' '}
        <Link to="/penomoran/pengaturan?tab=users" className="font-semibold underline">Atur PIN sekarang</Link>
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
