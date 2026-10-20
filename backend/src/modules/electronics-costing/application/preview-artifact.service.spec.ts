import { PreviewArtifactService } from './preview-artifact.service';
import { EXPECTED_RENDER_VERSION, PREVIEW_ARTIFACT_VERSION, encodeArtifact, previewInputsKey, type PreviewArtifact } from './preview-artifact';
import { ExtractionUnavailable } from '../infrastructure/ecad/ecad-engine.client';
import { previewArtifactPathFor } from '../infrastructure/storage/electronics-file-store';

import type { UploadRow } from '../infrastructure/repositories/electronics.repository';

const ORG = 'org-1';
const upload = (over: Partial<UploadRow> = {}): UploadRow =>
  ({
    id: 'up-1',
    organization_id: ORG,
    kind: 'board',
    files: [
      { name: 'a.gtl', sizeBytes: 1, sha256: 'h1', storagePath: `${ORG}/up-1/0-h1`, format: 'gerber', role: 'copper_top' },
      { name: 'a.gko', sizeBytes: 1, sha256: 'h2', storagePath: `${ORG}/up-1/1-h2`, format: 'gerber', role: 'board_outline' },
      { name: 'notes.pdf', sizeBytes: 1, sha256: 'h3', storagePath: `${ORG}/up-1/2-h3`, format: 'pdf' },
    ],
    ...over,
  }) as UploadRow;

const drawn = { bounds: { minXMm: 0, minYMm: 0, widthMm: 1, heightMm: 1 }, layers: [], components: [], componentsError: null, holes: [] };

function setup(stored: PreviewArtifact | null, engine: () => Promise<unknown>) {
  const objects = new Map<string, Buffer>();
  const store = {
    getIfExists: jest.fn(async (path: string) => objects.get(path) ?? null),
    get: jest.fn(async () => Buffer.from('file')),
    putArtifact: jest.fn(async (path: string, bytes: Buffer) => void objects.set(path, bytes)),
  };
  const client = { renderBoard: jest.fn(engine) };
  const service = new PreviewArtifactService(store as never, client as never);
  return { service, store, client, objects, seed: async () => stored && objects.set(previewArtifactPathFor(ORG, 'up-1'), await encodeArtifact(stored)) };
}

const artifactFor = (u: UploadRow, over: Partial<PreviewArtifact> = {}): PreviewArtifact => ({
  artifactVersion: PREVIEW_ARTIFACT_VERSION,
  inputsKey: previewInputsKey(PreviewArtifactService.drawnFiles(u).map((f) => f.storagePath)),
  renderVersion: EXPECTED_RENDER_VERSION,
  renderedAt: '2026-10-17T00:00:00.000Z',
  preview: drawn,
  ...over,
});

