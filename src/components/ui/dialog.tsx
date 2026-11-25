import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;

export function DialogContent({ title, description, children, footer, className, wide }: {
  title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; className?: string; wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
      <D.Content
        className={cn('fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl focus:outline-none',
          wide ? 'max-w-5xl' : 'max-w-lg', className)}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <D.Title className="text-base font-semibold text-navy-900">{title}</D.Title>
            {description ? <D.Description className="mt-0.5 text-sm text-slate-500">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          <D.Close className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Tutup"><X size={18} /></D.Close>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}
