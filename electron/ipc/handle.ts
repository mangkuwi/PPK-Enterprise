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

/** Mendaftarkan handler IPC dengan validasi pengirim + validasi payload (zod) + penanganan error seragam. */
export function handle<S extends z.ZodTypeAny>(
  channel: Channel,
  schema: S,
  fn: (input: z.infer<S>, event: IpcMainInvokeEvent) => unknown | Promise<unknown>
) {
  ipcMain.handle(channel, async (event, raw): Promise<Result> => {
    try {
      if (!isTrustedUrl(event.senderFrame?.url)) throw new Error('Pengirim IPC tidak dipercaya.');
      const input = schema.parse(raw ?? {});
      return { ok: true, data: await fn(input, event) };
    } catch (err) {
      log('error', `IPC ${channel} gagal`, err);
      return { ok: false, error: message(err) };
    }
  });
}