describe('PreviewArtifactService', () => {
  it('serves a stored fresh preview without calling the engine (the engine may be down)', async () => {
    const u = upload();
    const s = setup(artifactFor(u), async () => { throw new ExtractionUnavailable('down'); });
    await s.seed();
    const served = await s.service.get(u, ORG);
    expect(served.meta).toEqual({ renderedAt: '2026-10-17T00:00:00.000Z', stale: false });
    expect(s.client.renderBoard).not.toHaveBeenCalled();
  });

  it('draws and stores the first preview, then serves it from storage', async () => {
    const u = upload();
    const s = setup(null, async () => ({ ...drawn, renderVersion: EXPECTED_RENDER_VERSION }));
    await s.service.get(u, ORG);
    expect(s.store.putArtifact).toHaveBeenCalledTimes(2); // the preview and its thumbnail
    await s.service.get(u, ORG);
    expect(s.client.renderBoard).toHaveBeenCalledTimes(1);
  });

  it('re-renders when the files changed, and when the renderer is older than expected', async () => {
    const u = upload();
    for (const stale of [{ inputsKey: 'other' }, { renderVersion: '0' }]) {
      const s = setup(artifactFor(u, stale), async () => ({ ...drawn, renderVersion: EXPECTED_RENDER_VERSION }));
      await s.seed();
      expect((await s.service.get(u, ORG)).meta.stale).toBe(false);
      expect(s.client.renderBoard).toHaveBeenCalledTimes(1);
    }
  });

  it('serves the stale stored drawing, marked stale, when the engine is down', async () => {
    const u = upload();
    const s = setup(artifactFor(u, { renderVersion: '0' }), async () => { throw new ExtractionUnavailable('down'); });
    await s.seed();
    expect((await s.service.get(u, ORG)).meta.stale).toBe(true);
  });

  it('fails with the engine error when nothing is stored and the engine is down', async () => {
    const s = setup(null, async () => { throw new ExtractionUnavailable('down'); });
    await expect(s.service.get(upload(), ORG)).rejects.toBeInstanceOf(ExtractionUnavailable);
  });

  it('shares one render between concurrent requests', async () => {
    const s = setup(null, async () => { await new Promise((r) => setTimeout(r, 10)); return { ...drawn }; });
    await Promise.all([s.service.get(upload(), ORG), s.service.get(upload(), ORG), s.service.get(upload(), ORG)]);
    expect(s.client.renderBoard).toHaveBeenCalledTimes(1);
  });

  it('still returns the drawing when storing it fails, and keep() never throws', async () => {
    const s = setup(null, async () => ({ ...drawn }));
    s.store.putArtifact.mockRejectedValueOnce(new Error('disk'));
    await expect(s.service.get(upload(), ORG)).resolves.toMatchObject({ layers: [] });
    const down = setup(null, async () => { throw new ExtractionUnavailable('down'); });
    await expect(down.service.keep(upload(), ORG)).resolves.toBeUndefined();
  });

  it('treats an unreadable stored object as missing', async () => {
    const s = setup(null, async () => ({ ...drawn }));
    s.objects.set(previewArtifactPathFor(ORG, 'up-1'), Buffer.from('not gzip'));
    await s.service.get(upload(), ORG);
    expect(s.client.renderBoard).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewArtifactService thumbnail', () => {
  const withThumb = async () => ({ ...drawn, renderVersion: EXPECTED_RENDER_VERSION, thumbnail: '<svg/>' });

  it('draws once, stores the thumbnail next to the preview, then serves it without the engine', async () => {
    const s = setup(null, withThumb);
    expect(await s.service.getThumbnail(upload(), ORG)).toBe('<svg/>');
    expect(s.store.putArtifact).toHaveBeenCalledTimes(2);
    expect(await s.service.getThumbnail(upload(), ORG)).toBe('<svg/>');
    expect(s.client.renderBoard).toHaveBeenCalledTimes(1);
  });

  it('remembers that no thumbnail could be made instead of redrawing on every list view', async () => {
    const s = setup(null, async () => ({ ...drawn, renderVersion: EXPECTED_RENDER_VERSION, thumbnail: null }));
    expect(await s.service.getThumbnail(upload(), ORG)).toBeNull();
    expect(await s.service.getThumbnail(upload(), ORG)).toBeNull();
    expect(s.client.renderBoard).toHaveBeenCalledTimes(1);
  });

  it('fails when nothing is stored and the engine is down (the card keeps its icon)', async () => {
    const s = setup(null, async () => { throw new ExtractionUnavailable('down'); });
    await expect(s.service.getThumbnail(upload(), ORG)).rejects.toBeInstanceOf(ExtractionUnavailable);
  });
});

describe('previewInputsKey', () => {
  it('ignores file order and changes with the files or the lookups', () => {
    expect(previewInputsKey(['a', 'b'], 'x')).toBe(previewInputsKey(['b', 'a'], 'x'));
    expect(previewInputsKey(['a', 'b'], 'x')).not.toBe(previewInputsKey(['a', 'c'], 'x'));
    expect(previewInputsKey(['a', 'b'], 'x')).not.toBe(previewInputsKey(['a', 'b'], 'y'));
  });
});
