import { describe, expect, it } from 'vitest';

import type { FeatureAllowance } from '@/lib/api/hooks/useMachiningAllowance';
import { decisionRequest, initialForm, sourceLine, valueLine } from '@/lib/features/machining-allowance-ui';

const feature = (over: Partial<FeatureAllowance> = {}): FeatureAllowance => ({
  featureKey: 'SimpleHole:h1', featureType: 'SimpleHole', label: 'Hole 1', faceIds: [4], featureId: 'SimpleHole:1', occurrenceIndex: 0,
  status: 'requires_review', allowanceMm: null, sides: null, unit: 'mm', source: { level: 5, kind: 'none', id: null, ref: null },
  asCast: null, notes: [], ...over,
});
const form = { machined: true, allowanceMm: '1.5', sides: '2' as const, basis: 'engineering_drawing' as const, reason: 'drawing note 4' };

describe('machining allowance panel', () => {
  it('builds a machined decision with its value, sides, source and reason', () => {
    expect(decisionRequest('SimpleHole:h1', form)).toEqual({ request: {
      featureKey: 'SimpleHole:h1', machined: true, allowanceMm: 1.5, sides: 2, basis: 'engineering_drawing', reason: 'drawing note 4',
    } });
  });

  it('a "not machined" decision needs only its reason', () => {
    expect(decisionRequest('k', { ...form, machined: false, allowanceMm: '', basis: '' })).toEqual({ request: { featureKey: 'k', machined: false, reason: 'drawing note 4' } });
  });

  it('says what is missing instead of sending', () => {
    const error = (f: typeof form | Record<string, unknown>) => {
      const r = decisionRequest('k', { ...form, ...f });
      return 'error' in r ? r.error : null;
    };
    expect(error({ reason: ' ' })).toMatch(/where the value comes from/);
    expect(error({ allowanceMm: '0' })).toMatch(/positive/);
    expect(error({ allowanceMm: 'abc' })).toMatch(/positive/);
    expect(error({ basis: '' })).toMatch(/source/);
  });

  it('starts a hole on both sides of its diameter and a face on one', () => {
    expect(initialForm(feature()).sides).toBe('2');
    expect(initialForm(feature({ featureType: 'PlanarFace' })).sides).toBe('1');
    expect(initialForm(feature({ allowanceMm: 2, sides: 1 }))).toMatchObject({ allowanceMm: '2', sides: '1' });
  });

  it('names the source of the value', () => {
    expect(sourceLine(feature())).toMatch(/No source/);
    expect(sourceLine(feature({ source: { level: 3, kind: 'profile', id: 'p', ref: 'Foundry A v2 (foundry; rev 4)' } }))).toBe('Foundry A v2 (foundry; rev 4)');
    expect(sourceLine(feature({ source: { level: 1, kind: 'decision', id: 'd', ref: 'x', basis: 'engineering_drawing', reason: 'note 4', setBy: 'eng@x.com' } })))
      .toBe('Engineering drawing by eng@x.com: note 4');
    expect(sourceLine(feature({ source: { level: 1, kind: 'drawing', id: null, ref: 'drawing 4471 rev B: "MACHINING ALLOWANCE 3 MM"' } })))
      .toBe('From drawing 4471 rev B: "MACHINING ALLOWANCE 3 MM"');
  });

  it('shows the value per face and the sides', () => {
    expect(valueLine(feature())).toBe('—');
    expect(valueLine(feature({ allowanceMm: 1.5, sides: 2 }))).toBe('1.5 mm × 2 sides');
    expect(valueLine(feature({ allowanceMm: 2, sides: 1 }))).toBe('2 mm');
  });
});
