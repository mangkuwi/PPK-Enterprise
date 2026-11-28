import ppkLogo from '@/assets/branding/logo-ppk-management.svg';
import baktiPlaceholder from '@/assets/branding/logo-bakti-komdigi-placeholder.svg';
import { cn } from '@/lib/utils';

// Logo resmi BAKTI KOMDIGI dipakai otomatis bila berkasnya ditaruh di src/assets/branding (lihat README di sana).
const official = Object.values(import.meta.glob('../../assets/branding/logo-bakti-komdigi.{svg,png}', { eager: true, query: '?url', import: 'default' }))[0] as string | undefined;

/** Identitas institusi (BAKTI KOMDIGI) + identitas aplikasi (PPK Management), berdampingan. */
export function BrandLogos({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) return <img src={ppkLogo} alt="PPK Management" className={cn('h-9 w-9', className)} />;
  // Latar putih: teks logo resmi berwarna navy dan tidak terbaca langsung di atas sidebar navy.
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex w-fit items-center gap-2 rounded-xl bg-white px-2.5 py-1.5 shadow-sm">
        <img src={official ?? baktiPlaceholder} alt="BAKTI KOMDIGI" title={official ? 'BAKTI KOMDIGI' : 'Logo resmi BAKTI KOMDIGI belum dipasang'} className="h-7 w-auto max-w-[140px] object-contain" />
        <span className="h-7 w-px shrink-0 bg-slate-300" aria-hidden />
        <img src={ppkLogo} alt="" className="h-7 w-7 shrink-0" />
      </div>
      <div className="mt-1.5 pl-1 text-sm font-bold tracking-wide text-white">PPK Management</div>
    </div>
  );
}
