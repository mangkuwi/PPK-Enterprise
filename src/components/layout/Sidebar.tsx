import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, Building2, CalendarDays, Database, ChevronDown, ChevronsLeft, ChevronsRight, FilePlus2, FileSignature, Files, FileText, Hash, LayoutDashboard, Layers, Library, Receipt, Settings, Wallet, type LucideIcon } from 'lucide-react';
import { GROUPS, sectionByKey, sectionFor } from '@shared/nav';
import { useActor } from '@/features/numbering/NumberingContext';
import { cn } from '@/lib/utils';
import { BrandLogos } from './Brand';
import satelliteArt from '@/assets/branding/ilustrasi-satelit-sidebar.svg';

const ICON: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard, agenda: CalendarDays, buat: FilePlus2, dokumen: Files, template: FileText, bank: Hash, register: Library,
  kontrak: FileSignature, tagihan: Receipt, anggaran: Wallet, penyedia: Building2, prognosis: BarChart3, pengaturan: Settings
};

const GROUP_ICON: Record<string, LucideIcon> = { 'Administrasi Dokumen': FileText, 'Nomor Surat': Hash, Kontraktual: FileSignature, Database };

const KEY = 'nd.sidebar.collapsed';
const OPEN_KEY = 'nd.sidebar.open';
const read = () => { try { const v = localStorage.getItem(KEY); return v === null ? window.innerWidth < 1100 : v === '1'; } catch { return false; } };
const readOpen = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; } };

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(read);
  const [open, setOpen] = useState(readOpen);
  const loc = useLocation();
  const { serverUser } = useActor();
  const current = sectionFor(loc.pathname)?.key;
  useEffect(() => { try { localStorage.setItem(KEY, collapsed ? '1' : '0'); localStorage.setItem(OPEN_KEY, JSON.stringify(open)); } catch { /* penyimpanan tidak tersedia */ } }, [collapsed, open]);

  const link = (key: string, sub: boolean) => {
    const s = sectionByKey(key); const Icon = ICON[key] ?? Layers; const on = current === key;
    return (
      <NavLink key={key} to={s.to} title={collapsed ? s.label : undefined} aria-label={s.label} aria-current={on ? 'page' : undefined}
        className={cn('flex items-center gap-3 rounded-lg px-3 text-sm transition-colors', sub && !collapsed ? 'py-1.5 pl-9' : 'py-2.5 font-medium', collapsed && 'justify-center px-0',
          on ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-slate-300 hover:bg-white/10 hover:text-white')}>
        {(!sub || collapsed) && <Icon size={18} className="shrink-0" />}{!collapsed && <span className="truncate">{s.label}</span>}
      </NavLink>
    );
  };

  const toggle = (
    <button onClick={() => setCollapsed(!collapsed)} className="shrink-0 rounded p-1.5 text-slate-300 hover:bg-white/10 hover:text-white" aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'} title={collapsed ? 'Perluas' : 'Ciutkan'}>
      {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
    </button>);

  return (
    <aside className={cn('flex shrink-0 flex-col bg-gradient-to-b from-[#0b1d4a] to-[#0a2a6b] text-slate-200 transition-[width] duration-150', collapsed ? 'w-16' : 'w-64')} aria-label="Navigasi utama">
      <div className={cn('flex items-center gap-1 py-4', collapsed ? 'flex-col px-2' : 'px-3')}>
        <BrandLogos compact={collapsed} />
        {collapsed && toggle}
      </div>
      <nav className="flex-1 space-y-1 overflow-auto px-2 pb-3">
        {GROUPS.map((g, i) => {
          if (!g.label) return <div key={i} className="space-y-1">{g.sections.map((k) => link(k, false))}</div>;
          const label = g.label;
          const hasCurrent = g.sections.includes(current ?? '');
          const isOpen = collapsed || hasCurrent || !!open[label];
          return (
            <div key={label}>
              {collapsed ? <div className="mx-3 my-2 border-t border-white/10" />
                : <button onClick={() => setOpen({ ...open, [label]: !open[label] })} aria-expanded={isOpen} disabled={hasCurrent}
                  className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium', hasCurrent ? 'text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white')}>
                  <span className="flex items-center gap-3">{(() => { const Icon = GROUP_ICON[label] ?? Layers; return <Icon size={18} />; })()}{label}</span>
                  <ChevronDown size={15} className={cn('transition-transform', isOpen ? 'rotate-180' : '', hasCurrent && 'opacity-40')} />
                </button>}
              {isOpen && <div className={cn('space-y-0.5', !collapsed && 'mb-1')}>{g.sections.map((k) => link(k, true))}</div>}
            </div>
          );
        })}
      </nav>
      {/* Ilustrasi dekoratif; hanya bila layar cukup tinggi agar tidak menyempitkan menu. */}
      {!collapsed && <img src={satelliteArt} alt="" aria-hidden loading="lazy" decoding="async" className="pointer-events-none -mt-6 hidden w-full shrink-0 select-none [@media(min-height:780px)]:block" />}
      {!collapsed && <div className="flex items-center justify-between border-t border-white/10 py-1 pl-5 pr-2 text-[11px] text-slate-400">{serverUser ? 'Terhubung ke server PPK' : 'Data tersimpan lokal · offline'}{toggle}</div>}
    </aside>
  );
}
