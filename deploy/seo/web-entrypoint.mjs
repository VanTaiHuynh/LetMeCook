import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { seoConfig } from '../../client/src/utils/seo.js';
import { startGateway } from './gateway.mjs';

// Only the browser's anonymous key may authorize source-image reads. Storage RLS
// still decides visibility; the image gateway never receives a service-role key.
const storageAnonKey = process.env.SUPABASE_ANON_KEY || '';
let storageRole;
try {
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(storageAnonKey)) throw new Error();
  storageRole = JSON.parse(Buffer.from(storageAnonKey.split('.')[1], 'base64url').toString('utf8')).role;
} catch { throw new Error('Source-image storage requires a valid anonymous browser key.'); }
if (storageRole !== 'anon') throw new Error('Source-image storage requires an anonymous browser key.');
await writeFile('/tmp/lmc-recipe-storage-auth.conf', `proxy_set_header apikey "${storageAnonKey}";\nproxy_set_header Authorization "Bearer ${storageAnonKey}";\nproxy_set_header Cookie "";\n`, { mode: 0o600 });

const config = seoConfig({ publicSiteOrigin: process.env.PUBLIC_SITE_ORIGIN, indexingEnabled: process.env.SEO_INDEXING_ENABLED });
await writeFile('/tmp/lmc-seo-headers.conf', config.indexingEnabled ? '' : 'add_header X-Robots-Tag "noindex, follow" always;\n');
const server = await startGateway({ config });
const nginx = spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit' });
let stopping = false;
let exitCode = 0;
function stop(signal = 'SIGTERM', failed = false) {
  if (failed) exitCode = 1;
  if (stopping) return; stopping = true;
  server.close(); nginx.kill(signal);
  setTimeout(() => { nginx.kill('SIGKILL'); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', () => stop()); process.on('SIGINT', () => stop('SIGINT'));
nginx.once('error', () => { stop('SIGTERM', true); process.exitCode = 1; });
nginx.once('exit', code => { server.close(); process.exitCode = stopping ? exitCode : (code || 1); });
server.once('error', () => { stop('SIGTERM', true); process.exitCode = 1; });
