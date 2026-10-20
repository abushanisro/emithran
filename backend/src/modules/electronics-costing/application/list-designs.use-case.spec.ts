import { buildDesignViews } from './list-designs.use-case';

import type { DesignRow, RevisionRow, UploadRow } from '../infrastructure/repositories/electronics.repository';

const design = (id: string, projectId: string | null): DesignRow => ({
  id,
  organization_id: 'org',
  name: `design ${id}`,
  kind: 'board',
  project_id: projectId,
  parent_design_id: null,
  item_type: 'child_part',
  created_at: '2026-10-16T10:00:00Z',
});
const revision = (id: string, designId: string, label: string, createdAt: string): RevisionRow => ({
  id,
  design_id: designId,
  organization_id: 'org',
  revision: label,
  input_sha256: 'a'.repeat(64),
  created_at: createdAt,
});
const upload = (id: string, revisionId: string | null, status: UploadRow['status']): UploadRow =>
  ({ id, revision_id: revisionId, status }) as UploadRow;

describe('buildDesignViews', () => {
  it('lists each design with its revisions newest first and the status of each revision upload', () => {
    const views = buildDesignViews(
      [design('d1', 'p1'), design('d2', null)],
      [
        revision('r1', 'd1', '1', '2026-10-16T10:00:00Z'),
        revision('r2', 'd1', '2', '2026-10-16T11:00:00Z'),
        revision('r3', 'd2', '1', '2026-10-16T12:00:00Z'),
      ],
      [upload('u1', 'r1', 'needs_review'), upload('u2', 'r2', 'failed')],
    );
    expect(views[0].projectId).toBe('p1');
    expect(views[0].revisions.map((r) => r.revision)).toEqual(['2', '1']);
    expect(views[0].revisions.map((r) => r.status)).toEqual(['failed', 'needs_review']);
    expect(views[1].projectId).toBeNull();
    expect(views[1].revisions[0]).toMatchObject({ id: 'r3', uploadId: null, status: null });
  });

  it('carries the reason a revision failed, and none for one that did not', () => {
    const failed = { ...upload('u1', 'r1', 'failed'), failure: { code: 'extraction_failed', message: 'the set has no board outline layer' } } as UploadRow;
    const views = buildDesignViews([design('d1', null)], [revision('r1', 'd1', '1', '2026-10-16T10:00:00Z'), revision('r2', 'd1', '2', '2026-10-16T11:00:00Z')], [failed, upload('u2', 'r2', 'needs_review')]);
    expect(views[0].revisions.map((r) => r.failure?.message ?? null)).toEqual([null, 'the set has no board outline layer']);
  });

  it('carries the container a design sits in and its item type', () => {
    const container: DesignRow = { ...design('a1', 'p1'), kind: 'assembly', item_type: 'assembly' };
    const child: DesignRow = { ...design('c1', 'p1'), parent_design_id: 'a1' };
    const views = buildDesignViews([container, child], [], []);
    expect(views.map((v) => [v.id, v.itemType, v.parentId])).toEqual([['a1', 'assembly', null], ['c1', 'child_part', 'a1']]);
  });

  it('keeps a design with no revisions', () => {
    expect(buildDesignViews([design('d1', null)], [], [])[0].revisions).toEqual([]);
  });
});
