import * as React from 'react';
import { cn } from '@/lib/utils';

export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)} {...p} />
);

export const Badge = ({ className, tone = 'slate', ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: 'slate' | 'navy' | 'green' | 'amber' | 'red' }) => (
  <span
    className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', {
      slate: 'bg-slate-100 text-slate-700', navy: 'bg-navy-100 text-navy-800', green: 'bg-emerald-100 text-emerald-800',
      amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-800'
    }[tone], className)}
    {...p}
  />
);

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-navy-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">{children}</div>
);

export const STATUS_LABEL = { draft: 'Draft', review: 'Dalam Pemeriksaan', final: 'Final' } as const;
export const STATUS_TONE = { draft: 'slate', review: 'amber', final: 'green' } as const;
