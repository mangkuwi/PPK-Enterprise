import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from '@shared/numbering';

/** Sesi satu browser (HP/laptop lain) di mode web. Di aplikasi desktop tidak ada konteks ini. */
export interface WebCtx { actor: Actor | null; server: Actor | null }
export const webStore = new AsyncLocalStorage<WebCtx>();
export const webCtx = () => webStore.getStore();
