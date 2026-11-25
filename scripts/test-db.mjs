// better-sqlite3 dipasang untuk ABI Electron (postinstall). Test yang memakai DB berjalan di Node,
// jadi modul dipasang ulang untuk Node, lalu dikembalikan ke ABI Electron setelah selesai.
import { spawnSync } from 'node:child_process';

const run = (cmd) => spawnSync(cmd, { stdio: 'inherit', shell: true }).status ?? 1;

let code = run('npm rebuild better-sqlite3');
if (code === 0) code = run('npx vitest run tests/db.test.ts tests/importer.test.ts tests/variants.test.ts tests/numbering.test.ts tests/numbering-import.test.ts tests/numbering-integration.test.ts tests/numbering-pool.test.ts');
const restore = run('node scripts/rebuild-electron-abi.mjs');
process.exit(code !== 0 ? code : restore);
