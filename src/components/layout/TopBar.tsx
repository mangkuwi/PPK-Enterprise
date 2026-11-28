import { Link, useLocation } from 'react-router-dom';
import { CalendarDays, Menu, UserCircle2 } from 'lucide-react';
import { GROUPS, activeTab, sectionFor } from '@shared/nav';
import { dayName } from '@shared/ppk/agenda';
import { formatDateID, isoWeek, jakartaToday } from '@shared/date';
import banner from '@/assets/branding/banner-satelit-indonesia.svg';
import { useActor } from '@/features/numbering/NumberingContext';
import { cn } from '@/lib/utils';
import { usePpkAccess } from '@/features/ppk/usePpkAccess';
import { PPK_ROLE_LABEL } from '@shared/ppk/access';

/** Kepala halaman bersama: nama menu, tanggal, profil, dan tab halaman yang digabung ke menu ini. */
export function TopBar({ onMenu }: { onMenu: () => void }) {
  const loc = useLocation();
  const { actor, openLogin, serverUser } = useActor();
  // Mode server: tampilkan akun server PPK yang sedang masuk, bukan pengguna lokal.
  const name = serverUser ?? actor?.name ?? null;
  const { access } = usePpkAccess();
  // Peran PPK akun yang masuk (Staf Input, Pejabat PPK, ...); tanpa peran PPK pakai peran aplikasi.
  const role = access?.role ? PPK_ROLE_LABEL[access.role] : serverUser ? 'Akun server PPK' : actor ? (actor.role === 'admin' ? 'Admin' : 'Operator') : 'Klik untuk masuk';
  const s = sectionFor(loc.pathname);
  const group = s && GROUPS.find((g) => g.sections.includes(s.key))?.label;
  const tab = s && activeTab(s, loc.pathname, loc.search);
  const today = jakartaToday();
  const home = loc.pathname === '/';
  return (
    <header className="shrink-0">
      {/* Satu kepala bergambar (bumi + satelit): menggantikan bilah putih + banner Dashboard agar konten naik ke atas. */}
      <div className="relative overflow-hidden bg-[#0b1d4a] text-white">
        <img src={banner} alt="" aria-hidden decoding="async" className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover object-left" />
        <div className="relative flex items-center gap-2 px-3 py-2.5 md:gap-4 md:px-6">
          <button onClick={onMenu} className="-ml-1 rounded-lg p-2 hover:bg-white/10 md:hidden" aria-label="Buka menu"><Menu size={22} /></button>
          <div className="min-w-0">
            <div className="truncate text-lg font-bold leading-tight drop-shadow">PPK Management</div>
            <div className="truncate text-xs text-blue-100">
              {home ? <><span className="md:hidden">{dayName(today)}, {formatDateID(today)}</span><span className="max-md:hidden">Pengelolaan Tugas, Agenda, Dokumen &amp; Kontrak</span></>
                : [group, s?.label].filter(Boolean).join(' › ') || 'Beranda'}</div>
          </div>
          <div className="ml-auto hidden items-center gap-2.5 rounded-lg bg-white/10 px-3 py-1.5 text-xs leading-tight text-blue-100 ring-1 ring-white/20 backdrop-blur-sm md:flex">
            <CalendarDays size={22} className="text-white" /><div><b className="block text-sm text-white">{dayName(today)}, {formatDateID(today)}</b>Minggu ke-{isoWeek(today)} | TA {today.slice(0, 4)}</div></div>
          <button onClick={openLogin} className="ml-auto flex shrink-0 items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-white/10 md:ml-0" title="Profil pengguna / ganti pengguna" aria-label="Profil pengguna">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-sm font-bold text-white ring-1 ring-white/30">{name ? name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') : <UserCircle2 size={20} />}</span>
            <span className="hidden text-xs leading-tight lg:block"><b className="block text-sm text-white">{name ?? 'Belum masuk'}</b><span className="text-blue-100">{role}</span></span>
          </button>
        </div>
      </div>
      {s && s.tabs.length > 0 && (
        <nav className="flex gap-1.5 overflow-x-auto border-b border-slate-300 bg-white px-3 py-2 shadow-sm md:px-6" aria-label={`Bagian ${s.label}`}>
          {s.tabs.map((t) => (
            <Link key={t.to} to={t.to} aria-current={tab === t.to ? 'page' : undefined}
              className={cn('whitespace-nowrap rounded-lg border px-3.5 py-1.5 text-sm font-semibold transition', tab === t.to ? 'border-blue-700 bg-blue-600 text-white shadow-sm' : 'border-slate-300 bg-slate-50 text-slate-800 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-800')}>{t.label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
