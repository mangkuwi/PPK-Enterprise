// Memasang biner better-sqlite3 untuk ABI Electron. Memakai biner prebuilt (tanpa Visual Studio);
// bila gagal, jatuh ke electron-builder install-app-deps (butuh toolchain C++).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const run = (cmd, cwd = root) => spawnSync(cmd, { stdio: 'inherit', shell: true, cwd }).status ?? 1;
const electronPkg = path.join(root, 'node_modules', 'electron', 'package.json');
const sqliteDir = path.join(root, 'node_modules', 'better-sqlite3');

if (existsSync(electronPkg) && existsSync(sqliteDir)) {
  const v = JSON.parse(readFileSync(electronPkg, 'utf8')).version;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  console.log(`[rebuild] better-sqlite3 untuk Electron ${v} (${process.platform}-${arch})`);
  if (run(`npx --yes prebuild-install --runtime=electron --target=${v} --arch=${arch} --platform=${process.platform}`, sqliteDir) === 0) process.exit(0);
  console.warn('[rebuild] biner prebuilt tidak tersedia, mencoba kompilasi lokal…');
}
process.exit(run('npx electron-builder install-app-deps'));
