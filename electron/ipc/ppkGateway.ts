import { safeStorage } from 'electron';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { getDb } from '../main/database';
import { getRawSetting, setSettings } from '../main/repo';
import { log } from '../main/logger';
import { requirePpk } from '../main/ppk/access';
import { gatewayBase, gatewayStatus, pullGateway, type PullConf } from '../main/ppk/gateway';
import { ppkActor, ppkStore } from '../main/ppk/server';

const URL_KEY = 'ppk_gateway_url'; const KEY = 'ppk_gateway_key_enc'; const CURSOR = 'ppk_gateway_cursor';
type Last = { at: string; ok: boolean; added: number; error: string };
let last: Last | null = null; let running = false;

/** Kunci API dienkripsi safeStorage (DPAPI di Windows) dan tidak pernah dikirim ke renderer. */
function conf(): PullConf | null {
  const url = getRawSetting(getDb(), URL_KEY); const enc = getRawSetting(getDb(), KEY);
  return url && enc ? { url, apiKey: safeStorage.decryptString(Buffer.from(enc, 'base64')) } : null;
}

async function sync(): Promise<Last> {
  const c = conf();
  if (!c) throw new Error('Gateway WhatsApp belum diatur.');
  if (running) return last ?? { at: new Date().toISOString(), ok: true, added: 0, error: '' };
  running = true;
  try {
    const r = await pullGateway(ppkStore(getDb()), c, Number(getRawSetting(getDb(), CURSOR) ?? 0));
    setSettings(getDb(), { [CURSOR]: String(r.cursor) });
    last = { at: new Date().toISOString(), ok: true, added: r.added, error: '' };
  } catch (e) {
    last = { at: new Date().toISOString(), ok: false, added: 0, error: e instanceof Error ? e.message : String(e) };
    log('error', 'Tarik Gateway WhatsApp', e);
  } finally { running = false; }
  return last;
}

/** Gateway WhatsApp: atur alamat dan kunci, tarik pesan tiap 60 detik selama aplikasi terbuka. */
export function registerPpkGatewayHandlers() {
  handle('ppk:gateway:status', S.empty, async () => {
    await requirePpk(ppkStore(getDb()), ppkActor(getDb()), 'read');
    return { url: getRawSetting(getDb(), URL_KEY) ?? '', has_key: !!getRawSetting(getDb(), KEY), last };
  });
  handle('ppk:gateway:configure', z.object({ url: z.string().trim().min(1).max(300), api_key: z.string().trim().max(200) }), async ({ url, api_key }) => {
    await requirePpk(ppkStore(getDb()), ppkActor(getDb()), 'roles');
    const base = gatewayBase(url);
    const old = conf();
    const apiKey = api_key || (old?.apiKey ?? '');
    if (apiKey.length < 32) throw new Error('Kunci API minimal 32 karakter (sama dengan GATEWAY_API_KEY di VPS).');
    const st = await gatewayStatus({ url: base, apiKey }); // simpan hanya bila Gateway menjawab
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Penyimpanan aman sistem operasi tidak tersedia; kunci API tidak disimpan.');
    const values: Record<string, string> = { [URL_KEY]: base, [KEY]: safeStorage.encryptString(apiKey).toString('base64') };
    if (old && gatewayBase(old.url) !== base) values[CURSOR] = '0'; // Gateway lain = mulai dari awal; pesan ganda tetap ditolak
    setSettings(getDb(), values);
    return st;
  });
  handle('ppk:gateway:sync', S.empty, async () => {
    await requirePpk(ppkStore(getDb()), ppkActor(getDb()), 'read');
    return sync();
  });
  setInterval(() => { void sync().catch(() => undefined); }, 60_000); // belum diatur = diam
}
