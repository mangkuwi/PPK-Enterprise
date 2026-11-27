/**
 * Font pengganti berukuran setara (OFL) untuk font Office yang tidak ada di macOS bawaan.
 * Nama keluarga sengaja sama ("Calibri", "Cambria"): local() dipakai bila font aslinya terpasang,
 * bila tidak, Carlito/Caladea yang disematkan sebagai data URI (pratinjau dan PDF ber-CSP `font-src data:`).
 * shortcut: hanya subset latin (cukup untuk Bahasa Indonesia), tambahkan latin-ext bila ada laporan huruf hilang.
 */
import carlito400 from '@fontsource/carlito/files/carlito-latin-400-normal.woff2';
import carlito400i from '@fontsource/carlito/files/carlito-latin-400-italic.woff2';
import carlito700 from '@fontsource/carlito/files/carlito-latin-700-normal.woff2';
import carlito700i from '@fontsource/carlito/files/carlito-latin-700-italic.woff2';
import caladea400 from '@fontsource/caladea/files/caladea-latin-400-normal.woff2';
import caladea400i from '@fontsource/caladea/files/caladea-latin-400-italic.woff2';
import caladea700 from '@fontsource/caladea/files/caladea-latin-700-normal.woff2';
import caladea700i from '@fontsource/caladea/files/caladea-latin-700-italic.woff2';

const face = (family: string, local: string, url: string, weight: number, style: string) =>
  `@font-face{font-family:'${family}';src:local('${local}'),url(${url}) format('woff2');font-weight:${weight};font-style:${style}}`;

export const DOC_FONT_CSS = [
  face('Calibri', 'Calibri', carlito400, 400, 'normal'), face('Calibri', 'Calibri Italic', carlito400i, 400, 'italic'),
  face('Calibri', 'Calibri Bold', carlito700, 700, 'normal'), face('Calibri', 'Calibri Bold Italic', carlito700i, 700, 'italic'),
  face('Cambria', 'Cambria', caladea400, 400, 'normal'), face('Cambria', 'Cambria Italic', caladea400i, 400, 'italic'),
  face('Cambria', 'Cambria Bold', caladea700, 700, 'normal'), face('Cambria', 'Cambria Bold Italic', caladea700i, 700, 'italic')
].join('');

/** Font yang tidak disematkan: urutan cadangan bila tidak terpasang (Bookman tidak ada pengganti OFL). */
export const FONT_FALLBACK: Record<string, string> = { 'Bookman Old Style': "'Bookman Old Style','Bookman','URW Bookman',Georgia,serif" };
