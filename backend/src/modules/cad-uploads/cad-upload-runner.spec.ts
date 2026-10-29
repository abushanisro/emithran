import { zip } from '../../common/archive/test-zip';
import { cadEngineHttp } from '../../common/resilience/engine-http';
import { CadUploadRunner } from './cad-upload-runner';

import type { AssemblyReport } from './assembly-report';
import type { CadUploadRow } from './cad-upload.types';

const STEP = Buffer.from('ISO-10303-21;');

const report = (): AssemblyReport => ({
  schema_version: 1, units: 'mm', status: 'complete', inputs: [{ file: 'gear.step', status: 'ok', inside: null }], problems: [],
  parts: [{ id: '0:1', name: 'Gear', file: 'gear.step', quantity_total: 1, volume_mm3: 1000, surface_area_mm2: 600, bounding_box: { length: 20, width: 10, height: 5, diagonal: 23 } }],
  assembly: [{ definition: '0:1', name: 'Gear', kind: 'part', quantity: 1, file: 'gear.step', children: [] }],
});

const asmReport = (): AssemblyReport => ({
  ...report(),
  assembly: [{ definition: '0:1', name: 'Top', kind: 'assembly', quantity: 1, file: 'gear.step', children: [
    { definition: '0:2', name: 'Box', kind: 'part', quantity: 2, file: 'gear.step', children: [] },
    { definition: '0:3', name: 'Cyl', kind: 'part', quantity: 1, file: 'gear.step', children: [] },
  ] }],
});

const row = (over: Partial<CadUploadRow> = {}): CadUploadRow => ({
  id: 'aaaaaa-1', organization_id: 'org', created_by: 'user', bom_id: 'bom', project_id: 'proj', file_name: 'gear.step', sha256: 'h',
  size_bytes: 13, storage_path: 'cad-uploads/org/h.step', status: 'running', attempts: 1, materialize_attempts: 0, error_code: null, error_detail: null,
  result: null, created_item_ids: [], created_at: '', started_at: '', finished_at: null, source_deleted_at: null, ...over,
});

/** `expired` are the failed uploads the hourly sweep will find. */
function setup(claimed: CadUploadRow | null, expired: { id: string; storage_path: string }[] = []) {
  const updates: Record<string, unknown>[] = [];
  const removed: string[][] = [];
  let claims = 0;
  let rpcCalls = 0;
  const rpcNames: string[] = [];
  const downloads: string[] = [];
  const sweep: any = { eq: () => sweep, is: () => sweep, lt: () => sweep, limit: async () => ({ data: expired, error: null }) };
  const admin = {
    rpc: async (name: string) => {
      rpcNames.push(name);
      rpcCalls += 1;
      return { data: claimed && claims++ === 0 ? [claimed] : [], error: null };
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null }; } }),
      select: () => sweep,
    }),
  };
  const objects = {
    get: async (_bucket: string, path: string) => { downloads.push(path); return Buffer.from(STEP); },
    remove: async (_bucket: string, paths: string[]) => { removed.push(paths); },
  };
  let next = 0;
  const bomItems = {
    createForUpload: jest.fn(async () => ({ id: `item-${++next}` })),
    deleteItemsForUpload: jest.fn(async (_ids: string[]): Promise<string[]> => []),
    setFile3dPathForUpload: jest.fn(async () => undefined),
  };
  const files = { uploadFile: jest.fn(async () => ({ storagePath: 'bom/path.step' })), removeUnreferencedFiles: jest.fn(async (_paths: string[]) => 0) };
  const audit = { recordBestEffort: jest.fn(async () => undefined) };
  const runner = new CadUploadRunner({ getPrivilegedClient: () => admin } as never, bomItems as never, files as never, audit as never, objects as never);
  return { runner, updates, removed, bomItems, files, audit, rpcCalls: () => rpcCalls, rpcNames, downloads };
}

