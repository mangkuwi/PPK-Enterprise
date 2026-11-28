import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { ZodError, type z } from 'zod';
import type { Channel } from '@shared/channels';
import { log } from '../main/logger';
import { isTrustedUrl } from '../main/window';

export type Result<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

function message(err: unknown): string {
  if (err instanceof ZodError) {
    const i = err.issues[0];
    return `Input tidak valid${i ? `: ${i.path.join('.') || 'data'} — ${i.message}` : '.'}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Semua handler terdaftar, juga dipakai mode web (electron/ipc/web.ts) tanpa event IPC. */
export const handlers = new Map<string, (raw: unknown) => Promise<Result>>();

/** Mendaftarkan handler IPC dengan validasi pengirim + validasi payload (zod) + penanganan error seragam. */
export function handle<S extends z.ZodTypeAny>(
  channel: Channel,
  schema: S,
  fn: (input: z.infer<S>, event: IpcMainInvokeEvent) => unknown | Promise<unknown>
) {
  const run = async (raw: unknown, event: IpcMainInvokeEvent | null): Promise<Result> => {
    try {
      if (event && !isTrustedUrl(event.senderFrame?.url)) throw new Error('Pengirim IPC tidak dipercaya.');
      const input = schema.parse(raw ?? {});
      return { ok: true, data: await fn(input, event as IpcMainInvokeEvent) };
    } catch (err) {
      log('error', `IPC ${channel} gagal`, err);
      return { ok: false, error: message(err) };
    }
  };
  handlers.set(channel, (raw) => run(raw, null));
  ipcMain.handle(channel, (event, raw) => run(raw, event));
}
