import type { ReactNode } from 'react';
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
    {children}
  </>;
}
