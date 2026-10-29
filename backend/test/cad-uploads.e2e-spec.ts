// ZIP / STEP assembly upload over HTTP: real app, real auth, real database and storage, and a real cad-engine. Needs
// migration 917, both test accounts in .env.local (E2E_EMAIL / E2E_PASSWORD, E2E_EMAIL_B / E2E_PASSWORD_B, the second in
// another organization) and the engine running at CAD_ENGINE_URL with the same CAD_ENGINE_API_KEY and
// MAX_FILE_SIZE_MB >= 1 (cd cad-engine && python main.py; it listens on 5055). The files are small real STEP files made with OpenCascade
// (test/fixtures/cad).
process.env.ELECTRONICS_QUEUE_DRIVER ??= 'memory';

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { parseEnv } from 'util';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { zip } from '../src/common/archive/test-zip';
import { DEFAULT_CAD_ENGINE_URL } from '../src/common/engine-urls';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { CustomValidationPipe } from '../src/common/pipes/validation.pipe';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { RequestAuthInterceptor } from '../src/common/interceptors/request-auth.interceptor';

jest.setTimeout(240_000);

const fixture = (name: string) => fs.readFileSync(path.resolve(__dirname, 'fixtures/cad', name));

interface Item {
  id: string;
  name: string;
  itemType: string;
  parentItemId?: string | null;
  quantity: number;
  volume?: number | null;
  file3dPath?: string | null;
}

