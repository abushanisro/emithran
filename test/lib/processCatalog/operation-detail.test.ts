import { describe, it, expect } from 'vitest';

import { hasOperationDetail } from '@/lib/processCatalog/operation-detail';
import type { ProcessTaxonomyHint } from '@/lib/api/hooks/useProcessCalculatorMappings';

const ops = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ operationCategory: 'As Sintered', featureType: `Feature${i}`, raw: `Laser Sintering:As Sintered//Feature${i}` }));

const hint = (over: Partial<ProcessTaxonomyHint> = {}): ProcessTaxonomyHint => ({
  processName: 'Laser Sintering',
  defaultMachineName: null,
  defaultToolShopName: null,
  roadmapStatus: 'not_modeled',
  aliases: [],
  operations: ops(3),
  ...over,
});

describe('hasOperationDetail', () => {
  it('an active row with operations shows detail', () => {
    expect(hasOperationDetail({ isActive: true, operation: 'Laser Cut', taxonomy: hint({ processName: 'Laser Cut' }) })).toBe(true);
  });

  it('THE REPORTED BUG: an inactive seeded process that is its own canonical row shows its operations', () => {
    // Additive Manufacturing / Laser Sintering, seeded inactive by migration 790.
    expect(hasOperationDetail({ isActive: false, operation: 'Laser Sintering', taxonomy: hint() })).toBe(true);
  });

  it('shows detail for an inactive process that only has a default machine', () => {
    const t = hint({ processName: 'Hammer', operations: [], defaultMachineName: 'Default Hammer' });
    expect(hasOperationDetail({ isActive: false, operation: 'Hammer', taxonomy: t })).toBe(true);
  });

  it('an inactive DUPLICATE of another process stays hidden (Laser Puch -> Laser Punch)', () => {
    const t = hint({ processName: 'Laser Punch', aliases: ['Laser Puch'] });
    expect(hasOperationDetail({ isActive: false, operation: 'Laser Puch', taxonomy: t })).toBe(false);
  });

  it('matching the canonical name ignores case and surrounding whitespace', () => {
    expect(hasOperationDetail({ isActive: false, operation: '  laser sintering ', taxonomy: hint() })).toBe(true);
  });

  it('shows nothing when there is genuinely no detail on file', () => {
    const t = hint({ operations: [], aliases: [], defaultMachineName: null });
    expect(hasOperationDetail({ isActive: true, operation: 'Laser Sintering', taxonomy: t })).toBe(false);
    expect(hasOperationDetail({ isActive: false, operation: 'Laser Sintering', taxonomy: t })).toBe(false);
  });

  it('shows nothing without a taxonomy link at all', () => {
    expect(hasOperationDetail({ isActive: true, operation: 'X', taxonomy: undefined })).toBe(false);
  });

  it('an older payload without the canonical name keeps the old behaviour for inactive rows', () => {
    const legacy = { ...hint(), processName: undefined } as unknown as ProcessTaxonomyHint;
    expect(hasOperationDetail({ isActive: false, operation: 'Laser Sintering', taxonomy: legacy })).toBe(false);
    expect(hasOperationDetail({ isActive: true, operation: 'Laser Sintering', taxonomy: legacy })).toBe(true);
  });
});
