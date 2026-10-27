import { describe, expect, it } from 'vitest';

import { draftProblems, toScenario, type ScenarioDraft } from '@/components/features/electronics/useQuoteFlow';

const draft = (inputs: ScenarioDraft['inputs']): ScenarioDraft => ({ location: 'India', displayCurrency: 'INR', annualVolume: '6000', machines: { pick_and_place: 'm1', reflow: '' }, inputs });

describe('scenario draft', () => {
  it('sends only values that have both a number and a source, and drops unchosen machines', () => {
    const s = toScenario(draft({
      'reflow.conveyor_speed': { value: '800', note: 'Heller 1809 datasheet' },
      'spi.cycle_time': { value: '12', note: '' },
      'aoi.inspection_speed': { value: '', note: 'line study' },
    }));
    expect(s).toEqual({
      location: 'India',
      displayCurrency: 'INR',
      annualVolume: 6000,
      machines: { pick_and_place: 'm1' },
      inputs: { 'reflow.conveyor_speed': { value: 800, note: 'Heller 1809 datasheet' } },
    });
  });

  it('names what stops each half-filled value instead of guessing it', () => {
    expect(draftProblems(draft({
      a: { value: '12', note: '' },
      b: { value: '', note: 'line study' },
      c: { value: '-1', note: 'x' },
      d: { value: '5', note: 'datasheet' },
    }))).toEqual({ a: 'say where the value comes from', b: 'enter the value', c: 'must be a number greater than 0' });
  });
});
