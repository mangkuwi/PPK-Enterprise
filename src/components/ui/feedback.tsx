import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';
import { cn } from '@/lib/utils';

interface Toast { id: number; kind: 'success' | 'error' | 'info'; message: string; action?: { label: string; run: () => void } }
interface ConfirmOpts { title: string; message: ReactNode; confirmLabel?: string; destructive?: boolean }

interface Ctx {
  toast: (message: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
}
const FeedbackContext = createContext<Ctx | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const seq = useRef(0);

  const toast = useCallback<Ctx['toast']>((message, kind = 'info', action) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 5500);
  }, []);

  const confirm = useCallback<Ctx['confirm']>((o) => new Promise((resolve) => setPending({ ...o, resolve })), []);
  const close = (v: boolean) => { pending?.resolve(v); setPending(null); };
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex items-start gap-2 rounded-md border bg-white p-3 text-sm shadow-lg',
            t.kind === 'error' ? 'border-red-300' : t.kind === 'success' ? 'border-emerald-300' : 'border-slate-300')}>
            {t.kind === 'error' ? <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
              : t.kind === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" />
              : <Info size={18} className="mt-0.5 shrink-0 text-navy-600" />}
            <div className="flex-1 break-words">
              {t.message}
              {t.action && <button className="ml-2 font-semibold text-navy-700 underline" onClick={t.action.run}>{t.action.label}</button>}
            </div>
            <button aria-label="Tutup" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={14} /></button>
          </div>
        ))}
      </div>
      <Dialog open={!!pending} onOpenChange={(o) => { if (!o) close(false); }}>
        {pending && (
          <DialogContent
            title={pending.title}
            footer={<>
              <Button variant="outline" onClick={() => close(false)}>Batal</Button>
              <Button variant={pending.destructive ? 'destructive' : 'default'} onClick={() => close(true)}>{pending.confirmLabel ?? 'Ya, lanjutkan'}</Button>
            </>}
          >
            <div className="text-sm text-slate-700">{pending.message}</div>
          </DialogContent>
        )}
      </Dialog>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Ctx {
  const c = useContext(FeedbackContext);
  if (!c) throw new Error('useFeedback harus berada di dalam FeedbackProvider');
  return c;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
