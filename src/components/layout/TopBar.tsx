import { Link, useLocation } from 'react-router-dom';
import { UserCircle2 } from 'lucide-react';
import { GROUPS, activeTab, sectionFor } from '@shared/nav';
import { dayName } from '@shared/ppk/agenda';
import { formatDateID, jakartaToday } from '@shared/date';
import { useActor } from '@/features/numbering/NumberingContext';
import { cn } from '@/lib/utils';

/** Kepala halaman bersama: nama menu, tanggal, profil, dan tab halaman yang digabung ke menu ini. */
export function TopBar() {
  const loc = useLocation();
  const { actor, openLogin, serverUser } = useActor();
  // Mode server: tampilkan akun server PPK yang sedang masuk, bukan pengguna lokal.
  const name = serverUser ?? actor?.name ?? null;
  const s = sectionFor(loc.pathname);
  const group = s && GROUPS.find((g) => g.sections.includes(s.key))?.label;
  const tab = s && activeTab(s, loc.pathname, loc.search);
  const today = jakartaToday();
  return (
    <header className="shrink-0 border-b border-slate-200 bg-white">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="min-w-0">
          <div className="text-lg font-bold leading-tight text-navy-900">PPK Management</div>
          <div className="truncate text-xs text-slate-500">{[group, s?.label].filter(Boolean).join(' › ') || 'Beranda'}</div>
        </div>
        <div className="ml-auto hidden text-right text-xs text-slate-500 md:block"><b className="block text-sm text-navy-900">{dayName(today)}, {formatDateID(today)}</b>TA {today.slice(0, 4)}</div>
        <button onClick={openLogin} className="flex items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-slate-100" title="Profil pengguna / ganti pengguna" aria-label="Profil pengguna">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-100 text-sm font-bold text-blue-800">{name ? name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') : <UserCircle2 size={20} />}</span>
          <span className="hidden text-xs leading-tight lg:block"><b className="block text-sm text-navy-900">{name ?? 'Belum masuk'}</b><span className="text-slate-500">{serverUser ? 'Akun server PPK' : actor ? (actor.role === 'admin' ? 'Admin' : 'Operator') : 'Klik untuk masuk'}</span></span>
        </button>
      </div>
      {s && s.tabs.length > 0 && (
        <nav className="flex gap-1 overflow-x-auto px-6" aria-label={`Bagian ${s.label}`}>
          {s.tabs.map((t) => (
            <Link key={t.to} to={t.to} aria-current={tab === t.to ? 'page' : undefined}
              className={cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm', tab === t.to ? 'border-blue-600 font-semibold text-blue-700' : 'border-transparent text-slate-500 hover:text-navy-900')}>{t.label}</Link>
          ))}
        </nav>
      )}
    </header>
  );
}
