import type { ReactNode } from 'react';
export const Page = ({ children }: { children: ReactNode }) => <div className="h-full overflow-auto p-3 sm:p-6">{children}</div>;