describe('[e2e] CAD upload: zip / STEP assembly to BOM items', () => {
  let app: INestApplication;
  let admin: SupabaseClient;
  let tokenA: string;
  let tokenB: string;
  let projectId: string;
  let bomId: string;
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
    const env = parseEnv(fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8'));
    if (!env.E2E_EMAIL || !env.E2E_PASSWORD || !env.E2E_EMAIL_B || !env.E2E_PASSWORD_B) {
      throw new Error('Add E2E_EMAIL / E2E_PASSWORD and E2E_EMAIL_B / E2E_PASSWORD_B to .env.local');
    }
    const url = config.getOrThrow<string>('SUPABASE_URL');
    const anon = createClient(url, config.getOrThrow<string>('SUPABASE_ANON_KEY'));
    admin = createClient(url, config.getOrThrow<string>('SUPABASE_SERVICE_KEY'));
    const signIn = async (email: string, password: string) => {
      const { data, error } = await anon.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
      return data.session.access_token;
    };
    tokenA = await signIn(env.E2E_EMAIL, env.E2E_PASSWORD);
    tokenB = await signIn(env.E2E_EMAIL_B, env.E2E_PASSWORD_B);

    const engine = await fetch(`${process.env.CAD_ENGINE_URL ?? DEFAULT_CAD_ENGINE_URL}/ready`).catch(() => null);
    if (!engine?.ok) throw new Error('The cad-engine is not running at CAD_ENGINE_URL (default http://localhost:5055)');

    const project = await api().post('/v1/api/projects').set(as(tokenA)).send({ name: `e2e cad upload ${Date.now()}` });
    expect(project.status).toBe(201);
    projectId = project.body.data.id;
    const bom = await api().post('/v1/api/boms').set(as(tokenA)).send({ name: 'e2e cad upload BOM', projectId });
    expect(bom.status).toBe(201);
    bomId = bom.body.data.id;
  });

  afterAll(async () => {
    // Stored files first (they are not covered by the BOM's cascade), then the BOM and project.
    const files: string[] = [];
    const uploads = await admin.from('cad_uploads').select('storage_path').eq('bom_id', bomId);
    files.push(...((uploads.data ?? []) as { storage_path: string }[]).map((u) => u.storage_path));
    const items = await admin.from('bom_items').select('file_3d_path').eq('bom_id', bomId);
    files.push(...((items.data ?? []) as { file_3d_path: string | null }[]).map((i) => i.file_3d_path).filter((p): p is string => !!p));
    if (files.length > 0) await admin.storage.from('bom-files').remove(files);
    await api().delete(`/v1/api/boms/${bomId}`).set(as(tokenA));
    await api().delete(`/v1/api/projects/${projectId}`).set(as(tokenA));
    await app.close();
  });

  const upload = (token: string, name: string, bytes: Buffer, forBom = bomId) =>
    api().post('/v1/api/cad-uploads').set(as(token)).field('bomId', forBom).attach('file', bytes, name);
  const items = async (): Promise<Item[]> => (await api().get(`/v1/api/bom-items?bomId=${bomId}&limit=200`).set(as(tokenA))).body.data.items;

  /** Polls the upload until the runner has finished with it. */
  async function settled(id: string, token = tokenA) {
    for (let i = 0; i < 100; i++) {
      const res = await api().get(`/v1/api/cad-uploads/${id}`).set(as(token));
      if (res.body.data?.status === 'done' || res.body.data?.status === 'failed') return res.body.data;
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error(`upload ${id} did not settle`);
  }

  let assemblyUploadId: string;

  it('turns an assembly STEP into a BOM tree with quantities, measurements and a 3D file for every part', async () => {
    const res = await upload(tokenA, 'nested-assembly.step', fixture('nested-assembly.step'));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'queued', fileName: 'nested-assembly.step', duplicate: false });
    assemblyUploadId = res.body.data.id;

    const done = await settled(assemblyUploadId);
    expect(done).toMatchObject({ status: 'done', errorCode: null });
    expect(done.createdItemIds).toHaveLength(5);

    // The original is not kept: the parts are stored on their own, and the free tier has 1 GB. The row and hash stay.
    const row = await admin.from('cad_uploads').select('source_deleted_at').eq('id', assemblyUploadId).single();
    expect(row.data?.source_deleted_at).toBeTruthy();

    const all = await items();
    const byName = (name: string) => all.filter((i) => i.name === name);
    const [top] = byName('Top');
    const [sub] = byName('Sub');
    expect(top).toMatchObject({ itemType: 'assembly', quantity: 1 });
    expect(top!.parentItemId ?? null).toBeNull(); // a top-level item has no parent (the field is simply absent)
    expect(sub).toMatchObject({ itemType: 'sub_assembly', quantity: 2, parentItemId: top!.id });
    const boxes = byName('Box');
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ itemType: 'child_part', quantity: 2, parentItemId: sub!.id });
    expect(Math.round(boxes[0]!.volume ?? 0)).toBe(6000);
    expect(byName('Cyl').map((c) => c.parentItemId).sort()).toEqual([sub!.id, top!.id].sort());
    for (const part of all.filter((i) => i.itemType === 'child_part')) expect(part.file3dPath).toBeTruthy();
    expect(all.filter((i) => i.itemType !== 'child_part').every((i) => !i.file3dPath)).toBe(true);

    const parts = Object.fromEntries(done.result.report.parts.map((p: { name: string; quantityTotal: number }) => [p.name, p.quantityTotal]));
    expect(parts).toEqual({ Box: 4, Cyl: 3 });
  });

  it('answers a repeat of the same bytes with the existing upload and creates nothing new', async () => {
    const before = (await items()).length;
    const again = await upload(tokenA, 'nested-assembly.step', fixture('nested-assembly.step'));
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ id: assemblyUploadId, status: 'done', duplicate: true });
    expect((await items()).length).toBe(before);
  });

  it('unpacks a zip of loose parts: one item per part, each with its own file, and skips what is not STEP', async () => {
    const pack = zip([
      { name: 'parts/plate.step', data: fixture('plate.step').toString('latin1') },
      { name: 'pin.step', data: fixture('pin.step').toString('latin1') },
      { name: 'notes.txt', data: 'not a part' },
    ]);
    const res = await upload(tokenA, 'loose-parts.zip', pack);
    expect(res.status).toBe(201);
    const done = await settled(res.body.data.id);
    expect(done).toMatchObject({ status: 'done', errorCode: null, errorDetail: null });
    expect(done.createdItemIds).toHaveLength(2);
    expect(done.result.skipped).toEqual([{ path: 'notes.txt', reason: 'not a STEP file' }]);

    const created = (await items()).filter((i) => done.createdItemIds.includes(i.id));
    expect(created.map((i) => i.name).sort()).toEqual(['Pin', 'Plate']);
    for (const item of created) {
      expect(item).toMatchObject({ itemType: 'child_part', quantity: 1 });
      expect(item.parentItemId ?? null).toBeNull();
    }
    expect(Object.fromEntries(created.map((i) => [i.name, !!i.file3dPath]))).toEqual({ Plate: true, Pin: true }); // Plate came from a subfolder
  });

  it('refuses native CAD and files whose content is not what their name says, with a code', async () => {
    const native = await upload(tokenA, 'Gearbox.SLDASM', fixture('plate.step'));
    expect(native.status).toBe(400);
    expect(JSON.stringify(native.body)).toContain('native_cad_not_supported');
    const fake = await upload(tokenA, 'part.step', Buffer.from('<html>not a step file</html>'));
    expect(fake.status).toBe(400);
    expect(JSON.stringify(fake.body)).toContain('not_a_step');
  });

  it('fails a zip that cannot be read, with a code, and creates no items', async () => {
    const before = (await items()).length;
    const broken = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64)]);
    const res = await upload(tokenA, 'broken.zip', broken);
    expect(res.status).toBe(201);
    const done = await settled(res.body.data.id);
    expect(done).toMatchObject({ status: 'failed', errorCode: 'archive_unreadable' });
    expect((await items()).length).toBe(before);
  });

  it('keeps one organization out of another: no reading its uploads, no uploading to its BOM', async () => {
    const read = await api().get(`/v1/api/cad-uploads/${assemblyUploadId}`).set(as(tokenB));
    expect(read.status).toBe(404);
    const write = await upload(tokenB, 'plate.step', fixture('plate.step'));
    expect(write.status).toBeGreaterThanOrEqual(400);
    expect((await items()).filter((i) => i.name === 'Plate')).toHaveLength(1); // only A's earlier upload
  });
});
