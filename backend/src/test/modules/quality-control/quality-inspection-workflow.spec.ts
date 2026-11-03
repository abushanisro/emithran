// Approval and rejection are decisions with an author (approved_by/rejected_by) and, for approval, approved items: a plain
// update may not set them, and an inspection is approved only from completed, once.
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { QualityInspectionService } from '../../../modules/quality-control/services/quality-inspection.service';
import { InspectionStatus } from '../../../modules/quality-control/dto/quality-inspection.dto';

jest.mock('@/common/database/database.service', () => ({ DatabaseService: class {} }), { virtual: true });

function harness(inspection: Record<string, unknown>, members: string[] = ['u1', 'u2']) {
  const writes: Array<{ table: string; op: string; values: unknown; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let op = 'select';
      let values: unknown = null;
      const result = async () => {
        if (op === 'select' && table === 'organization_members') return { data: members.map((user_id) => ({ user_id })), error: null };
        if (op === 'select') return { data: inspection, error: null };
        writes.push({ table, op, values, filters: [...filters] });
        if (table === 'quality_inspections' && op === 'update') {
          const matches = filters.every(([col, v]) => inspection[col] === v);
          if (!matches) return { data: [], error: null };
          Object.assign(inspection, values as object);
          return { data: [{ ...inspection }], error: null };
        }
        return { data: null, error: null };
      };
      const q: any = {
        select: () => q,
        update: (v: unknown) => { op = 'update'; values = v; return q; },
        insert: (v: unknown) => { op = 'insert'; values = v; return q; },
        eq: (col: string, v: unknown) => { filters.push([col, v]); return q; },
        single: () => result(),
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => result().then(resolve, reject),
      };
      return q;
    },
  };
  const service = new QualityInspectionService({ getUserClient: () => client } as any);
  return { service, writes, inspection };
}

const completed = () => ({
  id: 'i1', organization_id: 'org-a', status: InspectionStatus.COMPLETED, selected_items: ['b1'],
  name: 'n', project_id: 'p', inspection_type: 't', priority: 'p', created_at: 'c', updated_at: 'u',
});

describe('quality inspection workflow', () => {
  it.each([InspectionStatus.APPROVED, InspectionStatus.REJECTED])('an update cannot set the status to %s', async (status) => {
    const { service, writes } = harness(completed());
    await expect(service.updateInspection('i1', { status }, 'u1')).rejects.toThrow(BadRequestException);
    expect(writes).toEqual([]);
  });

  it('approves a completed inspection once, with the approver and its approved items', async () => {
    const { service, writes, inspection } = harness(completed());
    await service.approveInspection('i1', {}, 'u1', 'u1@example.com');
    expect(inspection.status).toBe(InspectionStatus.APPROVED);
    expect(inspection.approved_by).toBe('u1');
    expect(writes.map((w) => `${w.op} ${w.table}`)).toEqual(['update quality_inspections', 'insert quality_approved_items']);
    expect(writes[0].filters).toContainEqual(['status', InspectionStatus.COMPLETED]);

    await expect(service.approveInspection('i1', {}, 'u1')).rejects.toThrow(ConflictException);
    expect(writes).toHaveLength(2); // no second set of approved items
  });

  it.each([InspectionStatus.PLANNED, InspectionStatus.IN_PROGRESS, InspectionStatus.REJECTED])('refuses to approve an inspection that is %s', async (status) => {
    const { service, writes } = harness({ ...completed(), status });
    await expect(service.approveInspection('i1', {}, 'u1')).rejects.toThrow(ConflictException);
    expect(writes).toEqual([]);
  });

  describe('the person who created an inspection does not decide on it', () => {
    it('cannot approve it, and nothing is written', async () => {
      const { service, writes } = harness({ ...completed(), created_by: 'u1' });
      await expect(service.approveInspection('i1', {}, 'u1')).rejects.toThrow(ForbiddenException);
      expect(writes).toEqual([]);
    });

    it('cannot reject it either', async () => {
      const { service, writes } = harness({ ...completed(), created_by: 'u1' });
      await expect(service.rejectInspection('i1', { rejectionReason: 'no' }, 'u1')).rejects.toThrow(ForbiddenException);
      expect(writes).toEqual([]);
    });

    it('another member can approve or reject it', async () => {
      const approved = harness({ ...completed(), created_by: 'u1' });
      await approved.service.approveInspection('i1', {}, 'u2');
      expect(approved.inspection.status).toBe(InspectionStatus.APPROVED);
      const rejected = harness({ ...completed(), created_by: 'u1' });
      await rejected.service.rejectInspection('i1', { rejectionReason: 'no' }, 'u2');
      expect(rejected.inspection.status).toBe(InspectionStatus.REJECTED);
    });

    it('a one-person organization can approve its own inspection (nobody else could)', async () => {
      const { service, inspection } = harness({ ...completed(), created_by: 'u1' }, ['u1']);
      await service.approveInspection('i1', {}, 'u1');
      expect(inspection.status).toBe(InspectionStatus.APPROVED);
    });

    it('fails closed when the members cannot be read', async () => {
      const { service } = harness({ ...completed(), created_by: 'u1' });
      (service as any).db = () => ({
        from: (table: string) => ({
          select: () => ({
            eq: () => ({
              eq: async () => (table === 'organization_members' ? { data: null, error: { message: 'down', code: '503' } } : { data: null, error: null }),
              single: async () => ({ data: { ...completed(), created_by: 'u1' }, error: null }),
            }),
          }),
        }),
      });
      await expect(service.approveInspection('i1', {}, 'u1')).rejects.toThrow();
    });
  });
});
