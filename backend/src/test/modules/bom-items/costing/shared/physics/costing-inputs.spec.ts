import {
  BATCHES_PER_YEAR,
  COSTING_INPUT_DEFAULTS,
  resolveCostingInputs,
  findStaleInputKeys,
} from '../../../../../../modules/bom-items/costing/shared/physics/costing-inputs';

// The canonical costing-input resolver. Before it existed, each entry point read
// these inputs ad-hoc with its own fallback — batchSize defaulted to 1 at the
// controller but 250 in the Cost Guide, annualVolume fell back to `undefined`,
// `null` and `10_000` in three different places, and productionLifeYears was a
// hardcoded 5 at three call sites while the UI presented it as editable.
// Everything below pins the one chain that replaced them.

describe('COSTING_INPUT_DEFAULTS', () => {
  it('is the only place a costing-input default is written', () => {
    expect(COSTING_INPUT_DEFAULTS).toEqual({ batchSize: 1, productionLifeYears: 5 });
  });

  it('declares no annual-volume default — a part with no real volume must say so', () => {
    expect(COSTING_INPUT_DEFAULTS).not.toHaveProperty('annualVolume');
  });
});

describe('resolveCostingInputs — batch size', () => {
  it('prefers an explicit request over a persisted override', () => {
    const r = resolveCostingInputs({
      requested: { batchSize: 10_000 },
      scenarioOverrides: { batchSize: 100_000 },
    });
    expect(r.batchSize).toBe(10_000);
    expect(r.provenance.batchSize).toBe('request');
  });

  it('uses the persisted scenario override when the request carries none', () => {
    const r = resolveCostingInputs({ scenarioOverrides: { batchSize: 100_000 } });
    expect(r.batchSize).toBe(100_000);
    expect(r.provenance.batchSize).toBe('scenario_override');
  });

  it('falls back to the single canonical default, and says it did', () => {
    // No annual volume to derive from either.
    const r = resolveCostingInputs({});
    expect(r.batchSize).toBe(1);
    expect(r.provenance.batchSize).toBe('default');
  });

  it("derives quarterly batches from the part's own annual volume", () => {
    // The shop releases a year's demand in BATCHES_PER_YEAR runs, so an item
    // stating a real annual volume starts at a real batch size, not 1.
    const r = resolveCostingInputs({ item: { annualVolume: 500_000 } });
    expect(r.batchSize).toBe(500_000 / BATCHES_PER_YEAR);
    expect(r.provenance.batchSize).toBe('derived');
  });

  it('rounds a non-divisible volume up, so four runs still cover the year', () => {
    const r = resolveCostingInputs({ item: { annualVolume: 1_001 } });
    expect(r.batchSize).toBe(Math.ceil(1_001 / BATCHES_PER_YEAR));
    expect(r.batchSize * BATCHES_PER_YEAR).toBeGreaterThanOrEqual(1_001);
  });

  it('never derives a batch below one', () => {
    const r = resolveCostingInputs({ item: { annualVolume: 1 } });
    expect(r.batchSize).toBe(1);
  });

  it('a saved scenario batch outranks the derivation', () => {
    // A number someone actually chose beats one computed for them.
    const r = resolveCostingInputs({
      scenarioOverrides: { batchSize: 250 },
      item: { annualVolume: 500_000 },
    });
    expect(r.batchSize).toBe(250);
    expect(r.provenance.batchSize).toBe('scenario_override');
  });

  it('clearing a saved batch override hands the batch size back to the derivation', () => {
    // What the Cost Guide relies on to undo an override: it writes
    // `batchSize: null` rather than deleting the JSONB key, so this must read as
    // absent and fall through to the derived tier -- not resolve to null/0 and
    // not keep the stale override.
    //
    // This is the tier that was unreachable in the UI: the page pinned
    // batchSizeDraft to the first resolved value and then sent it as an explicit
    // request param on every apply, so a saved override was written even when the
    // user never chose one, and annual volume could no longer move batch size.
    for (const cleared of [null, undefined, 0]) {
      const r = resolveCostingInputs({
        scenarioOverrides: { batchSize: cleared },
        item: { annualVolume: 500_000 },
      });
      expect(r.batchSize).toBe(500_000 / BATCHES_PER_YEAR);
      expect(r.provenance.batchSize).toBe('derived');
    }
  });

  it('re-derives batch size when annual volume changes and nothing overrides it', () => {
    // The user-visible promise: edit Annual Volume, batch size follows.
    const before = resolveCostingInputs({ item: { annualVolume: 500_000 } });
    const after = resolveCostingInputs({ item: { annualVolume: 800_000 } });
    expect(before.batchSize).toBe(125_000);
    expect(after.batchSize).toBe(200_000);
    expect(after.provenance.batchSize).toBe('derived');
  });

  it('reports the implied batch size even when an override wins, so the UI can explain the gap', () => {
    // The live case this closes: annual_volume was edited to 15,000 while
    // scenario_overrides.batchSize held a stale 125,000 written by an older UI
    // bug. The override correctly wins, but the screen then showed 125,000
    // directly beneath "Annual Volume 15,000" with nothing to explain it.
    // derivedBatchSize carries the 3,750 so the disclosure does not have to
    // re-implement BATCHES_PER_YEAR in a component.
    const r = resolveCostingInputs({
      scenarioOverrides: { batchSize: 125_000 },
      item: { annualVolume: 15_000 },
    });
    expect(r.batchSize).toBe(125_000);
    expect(r.provenance.batchSize).toBe('scenario_override');
    expect(r.derivedBatchSize).toBe(15_000 / BATCHES_PER_YEAR);
  });

  it('derivedBatchSize is null when there is no annual volume to imply one', () => {
    for (const item of [null, {}, { annualVolume: null }, { annualVolume: 0 }]) {
      expect(resolveCostingInputs({ item }).derivedBatchSize).toBeNull();
    }
  });

  it('derivedBatchSize equals batchSize when the derivation is what won', () => {
    const r = resolveCostingInputs({ item: { annualVolume: 15_000 } });
    expect(r.batchSize).toBe(3_750);
    expect(r.derivedBatchSize).toBe(3_750);
    expect(r.provenance.batchSize).toBe('derived');
  });

  it('an explicit request outranks both', () => {
    const r = resolveCostingInputs({
      requested: { batchSize: 10_000 },
      scenarioOverrides: { batchSize: 250 },
      item: { annualVolume: 500_000 },
    });
    expect(r.batchSize).toBe(10_000);
    expect(r.provenance.batchSize).toBe('request');
  });

  it('honours an explicit batch size of 1 instead of mistaking it for absent', () => {
    // The old `batchSize ? parseInt(...) : 1` could not tell these apart.
    const explicit = resolveCostingInputs({ requested: { batchSize: 1 } });
    expect(explicit.batchSize).toBe(1);
    expect(explicit.provenance.batchSize).toBe('request');
  });

  it('ignores a zero, negative or non-finite batch rather than costing on it', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = resolveCostingInputs({
        requested: { batchSize: bad },
        scenarioOverrides: { batchSize: 500 },
      });
      expect(r.batchSize).toBe(500);
      expect(r.provenance.batchSize).toBe('scenario_override');
    }
  });
});