/** What the engine really does: the report names each file as it arrived, so a fake that answers with plain names must follow suit. */
const asArrived = (data: AssemblyReport): AssemblyReport => JSON.parse(JSON.stringify(data).replace(/gear\.step/g, '0000_gear.step'));
const engineAnswers = (data: unknown, partsZip?: Buffer) =>
  jest.spyOn(cadEngineHttp, 'post').mockImplementation((async (url: string) => ({ data: url.endsWith('/assembly/parts') ? partsZip : asArrived(data as AssemblyReport) })) as never);
const partsZip = () => zip([{ name: '0_2.step', data: 'ISO-10303-21; box' }, { name: '0_3.step', data: 'ISO-10303-21; cyl' }]);
const engineFails = (status: number | undefined, detail?: string) =>
  jest.spyOn(cadEngineHttp, 'post').mockRejectedValue(Object.assign(new Error('engine'), status ? { response: { status, data: { detail } } } : {}));
/** The last status change; the cleanup that follows it (marking the original removed) is not one. */
const last = (updates: Record<string, unknown>[]) => [...updates].reverse().find((u) => 'status' in u)!;

afterEach(() => jest.restoreAllMocks());

describe('CadUploadRunner', () => {
  it('creates the tree parents first, attaches a single-part file, and records the result', async () => {
    engineAnswers(report());
    const { runner, updates, bomItems, files } = setup(row());
    await runner.tick();
    expect(bomItems.createForUpload).toHaveBeenCalledTimes(1);
    const [dto] = (bomItems.createForUpload.mock.calls as unknown as [Record<string, unknown>][])[0]!;
    expect(dto).toMatchObject({ volume: 1000, surfaceArea: 600, maxLength: 20 });
    expect(files.uploadFile).toHaveBeenCalledTimes(1);
    expect(bomItems.setFile3dPathForUpload).toHaveBeenCalledWith('item-1', 'bom/path.step');
    expect(last(updates)).toMatchObject({ status: 'done', result: { report: report(), skipped: [] } });
  });

  it('links children to their parent and gives parts that exist only inside the assembly file their own exported STEP', async () => {
    const post = engineAnswers(asmReport(), partsZip());
    const { runner, bomItems, files } = setup(row());
    await runner.tick();
    const dtos = (bomItems.createForUpload.mock.calls as unknown as [Record<string, unknown>][]).map(([d]) => d);
    expect(dtos.map((d) => [d.name, d.parentItemId, d.quantity])).toEqual([['Top', undefined, 1], ['Box', 'item-1', 2], ['Cyl', 'item-1', 1]]);
    const exportCall = post.mock.calls.find(([url]) => String(url).endsWith('/assembly/parts'))!;
    expect(JSON.parse((exportCall[1] as { _streams: unknown[] })._streams.map(String).join('').match(/\[".*?\]/)![0])).toEqual(['0:2', '0:3']);
    const uploaded = (files.uploadFile.mock.calls as unknown as [{ originalname: string; buffer: Buffer }, string, string, string, string][]).map(([f, , , , item]) => [f.originalname, f.buffer.toString(), item]);
    expect(uploaded).toEqual([['Box.step', 'ISO-10303-21; box', 'item-2'], ['Cyl.step', 'ISO-10303-21; cyl', 'item-3']]);
    expect(bomItems.setFile3dPathForUpload).toHaveBeenCalledTimes(2);
  });

  it('sends every file under a unique name and maps the engine\'s answer back to the original paths, so same-named files in different folders do not collide', async () => {
    const post = engineAnswers(report());
    const { runner, updates } = setup(row());
    await runner.tick();
    const form = post.mock.calls[0]![1] as { _streams: unknown[] };
    expect(form._streams.map(String).join('')).toContain('filename="0000_gear.step"');
    expect(last(updates)).toMatchObject({ result: { report: { assembly: [{ file: 'gear.step' }], parts: [{ file: 'gear.step' }] } } });
  });

  it('does not ask the engine to export anything when every part already has its own file', async () => {
    const post = engineAnswers(report());
    const { runner } = setup(row());
    await runner.tick();
    expect(post.mock.calls.map(([url]) => String(url).split('/').slice(-2).join('/'))).toEqual(['analyze/assembly']);
  });

  it('fails the upload with the engine\'s own words when it refuses the part export', async () => {
    jest.spyOn(cadEngineHttp, 'post').mockImplementation((async (url: string) => {
      if (!url.endsWith('/assembly/parts')) return { data: asmReport() };
      throw Object.assign(new Error('400'), { response: { status: 400, data: Buffer.from(JSON.stringify({ detail: 'No such part in the uploaded files: 0:2' })) } });
    }) as never);
    const { runner, updates } = setup(row());
    await runner.tick();
    expect(last(updates)).toMatchObject({ status: 'failed', error_code: 'engine_rejected', error_detail: 'No such part in the uploaded files: 0:2' });
  });

  it('removes everything it created and requeues when item creation fails midway', async () => {
    engineAnswers(asmReport(), partsZip());
    const { runner, updates, bomItems } = setup(row());
    bomItems.createForUpload.mockResolvedValueOnce({ id: 'item-1' } as never).mockRejectedValueOnce(new Error('db down'));
    await runner.tick();
    expect(bomItems.deleteItemsForUpload).toHaveBeenCalledWith(['item-1']);
    expect(updates).toContainEqual({ created_item_ids: [] });
    expect(last(updates)).toMatchObject({ status: 'queued', error_detail: 'db down' });
  });

  it('removes what an earlier attempt created before it starts again', async () => {
    engineAnswers(report());
    const { runner, bomItems } = setup(row({ attempts: 2, created_item_ids: ['old-1', 'old-2'] }));
    await runner.tick();
    expect(bomItems.deleteItemsForUpload).toHaveBeenCalledWith(['old-1', 'old-2']);
  });

  it('removes the stored 3D files nothing references any more, and a storage failure does not stop the upload', async () => {
    engineAnswers(report());
    const { runner, bomItems, files, updates } = setup(row({ attempts: 2, created_item_ids: ['old-1', 'old-2'] }));
    bomItems.deleteItemsForUpload.mockResolvedValue(['bom/old-1.step', 'bom/old-2.step']);
    files.removeUnreferencedFiles.mockRejectedValueOnce(new Error('storage down'));
    await runner.tick();
    expect(files.removeUnreferencedFiles).toHaveBeenCalledWith(['bom/old-1.step', 'bom/old-2.step']);
    expect(last(updates)).toMatchObject({ status: 'done' });
  });

  it('records a finished upload in the audit trail, as the system, for the uploader\'s organization', async () => {
    engineAnswers(report());
    const { runner, audit } = setup(row());
    await runner.tick();
    expect(audit.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(audit.recordBestEffort).toHaveBeenCalledWith({
      action: 'upload.completed', targetType: 'cad_upload', targetId: 'aaaaaa-1', organizationId: 'org', actor: { kind: 'system' },
      meta: { fileName: 'gear.step', parts: 1, items: 1, durationMs: expect.any(Number) },
    });
  });

  it('records a final failure with its code, but not a failure that will be retried', async () => {
    engineFails(400, 'no good');
    const failed = setup(row());
    await failed.runner.tick();
    expect(failed.audit.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({
      action: 'upload.failed', outcome: 'error', organizationId: 'org', actor: { kind: 'system' }, meta: { fileName: 'gear.step', errorCode: 'engine_rejected' },
    }));

    engineFails(undefined); // the engine is down: attempt 1 of 3 is requeued, not failed
    const retried = setup(row({ attempts: 1 }));
    await retried.runner.tick();
    expect(retried.audit.recordBestEffort).not.toHaveBeenCalled();
  });

  it('removes the stored original once the upload is done, and records that it is gone', async () => {
    engineAnswers(report());
    const { runner, updates, removed } = setup(row());
    await runner.tick();
    expect(removed).toEqual([['cad-uploads/org/h.step']]);
    expect(updates.some((u) => typeof u.source_deleted_at === 'string')).toBe(true);
  });

  it('keeps the original of a failed upload, so a re-upload can retry without sending the bytes again', async () => {
    engineFails(400, 'no good');
    const { runner, removed } = setup(row());
    await runner.tick();
    expect(removed).toEqual([]);
  });

  it('refuses to process an upload whose original was already removed, and says to upload it again', async () => {
    engineAnswers(report());
    const { runner, updates } = setup(row({ source_deleted_at: '2026-10-01T00:00:00Z' }));
    await runner.tick();
    expect(last(updates)).toMatchObject({ status: 'failed', error_code: 'source_expired', error_detail: expect.stringContaining('Upload the file again') });
  });

  it('once an hour removes the originals of uploads that failed and were never retried', async () => {
    const { runner, removed, updates } = setup(null, [{ id: 'old-1', storage_path: 'cad-uploads/org/old.zip' }]);
    await runner.tick();
    expect(removed).toEqual([['cad-uploads/org/old.zip']]);
    expect(updates).toContainEqual({ source_deleted_at: expect.any(String) });
    await runner.tick(); // the hour has not passed: no second sweep
    expect(removed).toHaveLength(1);
  });

  it('stores a part that appears under several parents once, and points every node at that one file', async () => {
    const twice = asmReport();
    const sub = (n: string) => ({ definition: `0:${n}`, name: `Sub${n}`, kind: 'assembly' as const, quantity: 1, file: 'gear.step', children: [
      { definition: '0:9', name: 'Bolt', kind: 'part' as const, quantity: 4, file: 'gear.step', children: [] },
    ] });
    twice.assembly = [{ definition: '0:1', name: 'Top', kind: 'assembly', quantity: 1, file: 'gear.step', children: [sub('2'), sub('3')] }];
    engineAnswers(twice, zip([{ name: '0_9.step', data: 'ISO-10303-21; bolt' }]));
    const { runner, bomItems, files } = setup(row());
    await runner.tick();
    expect(files.uploadFile).toHaveBeenCalledTimes(1); // two Bolt nodes, one stored object
    expect((bomItems.setFile3dPathForUpload.mock.calls as unknown as [string, string][]).map(([, path]) => path)).toEqual(['bom/path.step', 'bom/path.step']);
  });

  it('starts at once when woken, and a wake that arrives during a run is not lost', async () => {
    engineAnswers(report());
    const { runner, rpcCalls } = setup(row());
    runner.wake();
    runner.wake(); // arrives while the first is still working
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rpcCalls()).toBeGreaterThanOrEqual(3); // claimed the row, found none, and looked again for the late wake
  });

  it('does not retry an upload the engine refused, and says why', async () => {
    engineFails(400, 'gear.step: only STEP files are supported');
    const { runner, updates } = setup(row());
    await runner.tick();
    expect(last(updates)).toMatchObject({ status: 'failed', error_code: 'engine_rejected', error_detail: expect.stringContaining('only STEP') });
  });

  it('retries an engine answer that means this runner is misconfigured (403, 404), instead of failing the upload for good', async () => {
    for (const status of [403, 404]) {
      engineFails(status);
      const { runner, updates } = setup(row({ attempts: 1 }));
      await runner.tick();
      expect(last(updates)).toMatchObject({ status: 'queued' });
    }
  });

  it('retries when the engine is busy or down, until the attempts run out', async () => {
    engineFails(429);
    const first = setup(row({ attempts: 1 }));
    await first.runner.tick();
    expect(last(first.updates)).toMatchObject({ status: 'queued' });

    engineFails(undefined);
    const exhausted = setup(row({ attempts: 3 }));
    await exhausted.runner.tick();
    expect(last(exhausted.updates)).toMatchObject({ status: 'failed', error_code: 'processing_failed' });
  });

  it('fails an engine answer that breaks the contract without retrying it', async () => {
    engineAnswers({ schema_version: 2 });
    const { runner, updates } = setup(row());
    await runner.tick();
    expect(last(updates)).toMatchObject({ status: 'failed', error_code: 'invalid_engine_result' });
  });

  it('fails an unreadable zip at once with the archive code', async () => {
    const { runner, updates } = setup(row({ file_name: 'pack.zip' }));
    await runner.tick();
    expect(last(updates)).toMatchObject({ status: 'failed', error_code: 'archive_unreadable' });
  });

  it('reports a result with no readable part as failed', async () => {
    engineAnswers({ ...report(), status: 'partial', assembly: [], inputs: [{ file: 'gear.step', status: 'unreadable', inside: null }] });
    const { runner, updates } = setup(row());
    await runner.tick();
    expect(last(updates)).toMatchObject({ status: 'failed', error_code: 'no_solids' });
  });
});

describe('CadUploadRunner with CAD_CORE=rust (the Rust core analysed the upload; this only creates the BOM items)', () => {
  const analysed = (over: Partial<CadUploadRow> = {}) =>
    row({ status: 'materializing', result: { report: asmReport(), skipped: [{ path: 'notes.txt', reason: 'not a STEP file' }] }, materialize_attempts: 1, ...over });

  beforeEach(() => {
    process.env.CAD_CORE = 'rust';
  });
  afterEach(() => {
    delete process.env.CAD_CORE;
  });

  it('claims analysed uploads, never calls the engine, builds the tree from the stored report and the stored part files', async () => {
    const post = jest.spyOn(cadEngineHttp, 'post');
    const { runner, updates, bomItems, files, rpcNames, downloads, removed } = setup(analysed());
    await runner.tick();
    expect(rpcNames[0]).toBe('claim_next_analysed_upload');
    expect(post).not.toHaveBeenCalled();
    const dtos = (bomItems.createForUpload.mock.calls as unknown as [Record<string, unknown>][]).map(([d]) => d);
    expect(dtos.map((d) => [d.name, d.parentItemId, d.quantity])).toEqual([['Top', undefined, 1], ['Box', 'item-1', 2], ['Cyl', 'item-1', 1]]);
    expect(downloads.filter((p) => p.includes('/parts/'))).toEqual(['cad-uploads/org/aaaaaa-1/parts/0_2.step', 'cad-uploads/org/aaaaaa-1/parts/0_3.step']);
    expect(files.uploadFile).toHaveBeenCalledTimes(2);
    expect(bomItems.setFile3dPathForUpload).toHaveBeenCalledTimes(2);
    expect(last(updates)).toMatchObject({ status: 'done' });
    // the work copies of the parts and then the original are removed
    expect(removed[0]).toEqual(['cad-uploads/org/aaaaaa-1/parts/0_2.step', 'cad-uploads/org/aaaaaa-1/parts/0_3.step']);
    expect(removed[1]).toEqual(['cad-uploads/org/h.step']);
  });

  it('attaches a single-part upload\'s stored file to its item', async () => {
    const { runner, bomItems, files } = setup(analysed({ result: { report: report(), skipped: [] } }));
    await runner.tick();
    expect(bomItems.createForUpload).toHaveBeenCalledTimes(1);
    const [file] = (files.uploadFile.mock.calls as unknown as [{ originalname: string; buffer: Buffer }][])[0]!;
    expect([file.originalname, file.buffer.toString()]).toEqual(['gear.step', STEP.toString()]);
  });

  it('fails for good when the stored result is outside the contract (a core bug, not a bad upload)', async () => {
    const { runner, updates, bomItems } = setup(analysed({ result: { report: { hello: 1 } } }));
    await runner.tick();
    expect(bomItems.createForUpload).not.toHaveBeenCalled();
    expect(last(updates)).toMatchObject({ status: 'failed', error_code: 'invalid_engine_result' });
  });

  it('puts a failed attempt back to analysed (not queued: the analysis is not repeated) until the attempts are used', async () => {
    const failing = () => {
      const made = setup(analysed({ materialize_attempts: 1 }));
      made.bomItems.createForUpload.mockRejectedValue(new Error('database down'));
      return made;
    };
    const first = failing();
    await first.runner.tick();
    expect(last(first.updates)).toMatchObject({ status: 'analysed' });

    const exhausted = setup(analysed({ materialize_attempts: 3 }));
    exhausted.bomItems.createForUpload.mockRejectedValue(new Error('database down'));
    await exhausted.runner.tick();
    expect(last(exhausted.updates)).toMatchObject({ status: 'failed', error_code: 'processing_failed' });
  });
});
