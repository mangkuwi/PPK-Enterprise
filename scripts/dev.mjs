import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electronPath from 'electron';
import { buildElectron } from './build-electron.mjs';

const server = await createServer({ server: { port: 5173, strictPort: true } });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';
await buildElectron();

const child = spawn(String(electronPath), ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url }
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