describe('resolveCostingInputs — annual volume', () => {
  it('reads the authoritative bom_items column', () => {
    const r = resolveCostingInputs({ item: { annualVolume: 500_000 } });
    expect(r.annualVolume).toBe(500_000);
    expect(r.provenance.annualVolume).toBe('item_column');
  });

  it('reports absence honestly instead of inventing a volume', () => {
    // Replaces `?? 10_000` and `?? undefined` at the old call sites.
    for (const item of [null, {}, { annualVolume: null }, { annualVolume: 0 }]) {
      const r = resolveCostingInputs({ item });
      expect(r.annualVolume).toBeNull();
      expect(r.provenance.annualVolume).toBe('absent');
    }
  });

  it('is not overridable — the column stays the single source of truth', () => {
    // Other screens read bom_items.annual_volume directly; a scenario copy
    // would let them disagree with the quote.
    const r = resolveCostingInputs({
      scenarioOverrides: { annualVolume: 999 },
      item: { annualVolume: 500_000 },
    });
    expect(r.annualVolume).toBe(500_000);
  });
});

describe('resolveCostingInputs — production life', () => {
  it('uses the persisted scenario override when set', () => {
    const r = resolveCostingInputs({ scenarioOverrides: { productionLifeYears: 10 } });
    expect(r.productionLifeYears).toBe(10);
    expect(r.provenance.productionLifeYears).toBe('scenario_override');
  });

  it('prices an existing scenario with no override exactly as the old hardcoded 5 did', () => {
    const r = resolveCostingInputs({ scenarioOverrides: {} });
    expect(r.productionLifeYears).toBe(5);
    expect(r.provenance.productionLifeYears).toBe('default');
  });

  it('accepts a request value, and rejects a non-positive one', () => {
    expect(resolveCostingInputs({ requested: { productionLifeYears: 1 } }).productionLifeYears).toBe(1);
    for (const bad of [0, -1, Number.NaN]) {
      const r = resolveCostingInputs({
        requested: { productionLifeYears: bad },
        scenarioOverrides: { productionLifeYears: 7 },
      });
      expect(r.productionLifeYears).toBe(7);
    }
  });
});

describe('resolveCostingInputs — location', () => {
  it('prefers the request, then the override', () => {
    expect(resolveCostingInputs({
      requested: { location: 'India' }, scenarioOverrides: { location: 'USA' },
    }).location).toBe('India');
    expect(resolveCostingInputs({ scenarioOverrides: { location: 'USA' } }).location).toBe('USA');
  });

  it('reports absence rather than defaulting to a country', () => {
    // A silent 'USA' default would misprice a part against the wrong rates.
    const r = resolveCostingInputs({});
    expect(r.location).toBeNull();
    expect(r.provenance.location).toBe('absent');
  });

  it('ignores a blank string', () => {
    const r = resolveCostingInputs({ requested: { location: '   ' }, scenarioOverrides: { location: 'China' } });
    expect(r.location).toBe('China');
  });
});

