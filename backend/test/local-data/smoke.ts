/** Against the REAL local stack that local:load built: migrations ran, the data API answers with a token the backend signs, files round-trip. */
import * as fs from 'fs';
import { parseEnv } from 'util';

import { DbTokenMinter } from '../../src/common/db/db-token';
import { S3ObjectStore } from '../../src/common/storage/s3-object-store';

const env = parseEnv(fs.readFileSync(process.env.LOCAL_ENV_FILE as string, 'utf8'));
let failed = false;
async function check(name: string, run: () => Promise<void>): Promise<void> {
  try { await run(); console.log(`ok   ${name}`); } catch (e) { failed = true; console.log(`FAIL ${name}  ${e instanceof Error ? e.message : String(e)}`); }
}
const must = (c: boolean, m: string) => { if (!c) throw new Error(m); };

async function main(): Promise<void> {
  const minter = new DbTokenMinter(env.DB_JWT_SECRET as string);
  const api = async (path: string, token: string, init: RequestInit = {}) =>
    fetch(`${env.POSTGREST_URL}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });

  await check('the data API answers a service-role token and shows the migrations that ran after the baseline', async () => {
    const res = await api('/schema_migrations?select=name&order=name', minter.forService());
    must(res.ok, `HTTP ${res.status}`);
    const names = ((await res.json()) as { name: string }[]).map((r) => r.name);
    must(names.some((n) => n.startsWith('918_')) && names.some((n) => n.startsWith('932_')), `got ${names.join(',')}`);
  });
  await check('the carried user directory is readable through migration 932 (same id as the source)', async () => {
    const res = await api('/rpc/directory_find_by_email', minter.forService(), { method: 'POST', body: JSON.stringify({ p_email: 'Alice@Example.com' }) });
    must(res.ok && (await res.json()) === '11111111-1111-4111-8111-111111111111', `HTTP ${res.status}`);
  });
  await check('a signed-in user token is subject to row-level security (Alice sees her project, Bob does not)', async () => {
    const alice = await (await api('/projects?select=name', minter.forUser('11111111-1111-4111-8111-111111111111'))).json() as { name: string }[];
    const bob = await (await api('/projects?select=name', minter.forUser('22222222-2222-4222-8222-222222222222'))).json() as { name: string }[];
    must(alice.length === 1 && bob.length === 0, `alice ${alice.length}, bob ${bob.length}`);
  });
  await check('the data API refuses an anonymous request to a protected function', async () => {
    const res = await fetch(`${env.POSTGREST_URL}/rpc/link_identity`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_provider: 'auth0', p_sub: 'x', p_email: 'alice@example.com', p_email_verified: true }) });
    must(res.status === 401 || res.status === 403 || res.status === 404, `HTTP ${res.status}`);
  });
  await check('files round-trip through the local bucket the script created', async () => {
    const store = new S3ObjectStore({ bucket: env.S3_BUCKET as string, region: env.S3_REGION as string, endpoint: env.S3_ENDPOINT as string, accessKeyId: env.S3_ACCESS_KEY_ID as string, secretAccessKey: env.S3_SECRET_ACCESS_KEY as string, forcePathStyle: true });
    await store.put('bom-files', 'smoke/a.step', Buffer.from([1, 2, 3, 255]), { upsert: true });
    must(Buffer.compare((await store.get('bom-files', 'smoke/a.step')) as Buffer, Buffer.from([1, 2, 3, 255])) === 0, 'bytes differ');
    await store.remove('bom-files', ['smoke/a.step']);
  });
  process.exit(failed ? 1 : 0);
}
void main();
