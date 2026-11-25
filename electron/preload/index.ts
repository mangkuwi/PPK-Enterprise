import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../../shared/channels';

const allowed = new Set<string>(CHANNELS);

// Satu-satunya jembatan ke proses utama: hanya channel pada daftar putih yang bisa dipanggil.
contextBridge.exposeInMainWorld('api', {
  invoke: (channel: string, payload?: unknown): Promise<unknown> => {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Channel tidak diizinkan: ${channel}`));
    return ipcRenderer.invoke(channel, payload);
  }
});
