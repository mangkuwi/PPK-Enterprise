import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildElectron() {
  const common = {
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    external: ['electron', 'better-sqlite3', 'pdfjs-dist'],
    alias: { '@shared': path.join(root, 'shared') },
    logLevel: 'info'
  };
  await build({ ...common, entryPoints: [path.join(root, 'electron/main/index.ts')], outfile: path.join(root, 'dist-electron/main.js') });
  await build({ ...common, entryPoints: [path.join(root, 'electron/preload/index.ts')], outfile: path.join(root, 'dist-electron/preload.js') });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildElectron().catch((e) => { console.error(e); process.exit(1); });
}
