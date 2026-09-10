import { readFileSync } from 'fs';
import { join } from 'path';

import {
  getRouteCoreProcessClasses,
  getFormingProcessClasses,
  getEnginesForFamily,
} from '../../../modules/bom-items/costing/shared/core/manufacturing-process-registry';
import { MHR_RATE_MACHINE_CLASSES } from '../../../modules/bom-items/bom-items.service';

// Two lists used to state, as string literals, something the engine registry
// already knows. Both are now derived or locked, because both fail SILENTLY —
// they do not produce a wrong number, they make a real applied route disappear
// and let a fabricated preview take its place.

const SERVICE = join(__dirname, '..', '..', '..', 'modules', 'bom-items', 'bom-items.service.ts');
const source = readFileSync(SERVICE, 'utf8');

describe('the applied-generation read is not filtered by process class', () => {
  it('no longer filters the applied rows by machine class at all', () => {
    // History: the query filter was a 17-entry string literal while the overlay
    // argument beside it was a registry derivation. Identical at the time,
    // which is why nothing caught the drift risk — registering a new cutting
    // engine would grow one and not the other, the applied row would be
    // filtered out, and the Cost Guide would fall back to a live preview.
    //
    // That was then fixed by deriving both from getRouteCoreProcessClasses(),
    // and this test asserted the shared derivation. It is now obsolete in the
    // strongest possible way: an applied route is a COMPLETE snapshot, so the
    // read takes the whole active generation and there is no class filter left
    // to drift. Secondary operations (deburring, PEM, inspection) were never
    // fetched under the old filter, which is exactly how a persisted CMM cost
    // of 0.21 came to be displayed as a freshly recomputed 0.39.
    expect(source).not.toMatch(/\.in\('machine_class',\s*\[\s*'fiber_laser'/);
    expect(source).not.toContain(".in('machine_class', [...routeCoreProcessClasses])");

    // And the completeness/validity of that generation is what gates the
    // overlay now, rather than a class allowlist.
    expect(source).toContain('selectAppliedGeneration(');
  });

  it('covers every registered cutting and forming engine, plus press brake', () => {
    const core = getRouteCoreProcessClasses();
    for (const e of getEnginesForFamily('sheet_metal_cutting')) {
      expect(core.has(e.machineClass as string)).toBe(true);
    }
    for (const e of getEnginesForFamily('sheet_metal_forming')) {
      expect(core.has(e.machineClass as string)).toBe(true);
    }
    // Independently overridable via the Edit Process Cost dialog, so a
    // persisted press-brake row must load even when the core row is unchanged.
    expect(core.has('press_brake')).toBe(true);
  });

  it('does not admit a secondary-op class as a route core process', () => {
    // Tapping/deburring/PEM are feature-gated operations, never route
    // alternatives. If one leaked in, applyPersistedRouteToSummary would treat
    // it as the cutting row and overwrite the real one.
    const core = getRouteCoreProcessClasses();
    for (const cls of ['tapping', 'deburring', 'pem_press', 'drill_press', 'hole_forming', 'cmm']) {
      expect(core.has(cls)).toBe(false);
    }
  });

  it('reports only in-process benders as forming', () => {
    const forming = getFormingProcessClasses();
    expect(forming.has('press_brake')).toBe(false); // press brake is the separate op
    expect(forming.has('standard_press')).toBe(true);
    expect(forming.has('fiber_laser')).toBe(false);
  });
});

describe('every registered route engine gets an MHR rate resolved', () => {
  // getRouteComparison() does `if (!identity || !rate) continue`, so a class
  // absent from the rate pass is not flagged as unpriceable — it stops being
  // offered as a route at all, with no warning anywhere.
  const rated = new Set<string>(MHR_RATE_MACHINE_CLASSES as readonly string[]);

  it.each(
    [...getEnginesForFamily('sheet_metal_cutting'), ...getEnginesForFamily('sheet_metal_forming')]
      .map((e) => [e.machineClass as string] as const),
  )('resolves a rate for %s', (cls) => {
    expect(rated.has(cls)).toBe(true);
  });

  it('still fetches press brake, the shared secondary op', () => {
    expect(rated.has('press_brake')).toBe(true);
  });
});
