import { createHash } from 'node:crypto';

import { CadUploadsService } from './cad-uploads.service';

import type { CadUploadRow } from './cad-upload.types';

const BYTES = Buffer.from('ISO-10303-21; a part');
const SHA = createHash('sha256').update(BYTES).digest('hex');
const input = { fileName: 'part.step', bytes: BYTES, bomId: 'bom-1', userId: 'user-1', organizationId: 'org-1', token: 't' };

const stored = (over: Partial<CadUploadRow> = {}): CadUploadRow => ({
  id: 'up-1', organization_id: 'org-1', created_by: 'user-1', bom_id: 'bom-1', project_id: 'proj-1', file_name: 'part.step', sha256: SHA,
  size_bytes: BYTES.length, storage_path: `cad-uploads/org-1/${SHA}.step`, status: 'queued', attempts: 0, materialize_attempts: 0, error_code: null, error_detail: null,
  result: null, created_item_ids: [], created_at: '', started_at: null, finished_at: null, source_deleted_at: null, ...over,
});

/** A fake service-role client that remembers what was stored, inserted and updated. `existing` is the row already in the table. */
function setup(existing: CadUploadRow | null, options: { raceOnInsert?: boolean; liveItems?: string[] } = {}) {
  let row: CadUploadRow | null = existing;
  const calls = { storage: [] as string[], inserts: 0, updates: [] as Record<string, unknown>[] };
  const table = {
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    insert: (values: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          calls.inserts += 1;
          if (options.raceOnInsert) {
            row = stored({ status: 'queued' }); // the same upload won the race
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          row = stored(values as Partial<CadUploadRow>);
          return { data: row, error: null };
        },
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: () => ({
        select: () => ({
          single: async () => {
            calls.updates.push(patch);
            row = { ...(row as CadUploadRow), ...(patch as Partial<CadUploadRow>) };
            return { data: row, error: null };
          },
        }),
      }),
    }),
  };
  // bom_items: which of the asked ids still exist
  const items = { select: () => ({ in: (_column: string, ids: string[]) => ({ limit: async () => ({ data: ids.filter((id) => (options.liveItems ?? []).includes(id)).slice(0, 1).map((id) => ({ id })), error: null }) }) }) };
  const admin = {
    from: (name: string) => (name === 'bom_items' ? items : table),
  };
  const objects = { put: async (_bucket: string, path: string) => { calls.storage.push(path); } };
  const bomItems = { getProjectIdForBOM: jest.fn(async () => 'proj-1') };
  const runner = { wake: jest.fn() };
  const audit = { recordBestEffort: jest.fn(async () => undefined) };
  const service = new CadUploadsService({ getPrivilegedClient: () => admin } as never, bomItems as never, runner as never, audit as never, objects as never);
  return { service, calls, bomItems, runner, audit };
}

