import ppkLogo from '@/assets/branding/logo-ppk-management.svg';
import baktiPlaceholder from '@/assets/branding/logo-bakti-komdigi-placeholder.svg';
import { cn } from '@/lib/utils';

// Logo resmi BAKTI KOMDIGI dipakai otomatis bila berkasnya ditaruh di src/assets/branding (lihat README di sana).
const official = Object.values(import.meta.glob('../../assets/branding/logo-bakti-komdigi.{svg,png}', { eager: true, query: '?url', import: 'default' }))[0] as string | undefined;

/** Identitas institusi di sidebar; saat sidebar diciutkan hanya ikon aplikasi. */
export function BrandLogos({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) return <img src={ppkLogo} alt="PPK Management" className={cn('h-9 w-9', className)} />;
  // Latar putih: teks logo resmi berwarna navy dan tidak terbaca langsung di atas sidebar navy.
  return (
    <div className={cn('w-full rounded-xl bg-white px-3 py-2.5 shadow-sm', className)}>
      <img src={official ?? baktiPlaceholder} alt="BAKTI KOMDIGI" title={official ? 'BAKTI KOMDIGI' : 'Logo resmi BAKTI KOMDIGI belum dipasang'} className="mx-auto h-auto max-h-12 w-full object-contain" />
    </div>
  );
}
