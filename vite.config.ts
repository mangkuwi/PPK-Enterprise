import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// CSP hanya disisipkan pada build produksi (dev server memerlukan inline script untuk HMR).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'"
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  transformIndexHtml(html, ctx) {
    if (ctx.server) return html;
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  }
});

export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
  resolve: {
    // Utamakan sumber TypeScript bila ada berkas .js hasil kompilasi yang nyasar.
    extensions: ['.ts', '.tsx', '.mjs', '.js', '.json'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared')
    }
  },
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false }
});
