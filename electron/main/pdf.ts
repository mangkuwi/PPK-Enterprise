import { BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildDocumentHtml, esc } from '@shared/render';
import type { ExportInput } from './docx-export';

async function withPrintWindow<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const file = path.join(app.getPath('temp'), `naskahdinas-${randomUUID()}.html`);
  fs.writeFileSync(file, html, 'utf8');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true }
  });
  try {
    await win.loadFile(file);
    return await fn(win);
  } finally {
    if (!win.isDestroyed()) win.destroy();
    fs.rmSync(file, { force: true });
  }
}

const htmlFor = (i: ExportInput) =>
  buildDocumentHtml({ title: i.title, content: i.content, layout: i.layout, kop: i.kop, mode: 'print' });

const tpl = (inner: string) =>
  `<div style="font-size:9px;width:100%;text-align:center;color:#333;padding:0 12mm;font-family:Arial,sans-serif">${inner}</div>`;

export async function renderPdf(i: ExportInput): Promise<Buffer> {
  const hasHeader = !!i.headerText.trim();
  const footerInner = [i.footerText.trim() ? esc(i.footerText).replace(/\r?\n/g, '<br>') : '',
    i.layout.showPageNumber ? 'Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span>' : ''].filter(Boolean).join('<br>');
  const displayHeaderFooter = hasHeader || !!footerInner;
  return withPrintWindow(htmlFor(i), (win) =>
    win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter,
      headerTemplate: tpl(hasHeader ? esc(i.headerText).replace(/\r?\n/g, '<br>') : ''),
      footerTemplate: tpl(footerInner)
    }));
}

export async function printDocument(i: ExportInput): Promise<{ printed: boolean }> {
  return withPrintWindow(htmlFor(i), (win) =>
    new Promise((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success) resolve({ printed: true });
        else if (/cancel/i.test(reason)) resolve({ printed: false });
        else reject(new Error(`Pencetakan gagal: ${reason}`));
      });
    }));
}

/** PDF dari HTML siap cetak (mis. register penomoran). Ukuran/orientasi ditentukan oleh @page pada HTML. */
export async function renderHtmlPdf(html: string): Promise<Buffer> {
  return withPrintWindow(html, (win) => win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true }));
}
