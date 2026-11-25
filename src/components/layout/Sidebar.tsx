import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Archive, BookOpen, Building2, SlidersHorizontal, ChevronsLeft, ChevronsRight, FileClock, FilePlus2, FileSearch, FileText, FileUp, Files, Hash, History, LayoutDashboard, Library, Mail, Settings, UserCircle2, Wand2, type LucideIcon } from 'lucide-react';
import { useActor } from '@/features/numbering/NumberingContext';
import { cn } from '@/lib/utils';

interface Item { to: string; label: string; icon: LucideIcon; end?: boolean }
const groups: Array<{ title: string; items: Item[] }> = [
  { title: 'Workspace', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/generator', label: 'Buat Dokumen', icon: FilePlus2 },
    { to: '/archive', label: 'Semua Dokumen', icon: Files, end: true },
    { to: '/archive?status=draft', label: 'Draft & Riwayat', icon: FileClock }
  ] },
  { title: 'Template Management', items: [
    { to: '/templates', label: 'Template Dokumen', icon: FileText },
    { to: '/importer', label: 'Import Template', icon: FileUp, end: true },
    { to: '/importer/review', label: 'Analisis & Mapping', icon: FileSearch },
    { to: '/importer/preview', label: 'Preview Template', icon: Wand2 },
    { to: '/importer/templates', label: 'Template Terimpor', icon: Library },
    { to: '/importer/history', label: 'Riwayat Import', icon: History }
  ] },
  { title: 'Administrasi', items: [
    { to: '/bank-nomor', label: 'Bank Nomor Dokumen', icon: Hash },
    { to: '/register/surat-keluar', label: 'Register Surat Keluar', icon: Mail },
    { to: '/penomoran', label: 'Register Lainnya & Impor', icon: BookOpen, end: true },
    { to: '/archive?status=final', label: 'Arsip Dokumen', icon: Archive }
  ] },
  { title: 'PPK Management', items: [
    { to: '/ppk/penyedia', label: 'Database Penyedia', icon: Building2 },
    { to: '/ppk/pengaturan', label: 'Pengaturan PPK', icon: SlidersHorizontal }
  ] },
  { title: 'Settings', items: [
    { to: '/settings', label: 'Pengaturan', icon: Settings }
  ] }
];

const KEY = 'nd.sidebar.collapsed';
const read = () => { try { const v = localStorage.getItem(KEY); return v === null ? window.innerWidth < 1100 : v === '1'; } catch { return false; } };

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(read);
  const { actor, openLogin } = useActor();
  const loc = useLocation();
  useEffect(() => { try { localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* penyimpanan tidak tersedia */ } }, [collapsed]);
  // Item berparameter (?status=) aktif hanya bila query-nya cocok; item tanpa query tidak ikut aktif untuk query lain.
  const active = (it: Item, routerActive: boolean) => {
    const [path, q] = it.to.split('?');
    if (q) return loc.pathname === path && loc.search === `?${q}`;
    if (path === '/archive') return loc.pathname === '/archive' && !loc.search.includes('status=');
    return routerActive;
  };
  return (
    <aside className={cn('flex shrink-0 flex-col bg-navy-900 text-slate-200 transition-[width] duration-150', collapsed ? 'w-16' : 'w-64')} aria-label="Navigasi utama">
      <div className="flex items-center justify-between border-b border-navy-700 px-3 py-4">
        {!collapsed && <div className="px-2"><div className="text-lg font-bold tracking-wide text-white">NASKAHDINAS <span className="text-sky-300">AI</span></div><div className="text-xs text-slate-400">Smart Document Generator</div></div>}
        <button onClick={() => setCollapsed(!collapsed)} className={cn('rounded p-2 text-slate-300 hover:bg-navy-800 hover:text-white', collapsed && 'mx-auto')} aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'} title={collapsed ? 'Perluas' : 'Ciutkan'}>
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>
      <nav className="flex-1 space-y-4 overflow-auto p-2">
        {groups.map((g) => (
          <div key={g.title}>
            {!collapsed ? <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">{g.title}</div> : <div className="mx-3 mb-1 border-t border-navy-700" />}
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} title={collapsed ? it.label : undefined} aria-label={it.label}
                  className={({ isActive }) => cn('relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors', collapsed && 'justify-center px-0',
                    active(it, isActive) ? 'bg-navy-700 text-white before:absolute before:left-0 before:top-1.5 before:h-6 before:w-1 before:rounded-r before:bg-sky-300' : 'text-slate-300 hover:bg-navy-800 hover:text-white')}>
                  <it.icon size={18} className="shrink-0" />{!collapsed && <span className="truncate">{it.label}</span>}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <button onClick={openLogin} className={cn('flex w-full items-center gap-2 border-t border-navy-700 px-4 py-3 text-left text-xs text-slate-300 hover:bg-navy-800', collapsed && 'justify-center px-0')} title="Profil pengguna / ganti pengguna" aria-label="Profil pengguna">
        <UserCircle2 size={18} className="shrink-0" />{!collapsed && <span className="truncate">Profil Pengguna: {actor ? `${actor.name} · ${actor.role === 'admin' ? 'Admin' : 'Operator'}` : 'Belum masuk'}</span>}
      </button>
      {!collapsed && <div className="border-t border-navy-700 px-5 py-2 text-[11px] text-slate-400">Data tersimpan lokal · offline</div>}
    </aside>
  );
}
