import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Lokasi LibreOffice (opsional) untuk PDF yang setia pada DOCX. Tanpa shell; argumen tetap. */
export function findSoffice(): string | null {
  const cands = process.platform === 'win32'
    ? [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean).map((d) => path.join(d as string, 'LibreOffice', 'program', 'soffice.exe'))
    : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return cands.find((c) => fs.existsSync(c)) ?? null;
}

export async function docxToPdf(docx: Buffer): Promise<Buffer> {
  const exe = findSoffice();
  if (!exe) throw new Error('LibreOffice tidak ditemukan.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nd-pdf-'));
  try {
    const input = path.join(dir, 'dokumen.docx');
    fs.writeFileSync(input, docx);
    await new Promise<void>((resolve, reject) => {
      execFile(exe, ['--headless', '--norestore', `-env:UserInstallation=file:///${path.join(dir, 'profile').replace(/\\/g, '/')}`, '--convert-to', 'pdf', '--outdir', dir, input],
        { timeout: 120_000, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    });
    return fs.readFileSync(path.join(dir, 'dokumen.pdf'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
