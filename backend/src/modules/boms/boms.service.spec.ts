// Org-scoped tenancy Phase 2 (.claude/plans/delegated-gliding-swan.md):
// proves create() writes organization_id from the resolved org context
// instead of leaving it unset, mirroring the established mocked-dependency
// pattern from mhr.service.spec.ts / bom-items.currency.spec.ts.
import { BOMsService } from './boms.service';
import { type Logger } from '../../common/logger/logger.service';
import { type SupabaseService } from '../../common/supabase/supabase.service';

describe('BOMsService.create', () => {
  it('writes organization_id alongside user_id when an organization is resolved', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'bom-1',
        name: 'Test BOM',
        project_id: 'project-1',
        created_at: '2026-08-22T00:00:00.000Z',
        updated_at: '2026-08-22T00:00:00.000Z',
      },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    const from = jest.fn().mockReturnValue({ insert });
    const client = { from };

    const supabaseService = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;

    const service = new BOMsService(supabaseService, { log: jest.fn(), error: jest.fn() } as unknown as Logger);

    await service.create({ name: 'Test BOM' } as any, 'user-456', 'token', 'org-789');

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-456', organization_id: 'org-789' }),
    );
  });

  it('writes a null organization_id rather than omitting the field when none is resolved', async () => {
    const single = jest.fn().mockResolvedValue({
      data: {
        id: 'bom-1',
        name: 'Test BOM',
        project_id: 'project-1',
        created_at: '2026-08-22T00:00:00.000Z',
        updated_at: '2026-08-22T00:00:00.000Z',
      },
      error: null,
    });
    const select = jest.fn().mockReturnValue({ single });
    const insert = jest.fn().mockReturnValue({ select });
    const from = jest.fn().mockReturnValue({ insert });
    const client = { from };

    const supabaseService = {
      getClient: jest.fn().mockReturnValue(client),
    } as unknown as SupabaseService;

    const service = new BOMsService(supabaseService, { log: jest.fn(), error: jest.fn() } as unknown as Logger);

    await service.create({ name: 'Test BOM' } as any, 'user-456', 'token');

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ organization_id: null }));
  });
});
