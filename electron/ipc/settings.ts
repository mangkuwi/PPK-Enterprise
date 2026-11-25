import { dialog, net, safeStorage } from 'electron';
import fs from 'node:fs';
import { z } from 'zod';
import { handle } from './handle';
import * as S from './schemas';
import { getDb } from '../main/database';
import { deleteSetting, getRawSetting, getSettings, setSettings } from '../main/repo';
import { getMainWindow } from '../main/window';
import { AI_ACTIONS, AI_SYSTEM_PROMPT, checkAiOutput } from '@shared/ai-guard';

const KEY = 'ai_api_key_enc';

const publicSettings = () => ({ ...getSettings(getDb()), ai_key_set: getRawSetting(getDb(), KEY) ? 'true' : 'false' });

function allowedEndpoint(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('Alamat endpoint AI tidak valid.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Endpoint AI harus HTTPS (HTTP hanya untuk localhost).');
  return u;
}

/** Panggilan ke layanan AI yang dikonfigurasi pengguna (opsional). Hanya teks yang diberikan yang dikirim. */
export async function aiComplete(system: string, user: string): Promise<string> {
  const s = getSettings(getDb());
  if (s.ai_enabled !== 'true') throw new Error('Fitur AI belum diaktifkan di Pengaturan.');
  if (!s.ai_endpoint || !s.ai_model) throw new Error('Endpoint dan model AI belum dikonfigurasi.');
  const url = allowedEndpoint(s.ai_endpoint);
  const enc = getRawSetting(getDb(), KEY);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (enc) headers.Authorization = `Bearer ${safeStorage.decryptString(Buffer.from(enc, 'base64'))}`;
  const res = await net.fetch(url.toString(), {
    method: 'POST', headers,
    body: JSON.stringify({ model: s.ai_model, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] })
  });
  if (!res.ok) throw new Error(`Layanan AI menjawab ${res.status}.`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const out = json.choices?.[0]?.message?.content?.trim();
  if (!out) throw new Error('Layanan AI tidak mengembalikan teks.');
  return out;
}

export function registerSettingsHandlers() {
  handle('settings:get', S.empty, () => publicSettings());
  handle('settings:set', S.settingsInput, (values) => { setSettings(getDb(), values); return publicSettings(); });

  handle('settings:chooseDir', z.object({ purpose: z.enum(['export', 'backup']) }), async ({ purpose }) => {
    const res = await dialog.showOpenDialog(getMainWindow()!, { properties: ['openDirectory', 'createDirectory'] });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const dir = res.filePaths[0];
    if (!fs.statSync(dir).isDirectory()) throw new Error('Bukan folder.');
    setSettings(getDb(), { [purpose === 'export' ? 'export_dir' : 'backup_dir']: dir });
    return { canceled: false, path: dir };
  });

  // Kunci API disimpan terenkripsi lewat safeStorage OS (DPAPI di Windows) dan tidak pernah dikirim balik ke renderer.
  handle('settings:setAiKey', z.object({ key: z.string().max(500) }), ({ key }) => {
    if (!key.trim()) { deleteSetting(getDb(), KEY); return publicSettings(); }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Penyimpanan aman sistem operasi tidak tersedia; kunci API tidak disimpan.');
    setSettings(getDb(), { [KEY]: safeStorage.encryptString(key.trim()).toString('base64') });
    return publicSettings();
  });

  handle('ai:run', S.aiRun, async ({ action, text }) => {
    const out = await aiComplete(AI_SYSTEM_PROMPT, `${AI_ACTIONS[action]}\n\n${text}`);
    return { text: out, warnings: checkAiOutput(text, out) };
  });
}
