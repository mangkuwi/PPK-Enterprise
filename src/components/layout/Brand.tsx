import ppkLogo from '@/assets/branding/logo-ppk-management.svg';
import baktiPlaceholder from '@/assets/branding/logo-bakti-komdigi-placeholder.svg';
import { cn } from '@/lib/utils';

// Logo resmi BAKTI KOMDIGI dipakai otomatis bila berkasnya ditaruh di src/assets/branding (lihat README di sana).
const official = Object.values(import.meta.glob('../../assets/branding/logo-bakti-komdigi.{svg,png}', { eager: true, query: '?url', import: 'default' }))[0] as string | undefined;

/** Identitas institusi (BAKTI KOMDIGI) + identitas aplikasi (PPK Management), berdampingan. */
export function BrandLogos({ compact = false, className }: { compact?: boolean; className?: string }) {
  if (compact) return <img src={ppkLogo} alt="PPK Management" className={cn('h-9 w-9', className)} />;
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <img src={official ?? baktiPlaceholder} alt="BAKTI KOMDIGI" title={official ? 'BAKTI KOMDIGI' : 'Logo resmi BAKTI KOMDIGI belum dipasang'} className="h-9 w-auto max-w-[84px] object-contain" />
      <span className="h-8 w-px shrink-0 bg-white/25" aria-hidden />
      <img src={ppkLogo} alt="" className="h-8 w-8 shrink-0" />
      <div className="text-[13px] font-bold leading-tight text-white">PPK<br />Management</div>
    </div>
  );
}
