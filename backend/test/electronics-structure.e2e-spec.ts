// Electronics structure over HTTP, real app, real auth, real database: assemblies and sub-assemblies created by hand, the rules
// that keep the tree well formed, delete of a subtree, and isolation between organizations. No files are uploaded: an assembly
// holds none, so nothing sample-like is needed. Needs migrations 914 to 916 and both test accounts in .env
// (E2E_EMAIL / E2E_PASSWORD, E2E_EMAIL_B / E2E_PASSWORD_B, the second in another organization).
process.env.ELECTRONICS_QUEUE_DRIVER ??= 'memory';

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { CustomValidationPipe } from '../src/common/pipes/validation.pipe';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { RequestAuthInterceptor } from '../src/common/interceptors/request-auth.interceptor';

jest.setTimeout(180_000);

interface Design {
  id: string;
  name: string;
  itemType: string;
  parentId: string | null;
  kind: string;
}

describe('[e2e] electronics assemblies, sub-assemblies and delete', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let projectId: string;
  const api = () => request(app.getHttpServer());
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new CustomValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor(), new RequestAuthInterceptor());
    await app.init();

    const config = app.get(ConfigService);
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env'), 'utf8'));
    if (!env.E2E_EMAIL || !env.E2E_PASSWORD || !env.E2E_EMAIL_B || !env.E2E_PASSWORD_B) {
      throw new Error('Add E2E_EMAIL / E2E_PASSWORD and E2E_EMAIL_B / E2E_PASSWORD_B to .env');
    }
    const anon = createClient(config.getOrThrow<string>('SUPABASE_URL'), config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    const signIn = async (email: string, password: string) => {
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
      return data.session.access_token;
    };
    tokenA = await signIn(env.E2E_EMAIL, env.E2E_PASSWORD);
    tokenB = await signIn(env.E2E_EMAIL_B, env.E2E_PASSWORD_B);

    const project = await api().post('/v1/api/projects').set(as(tokenA)).send({ name: `e2e electronics structure ${Date.now()}` });
    expect(project.status).toBe(201);
    projectId = project.body.data.id;
  });

  afterAll(async () => {
    // Anything a failed test left behind goes with the project's designs, then the project.
    const designs = await api().get(`/v1/api/electronics/designs?projectId=${projectId}`).set(as(tokenA));
    for (const d of (designs.body.data ?? []) as Design[]) {
      if (!d.parentId) await api().delete(`/v1/api/electronics/designs/${d.id}`).set(as(tokenA));
    }
    await api().delete(`/v1/api/projects/${projectId}`).set(as(tokenA));
    await app.close();
  });

  const create = (token: string, body: Record<string, unknown>) => api().post('/v1/api/electronics/designs').set(as(token)).send(body);
  const list = async (): Promise<Design[]> => (await api().get(`/v1/api/electronics/designs?projectId=${projectId}`).set(as(tokenA))).body.data;

  it('creates an assembly, a sub-assembly inside it, and another inside that, as containers', async () => {
    const asm = await create(tokenA, { itemType: 'assembly', name: 'Main unit', projectId });
    expect(asm.status).toBe(201);
    expect(asm.body.data).toMatchObject({ name: 'Main unit', itemType: 'assembly', kind: 'assembly', parentId: null, projectId, revisions: [] });

    const sub = await create(tokenA, { itemType: 'sub_assembly', name: 'Control module', parentDesignId: asm.body.data.id });
    expect(sub.status).toBe(201);
    expect(sub.body.data).toMatchObject({ itemType: 'sub_assembly', parentId: asm.body.data.id, projectId });

    const nested = await create(tokenA, { itemType: 'sub_assembly', name: 'Power stage', parentDesignId: sub.body.data.id });
    expect(nested.status).toBe(201);

    const names = (await list()).map((d) => [d.name, d.itemType, d.parentId]);
    expect(names).toEqual(
      expect.arrayContaining([
        ['Main unit', 'assembly', null],
        ['Control module', 'sub_assembly', asm.body.data.id],
        ['Power stage', 'sub_assembly', sub.body.data.id],
      ]),
    );
  });

  it('keeps the tree well formed: no nested assembly, no orphan sub-assembly, no duplicate name, no empty name', async () => {
    const asm = (await list()).find((d) => d.name === 'Main unit') as Design;
    expect((await create(tokenA, { itemType: 'assembly', name: 'Inner', parentDesignId: asm.id })).status).toBe(400);
    expect((await create(tokenA, { itemType: 'sub_assembly', name: 'Loose' })).status).toBe(400);
    expect((await create(tokenA, { itemType: 'sub_assembly', name: 'Control module', parentDesignId: asm.id })).status).toBe(409);
    expect((await create(tokenA, { itemType: 'assembly', name: '   ', projectId })).status).toBe(400);
    expect((await create(tokenA, { itemType: 'child_part', name: 'Board', projectId })).status).toBe(400);
  });

  it('refuses another organization: it cannot see, add to, or delete these designs', async () => {
    const asm = (await list()).find((d) => d.name === 'Main unit') as Design;
    expect((await api().get(`/v1/api/electronics/designs/${asm.id}`).set(as(tokenB))).status).toBe(404);
    expect((await create(tokenB, { itemType: 'sub_assembly', name: 'Intruder', parentDesignId: asm.id })).status).toBe(404);
    expect((await create(tokenB, { itemType: 'assembly', name: 'Intruder', projectId })).status).toBe(404);
    expect((await api().delete(`/v1/api/electronics/designs/${asm.id}`).set(as(tokenB))).status).toBe(404);
    expect((await list()).some((d) => d.id === asm.id)).toBe(true);
  });

  it('deletes a sub-assembly with everything below it, and leaves the rest', async () => {
    const before = await list();
    const sub = before.find((d) => d.name === 'Control module') as Design;
    const res = await api().delete(`/v1/api/electronics/designs/${sub.id}`).set(as(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ designs: 2, revisions: 0, files: 0, fileRemovalFailed: false });
    const after = (await list()).map((d) => d.name);
    expect(after).toContain('Main unit');
    expect(after).not.toContain('Control module');
    expect(after).not.toContain('Power stage');
  });

  it('answers 404 for a design that does not exist and 400 for a malformed id', async () => {
    expect((await api().delete('/v1/api/electronics/designs/00000000-0000-4000-8000-000000000000').set(as(tokenA))).status).toBe(404);
    expect((await api().delete('/v1/api/electronics/designs/not-a-uuid').set(as(tokenA))).status).toBe(400);
  });
});
