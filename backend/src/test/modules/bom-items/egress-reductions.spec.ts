// Supabase egress / request-count reductions (Phase 1–3): the signed-link
// reuse, the path-only file lookup, clearing a stale thumbnail, and the
// memoised reference lookups. Mocked-dependency pattern as in
// bom-items.currency.spec.ts.
import type { SecondaryProcessService } from '../../../modules/bom-items/services/secondary-process.service';
import type { PlasticReferenceService } from '../../../modules/bom-items/costing/plastic-molding/lookup/plastic-reference.service';
import type { CastingReferenceService } from '../../../modules/bom-items/costing/casting/casting-reference.service';
import type { FeatureToleranceService } from '../../../modules/bom-items/services/feature-tolerance.service';
import type { SheetMetalCatalogOperationsService } from '../../../modules/bom-items/costing/sheet-metal/operation/catalog-operations.service';
import type { HydroformingReferenceService } from '../../../modules/bom-items/costing/hydroforming/hydroforming-reference.service';
import { NotFoundException } from '@nestjs/common';
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';
import { MachiningLookupService } from '../../../modules/bom-items/costing/machining/lookup/machining-lookup.service';
import {
  SIGNED_URL_TTL_SEC,
  clearSignedUrls,
  getReusableSignedUrl,
  rememberSignedUrl,
} from '../../../modules/bom-items/services/signed-url-cache';
import { type SupabaseService } from '../../../common/supabase/supabase.service';

function buildService(supabase: unknown = {}) {
  const none = {} as never;
  return new BOMItemsService(
    supabase as SupabaseService,
    none, none, none, none, none, none, none, none, none, none,
    {} as SecondaryProcessService,
    {} as PlasticReferenceService,
    {} as CastingReferenceService,
    {} as FeatureToleranceService,
    {} as SheetMetalCatalogOperationsService,
    {} as HydroformingReferenceService,
  );
}

/** A user client whose bom_items select resolves to `rows`, recording the columns asked for. */
function userClientReturning(rows: unknown[] | null, error: { message: string } | null = null) {
  const select = jest.fn();
  const chain: any = {
    select: (cols: string) => (select(cols), chain),
    eq: () => chain,
    limit: () => Promise.resolve({ data: rows, error }),
  };
  const client = { from: jest.fn(() => chain) };
  return { supabase: { getUserClient: jest.fn(() => client) }, select };
}

describe('signed link reuse', () => {
  beforeEach(clearSignedUrls);

  it('hands back the same link for 50 minutes of its 60, so the browser can cache the file', () => {
    rememberSignedUrl('u1:a.stl', 'https://signed/1', SIGNED_URL_TTL_SEC, 0);
    expect(getReusableSignedUrl('u1:a.stl', 50 * 60_000 - 1)).toBe('https://signed/1');
    expect(getReusableSignedUrl('u1:a.stl', 50 * 60_000)).toBeUndefined();
  });

  it('never hands one user\'s link to another', () => {
    rememberSignedUrl('u1:a.stl', 'https://signed/1', SIGNED_URL_TTL_SEC, 0);
    expect(getReusableSignedUrl('u2:a.stl', 1)).toBeUndefined();
  });

  it('does not keep a link too short-lived to reuse safely', () => {
    rememberSignedUrl('u1:a.stl', 'https://signed/1', 60, 0);
    expect(getReusableSignedUrl('u1:a.stl', 1)).toBeUndefined();
  });
});

describe('BOMItemsService.findFilePath', () => {
  it('reads only the two path columns, as the caller', async () => {
    const { supabase, select } = userClientReturning([{ file_2d_path: 'd.pdf', file_3d_path: 'm.stl' }]);
    const service = buildService(supabase);
    await expect(service.findFilePath('i1', '3d', 'tok')).resolves.toBe('m.stl');
    await expect(service.findFilePath('i1', '2d', 'tok')).resolves.toBe('d.pdf');
    expect(select).toHaveBeenCalledWith('file_2d_path, file_3d_path');
    expect(supabase.getUserClient).toHaveBeenCalledWith('tok');
  });

  it('returns null when the item has no file of that kind', async () => {
    const { supabase } = userClientReturning([{ file_2d_path: null, file_3d_path: 'm.stl' }]);
    await expect(buildService(supabase).findFilePath('i1', '2d', 'tok')).resolves.toBeNull();
  });

  it('is not found when RLS hides the item or it does not exist', async () => {
    const { supabase } = userClientReturning([]);
    await expect(buildService(supabase).findFilePath('i1', '3d', 'tok')).rejects.toThrow(NotFoundException);
  });
});

describe('stored thumbnail on a new 3D model', () => {
  const transform = (dto: Record<string, unknown>) => (buildService() as any).transformDtoToDb(dto);

  it('is cleared when the 3D or STEP file changes', () => {
    expect(transform({ file3dPath: 'new.stl' })).toMatchObject({ file_3d_path: 'new.stl', thumbnail_url: null });
    expect(transform({ fileStepPath: 'new.step' })).toMatchObject({ thumbnail_url: null });
  });

  it('is left alone by every other update', () => {
    expect(transform({ name: 'x', file2dPath: 'd.pdf' })).not.toHaveProperty('thumbnail_url');
  });
});

describe('memoised machining reference lookups', () => {
  /** A privileged client whose variable read fails `failures` times, then succeeds. */
  function lookupWithVariableReads(failures: number) {
    let calls = 0;
    const variableRead = jest.fn(() => {
      calls++;
      return calls <= failures
        ? { data: null, error: { message: 'timeout' } }
        : { data: { value: '2' }, error: null };
    });
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: () => Promise.resolve(variableRead()),
    };
    const supabase = { getPrivilegedClient: () => ({ from: () => chain }) } as unknown as SupabaseService;
    const service = new MachiningLookupService(supabase);
    jest.spyOn(service as any, 'loadTable').mockResolvedValue([{ row: 1 }]);
    return { service, variableRead };
  }

  it('reads the hobbing variable once, then serves later calls from the cache', async () => {
    const { service, variableRead } = lookupWithVariableReads(0);
    await service.getHobbingReference();
    await service.getHobbingReference();
    expect(variableRead).toHaveBeenCalledTimes(1);
  });

  it('never remembers a failed read: the next call asks again', async () => {
    const { service, variableRead } = lookupWithVariableReads(1);
    await expect(service.getHobbingReference()).resolves.toMatchObject({ defaultNumStarts: null });
    await expect(service.getHobbingReference()).resolves.toMatchObject({ defaultNumStarts: 2 });
    expect(variableRead).toHaveBeenCalledTimes(2);
  });
});
