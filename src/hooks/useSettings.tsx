import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { KopInfo, Layout, Settings } from '@shared/types';
import { DEFAULT_SETTINGS, layoutFromSettings } from '@shared/settings';
import { api } from '@/services/api';

interface Ctx {
  settings: Settings;
  layout: Layout;
  kop: KopInfo | null;
  loaded: boolean;
  refresh: () => Promise<void>;
  update: (values: Record<string, string>) => Promise<void>;
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => { setSettings(await api.settings.get()); setLoaded(true); }, []);
  const update = useCallback(async (values: Record<string, string>) => { setSettings(await api.settings.set(values)); }, []);
  useEffect(() => { refresh().catch(() => setLoaded(true)); }, [refresh]);

  const value = useMemo<Ctx>(() => ({
    settings, loaded, refresh, update,
    layout: layoutFromSettings(settings),
    kop: settings.kop_enabled === 'true' && (settings.institution_name || settings.institution_logo)
      ? { name: settings.institution_name, address: settings.institution_address, logo: settings.institution_logo } : null
  }), [settings, loaded, refresh, update]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const c = useContext(SettingsContext);
  if (!c) throw new Error('useSettings harus berada di dalam SettingsProvider');
  return c;
}
