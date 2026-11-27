import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as const;

export function readFileAsDataUrl(file: File, maxBytes = 3 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|gif|bmp)$/i.test(file.type)) return reject(new Error('Gunakan gambar PNG, JPEG, GIF, atau BMP.'));
    if (file.size > maxBytes) return reject(new Error(`Ukuran gambar maksimal ${(maxBytes / 1024 / 1024).toFixed(0)} MB.`));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Gagal membaca berkas gambar.'));
    r.readAsDataURL(file);
  });
}

export function imageNaturalWidth(src: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth || 300);
    img.onerror = () => resolve(300);
    img.src = src;
  });
}
