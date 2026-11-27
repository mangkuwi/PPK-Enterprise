import { app, BrowserWindow, Menu, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { defaultBackupDir, getDb, initDatabase } from './database';
import { AUTO_DIR, runAutoBackup } from './autoBackup';
import { autoServerBackup } from './ppk/server';
import { getSettings } from './repo';
import { log } from './logger';
import { createMainWindow, getMainWindow } from './window';
import { registerIpc } from '../ipc';

// Mode portable: simpan data di samping berkas .exe agar bisa dipindahkan.
if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath('userData', path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'NaskahDinasAI-Data'));
}

process.on('uncaughtException', (e) => log('error', 'uncaughtException', e));
process.on('unhandledRejection', (e) => log('error', 'unhandledRejection', e));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = getMainWindow();
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('id.naskahdinas.ai');
    try {
      initDatabase();
    } catch (e) {
      log('error', 'Gagal membuka database', e);
      dialog.showErrorBox('NASKAHDINAS AI', `Database tidak dapat dibuka:\n${e instanceof Error ? e.message : e}\n\nLokasi data: ${app.getPath('userData')}`);
      app.quit();
      return;
    }
    registerIpc();
    // macOS butuh menu aplikasi agar Cmd+C/V/X/Z/A/Q/W berfungsi; di Windows menu disembunyikan.
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { label: 'Tampilan', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] }, { role: 'windowMenu' }]));
    else if (app.isPackaged) Menu.setApplicationMenu(null);
    createMainWindow();
    // Cek backup otomatis 1 menit setelah mulai lalu tiap jam; backup dibuat bila yang terakhir sudah lewat 24 jam.
    const tick = () => autoBackup().catch((e) => log('error', 'Backup otomatis', e));
    setTimeout(tick, 60_000); setInterval(tick, 3600_000);
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}

async function autoBackup() {
  const s = getSettings(getDb());
  if (s.auto_backup !== 'true') return;
  const dir = s.backup_dir && fs.existsSync(s.backup_dir) ? s.backup_dir : defaultBackupDir();
  const r = await runAutoBackup(getDb(), dir, Number(s.auto_backup_keep) || 14);
  if (r) log('info', `Backup otomatis: ${r.path}${r.pruned.length ? `, dihapus ${r.pruned.length} lama` : ''}`);
  // Mode server: data PPK ada di server, jadi server juga di-backup (tiap komputer yang membuka aplikasi, sekali sehari).
  const sr = await autoServerBackup(getDb(), path.join(dir, AUTO_DIR), Number(s.auto_backup_keep) || 14);
  if (sr) log('info', `Backup server PPK otomatis: ${sr.path}`);
}
