// The design check for moving off Supabase (see CLAUDE.md, "Leaving Supabase"): the REAL SupabaseService in DB_BACKEND=postgrest mode, with tokens the
// REAL DbTokenMinter signs, against a real PostgREST on a real Postgres that only has migration 930. Policies are written exactly as the Supabase
// migrations write them. Started by run.sh, which brings up both in Docker.
import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { DbTokenMinter } from '../../src/common/db/db-token';
import { SupabaseService } from '../../src/common/supabase/supabase.service';

const SECRET = process.env.JWT_SECRET ?? '';
const URL_ = process.env.PGRST_URL ?? '';
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

const service = new SupabaseService(new ConfigService({ DB_BACKEND: 'postgrest', POSTGREST_URL: URL_, DB_JWT_SECRET: SECRET }));
const minter = new DbTokenMinter(SECRET);
const as = (user: string, email?: string) => service.getClient(minter.forUser(user, { email }));

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failed++;
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const forge = (claims: object, secret: string) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(claims);
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
};

(async () => {
  let r = await as(A).from('notes').select('body');
  check("user A sees only A's row", !r.error && r.data?.length === 1 && r.data[0]?.body === 'mine', JSON.stringify(r.error ?? r.data));
  r = await as(B).from('notes').select('body');
  check("user B sees only B's row", !r.error && r.data?.length === 1 && r.data[0]?.body === 'theirs');
  r = await service.getPrivilegedClient('smoke: no user').from('notes').select('body');
  check('the privileged client sees every row (service_role bypasses RLS)', !r.error && r.data?.length === 2, JSON.stringify(r.error ?? r.data));
  const me = await as(A, 'a@example.com').rpc('my_email');
  check('a SECURITY DEFINER function sees the caller through auth.uid()', !me.error && me.data === 'a@example.com', JSON.stringify(me.error ?? me.data));
  const forged = await as(A).from('notes').insert({ owner: B, body: 'forged' });
  check('A cannot insert a row owned by B', !!forged.error, forged.error?.message);
  const own = await as(A).from('notes').insert({ owner: A, body: 'new' }).select('body');
  check('A can insert a row they own and read it back', !own.error && own.data?.[0]?.body === 'new', JSON.stringify(own.error ?? own.data));
  const upsert = await service.getPrivilegedClient('smoke: upsert').from('notes').upsert({ id: 1, owner: A, body: 'mine' }, { onConflict: 'id' }).select('id');
  check('upsert with onConflict works (22 call sites use it)', !upsert.error, upsert.error?.message);
  const counted = await as(A).from('notes').select('*', { count: 'exact', head: true });
  check('count: exact works (62 call sites use it)', !counted.error && counted.count === 2, JSON.stringify(counted.error ?? counted.count));
  const single = await as(B).from('notes').select('body').maybeSingle();
  check('.maybeSingle() works (432 call sites use .single()/.maybeSingle())', !single.error && single.data?.body === 'theirs', JSON.stringify(single.error ?? single.data));

  const wrong = await service.getClient(forge({ sub: A, role: 'service_role', exp: Math.floor(Date.now() / 1000) + 300 }, 'z'.repeat(40))).from('notes').select('body');
  check('a token signed with another secret is rejected', !!wrong.error, wrong.error?.message);
  const expired = await service.getClient(forge({ sub: A, role: 'authenticated', exp: Math.floor(Date.now() / 1000) - 3600 }, SECRET)).from('notes').select('body');
  check('an expired token is rejected', !!expired.error, expired.error?.message);
  const raised = await service.getClient(forge({ sub: A, role: 'postgres', exp: Math.floor(Date.now() / 1000) + 300 }, SECRET)).from('notes').select('body');
  check('a role the backend never mints cannot be reached, even with the right secret', !!raised.error, raised.error?.message);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
