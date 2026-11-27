/** Titik mulai Gateway. Semua rahasia dari variabel lingkungan (lihat .env.example); tidak ada rahasia di kode. */
import pg from 'pg';
import { migrate } from './db.ts';
import { createServer } from './server.ts';
import { recoverJobs, startWorker } from './worker.ts';

const env = (k: string, required = true) => {
  const v = process.env[k]?.trim() ?? '';
  if (required && !v) { console.error(`Variabel ${k} wajib diisi.`); process.exit(1); }
  return v;
};
const log = (s: string) => console.log(`${new Date().toISOString()} ${s}`);

const pool = new pg.Pool({ connectionString: env('DATABASE_URL'), max: 5 });
await migrate(pool);
await recoverJobs(pool);
const apiKey = env('GATEWAY_API_KEY');
if (apiKey.length < 32) { console.error('GATEWAY_API_KEY minimal 32 karakter acak.'); process.exit(1); }
const stopWorker = startWorker(pool, { accessToken: env('WA_ACCESS_TOKEN'), graphVersion: env('WA_GRAPH_VERSION', false) || 'v21.0' }, log);
const server = createServer(pool, { verifyToken: env('WA_VERIFY_TOKEN'), appSecret: env('WA_APP_SECRET'), apiKey, log });
const port = Number(env('PORT', false) || 8080);
server.listen(port, () => log(`Gateway mendengarkan di port ${port}`));

for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { stopWorker(); server.close(() => void pool.end().then(() => process.exit(0))); });