describe('CadUploadsService.create', () => {
  it('stores a new file once, queues it, and wakes the runner', async () => {
    const { service, calls, runner } = setup(null);
    const { upload, duplicate } = await service.create(input);
    expect(duplicate).toBe(false);
    expect(calls.storage).toEqual([`cad-uploads/org-1/${SHA}.step`]);
    expect(calls.inserts).toBe(1);
    expect(upload.status).toBe('queued');
    expect(runner.wake).toHaveBeenCalledTimes(1);
  });

  it('records a new upload in the audit trail (name and size only), and a repeat of one already on record adds nothing', async () => {
    const fresh = setup(null);
    await fresh.service.create(input);
    expect(fresh.audit.recordBestEffort).toHaveBeenCalledWith({
      action: 'upload.created', targetType: 'cad_upload', targetId: 'up-1', organizationId: 'org-1', meta: { fileName: 'part.step', sizeBytes: BYTES.length },
    });
    const repeat = setup(stored({ status: 'done', created_item_ids: ['i1'] }), { liveItems: ['i1'] });
    await repeat.service.create(input);
    expect(repeat.audit.recordBestEffort).not.toHaveBeenCalled();
  });

  it.each(['queued', 'running', 'done'] as const)('answers the same bytes with the existing %s upload and touches neither storage nor the table', async (status) => {
    // a finished upload still has what it created in the BOM
    const { service, calls, runner } = setup(stored({ status, created_item_ids: ['i1'] }), { liveItems: ['i1'] });
    const { upload, duplicate } = await service.create(input);
    expect(duplicate).toBe(true);
    expect(upload.id).toBe('up-1');
    expect(calls).toEqual({ storage: [], inserts: 0, updates: [] }); // a repeat costs nothing (it used to re-upload the whole file)
    expect(runner.wake).not.toHaveBeenCalled();
  });

  it('retries a failed upload whose original is still stored without sending the bytes again', async () => {
    const { service, calls, runner } = setup(stored({ status: 'failed', error_code: 'no_solids' }));
    const { upload, duplicate } = await service.create(input);
    expect(duplicate).toBe(false);
    expect(calls.storage).toEqual([]);
    expect(calls.updates).toEqual([expect.objectContaining({ status: 'queued', attempts: 0, error_code: null, source_deleted_at: null })]);
    expect(upload.status).toBe('queued');
    expect(runner.wake).toHaveBeenCalled();
  });

  it('stores the file again when a failed upload had its original removed, then retries it', async () => {
    const { service, calls } = setup(stored({ status: 'failed', source_deleted_at: '2026-10-01T00:00:00Z' }));
    await service.create(input);
    expect(calls.storage).toEqual([`cad-uploads/org-1/${SHA}.step`]);
    expect(calls.updates[0]).toMatchObject({ status: 'queued', source_deleted_at: null });
  });

  it('returns the earlier result when the upload finished and its items are still in the BOM', async () => {
    const { service, calls } = setup(stored({ status: 'done', created_item_ids: ['i1', 'i2'], source_deleted_at: '2026-11-05T00:00:00Z' }), { liveItems: ['i2'] });
    const { duplicate } = await service.create(input);
    expect(duplicate).toBe(true);
    expect(calls.storage).toEqual([]);
    expect(calls.updates).toEqual([]);
  });

  it('imports the same file again when the upload finished but every item it created has been deleted', async () => {
    const { service, calls, runner } = setup(stored({ status: 'done', created_item_ids: ['i1', 'i2'], materialize_attempts: 1, source_deleted_at: '2026-11-05T00:00:00Z' }), { liveItems: [] });
    const { upload, duplicate } = await service.create(input);
    expect(duplicate).toBe(false);
    expect(calls.storage).toEqual([`cad-uploads/org-1/${SHA}.step`]); // its original was removed after the first import
    expect(calls.updates).toEqual([expect.objectContaining({ status: 'queued', attempts: 0, materialize_attempts: 0, source_deleted_at: null })]);
    expect(upload.status).toBe('queued');
    expect(runner.wake).toHaveBeenCalled();
  });

  it('does not import a file again while its upload is still being processed', async () => {
    for (const status of ['queued', 'running', 'analysed', 'materializing'] as const) {
      const { service, calls } = setup(stored({ status }));
      expect((await service.create(input)).duplicate).toBe(true);
      expect(calls.updates).toEqual([]);
    }
  });

  it('looks for surviving items in batches, so a large upload does not make a request line too long', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `item-${i}`);
    const { service } = setup(stored({ status: 'done', created_item_ids: ids }), { liveItems: ['item-449'] });
    expect((await service.create(input)).duplicate).toBe(true); // found in the last batch
  });

  it('treats losing a race with an identical upload as a duplicate, not an error', async () => {
    const { service } = setup(null, { raceOnInsert: true });
    const { upload, duplicate } = await service.create(input);
    expect(duplicate).toBe(true);
    expect(upload.id).toBe('up-1');
  });

  it('refuses a bad file before anything is read or stored', async () => {
    const { service, calls, bomItems } = setup(null);
    await expect(service.create({ ...input, fileName: 'Gearbox.SLDASM' })).rejects.toMatchObject({ response: { code: 'native_cad_not_supported' } });
    expect(bomItems.getProjectIdForBOM).not.toHaveBeenCalled();
    expect(calls.storage).toEqual([]);
  });

  it('stores nothing for a BOM the user cannot see', async () => {
    const { service, calls, bomItems } = setup(null);
    bomItems.getProjectIdForBOM.mockRejectedValueOnce(new Error('not found'));
    await expect(service.create(input)).rejects.toThrow('not found');
    expect(calls).toEqual({ storage: [], inserts: 0, updates: [] });
  });
});
