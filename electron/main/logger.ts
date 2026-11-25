import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export function log(level: 'info' | 'error', message: string, err?: unknown) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    const detail = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : err ? String(err) : '';
    fs.appendFileSync(path.join(dir, 'app.log'), `${new Date().toISOString()} [${level}] ${message} ${detail}\n`);
  } catch { /* logging tidak boleh menjatuhkan aplikasi */ }
  if (!app.isPackaged) (level === 'error' ? console.error : console.log)(message, err ?? '');
}
