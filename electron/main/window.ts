import { BrowserWindow, app, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

let win: BrowserWindow | null = null;
export const getMainWindow = () => win;

const indexFile = () => path.join(__dirname, '..', 'dist', 'index.html');
const devUrl = () => (!app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined);

/** Hanya halaman aplikasi sendiri yang boleh memanggil IPC. */
export function isTrustedUrl(url: string | undefined): boolean {
  if (!url) return false;
  const dev = devUrl();
  if (dev) return url.startsWith(dev);
  return url.split('#')[0] === pathToFileURL(indexFile()).href;
}

export function createMainWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1024, minHeight: 680,
    show: false, backgroundColor: '#f1f5f9', title: 'NASKAHDINAS AI', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: true
    }
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });

  // Blokir navigasi dan jendela baru; tautan http(s) dibuka di browser sistem.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!isTrustedUrl(url)) e.preventDefault(); });
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const dev = devUrl();
  if (dev) {
    void win.loadURL(dev);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(indexFile());
  }
  return win;
}
