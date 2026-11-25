import { app, BrowserWindow, Menu, dialog } from 'electron';
import path from 'node:path';
import { initDatabase } from './database';
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
    if (app.isPackaged) Menu.setApplicationMenu(null);
    createMainWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