describe('resolveCostingInputs — every input resolved in one pass', () => {
  it('resolves all four from mixed sources with correct provenance', () => {
    const r = resolveCostingInputs({
      requested: { batchSize: 10_000 },
      scenarioOverrides: { location: 'USA', productionLifeYears: 10 },
      item: { annualVolume: 500_000 },
    });
    expect(r).toMatchObject({
      batchSize: 10_000, location: 'USA', annualVolume: 500_000, productionLifeYears: 10,
    });
    expect(r.provenance).toEqual({
      batchSize: 'request',
      location: 'scenario_override',
      annualVolume: 'item_column',
      productionLifeYears: 'scenario_override',
    });
  });

  it('never returns undefined for a numeric input', () => {
    const r = resolveCostingInputs({});
    expect(r.batchSize).not.toBeUndefined();
    expect(r.productionLifeYears).not.toBeUndefined();
  });
});

describe('findStaleInputKeys', () => {
  const effective = { batchSize: 10_000, location: 'USA' };

  it('flags a snapshot saved at a different batch size', () => {
    // The reported symptom: rows amortised over 100,000 while the header said 10,000.
    expect(findStaleInputKeys({ batchSize: 100_000, location: 'USA' }, effective)).toEqual(['batchSize']);
  });

  it('flags a snapshot saved for a different location', () => {
    expect(findStaleInputKeys({ batchSize: 10_000, location: 'India' }, effective)).toEqual(['location']);
  });

  it('flags both when both differ', () => {
    expect(findStaleInputKeys({ batchSize: 250, location: 'India' }, effective))
      .toEqual(['batchSize', 'location']);
  });

  it('reports nothing when the snapshot matches', () => {
    expect(findStaleInputKeys({ batchSize: 10_000, location: 'USA' }, effective)).toEqual([]);
  });

  it('treats an unknown persisted value as unknown, never stale', () => {
    // Legacy rows predating the column must not all light up as outdated.
    expect(findStaleInputKeys({ batchSize: null, location: null }, effective)).toEqual([]);
    expect(findStaleInputKeys({}, effective)).toEqual([]);
  });

  it('does not flag location when the current scenario has none to compare against', () => {
    expect(findStaleInputKeys({ batchSize: 10_000, location: 'USA' }, { batchSize: 10_000, location: null }))
      .toEqual([]);
  });
});

// ── Annual volume genuinely absent ───────────────────────────────────────────
//
// This path existed and was tested, but was UNREACHABLE in production until
// migration 705: bom_items.annual_volume was NOT NULL DEFAULT 1000, so every
// item had a volume and provenance was always 'item_column' — including for
// parts whose 1000 nobody had ever chosen. The consequences were real:
//
//   batch size  ceil(1000 / 4) = 250, reported as provenance 'derived', i.e.
//               "computed from this item's own data".
//   route score the volume branches took their < 5,000 arms, so laser
//               collected the low-volume "no tooling amortization needed"
//               bonus and turret took the matching punch-die penalty. On the
//               real weights that widens the laser-over-turret cost-score
//               spread from 15 to 30 — a recommendation moved by a database
//               default.
//
// With the column nullable, absence resolves as absence.
describe('an annual volume that is genuinely not on file', () => {
  it('reports provenance absent rather than inventing a figure', () => {
    const r = resolveCostingInputs({ item: { annualVolume: null } });
    expect(r.annualVolume).toBeNull();
    expect(r.provenance.annualVolume).toBe('absent');
  });

  it('does not derive a batch size from a volume it does not have', () => {
    const r = resolveCostingInputs({ item: { annualVolume: null } });
    expect(r.batchSize).toBe(COSTING_INPUT_DEFAULTS.batchSize);
    expect(r.provenance.batchSize).toBe('default');
    expect(r.provenance.batchSize).not.toBe('derived');
  });

  it('treats a missing item the same as a missing volume', () => {
    const r = resolveCostingInputs({});
    expect(r.annualVolume).toBeNull();
    expect(r.provenance.annualVolume).toBe('absent');
  });

  it('still honours an explicit batch size when the volume is unknown', () => {
    // Not knowing the yearly demand does not invalidate a batch the user set.
    const r = resolveCostingInputs({ item: { annualVolume: null }, requested: { batchSize: 500 } });
    expect(r.batchSize).toBe(500);
    expect(r.provenance.batchSize).toBe('request');
  });

  it('rejects zero as a volume rather than deriving a batch from it', () => {
    // NULL reaching a numeric column as 0 was the other half of this defect.
    const r = resolveCostingInputs({ item: { annualVolume: 0 } });
    expect(r.annualVolume).toBeNull();
    expect(r.provenance.annualVolume).toBe('absent');
    expect(r.provenance.batchSize).toBe('default');
  });

  it('derives only from a real volume', () => {
    const r = resolveCostingInputs({ item: { annualVolume: 500_000 } });
    expect(r.provenance.annualVolume).toBe('item_column');
    expect(r.provenance.batchSize).toBe('derived');
    expect(r.batchSize).toBe(500_000 / BATCHES_PER_YEAR);
  });
});
