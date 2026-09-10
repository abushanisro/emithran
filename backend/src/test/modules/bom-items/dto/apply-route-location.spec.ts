import 'reflect-metadata';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { ApplyRouteDto, ApplyCustomRouteDto } from '../../../../modules/bom-items/dto/apply-route.dto';
import { LOCATION_INFO } from '../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import { resolveCostingInputs } from '../../../../modules/bom-items/costing/shared/physics/costing-inputs';

// Applying a route WRITES a costing commitment. Location decides the machine
// rate, the labour rate, the currency, and which raw_materials cost column the
// material price is read from — so it is a costing input, not a display
// preference, and it is persisted with the records.
//
// It used to be `@IsOptional()`, read as `dto.location ?? 'USA'`. An apply that
// stated no location was priced against USA rates in USD from cost_usa and
// saved that way, with nobody having chosen USA. An unrecognised string had the
// same ending by a different road: LOCATION_INFO[loc] ?? LOCATION_INFO['USA'].

const errorsFor = (cls: typeof ApplyRouteDto | typeof ApplyCustomRouteDto, payload: object) =>
  validateSync(plainToInstance(cls as never, payload) as object, { whitelist: false });

const propertiesWithErrors = (cls: typeof ApplyRouteDto | typeof ApplyCustomRouteDto, payload: object) =>
  errorsFor(cls, payload).map((e) => e.property);

const baseRoute = { routeId: 'sm-laser' };
const baseCustom = {
  baseCuttingRouteId: 'sm-laser',
  steps: [{ process: 'Laser Cutting', machineClass: 'fiber_laser' }],
};

describe('apply-route refuses to price a part at a location nobody chose', () => {
  it('rejects an apply that states no location', () => {
    expect(propertiesWithErrors(ApplyRouteDto, baseRoute)).toContain('location');
  });

  it('rejects a location this system holds no rates for', () => {
    // Previously fell through LOCATION_INFO's own USA fallback to cost_usa.
    expect(propertiesWithErrors(ApplyRouteDto, { ...baseRoute, location: 'Atlantis' }))
      .toContain('location');
  });

  it('accepts a real non-USA location', () => {
    expect(propertiesWithErrors(ApplyRouteDto, { ...baseRoute, location: 'India' }))
      .not.toContain('location');
  });

  it('accepts every location LOCATION_INFO actually has rates for', () => {
    // Derived from the same table that resolves currency and the material
    // column, so the validator cannot drift from what pricing supports.
    for (const loc of Object.keys(LOCATION_INFO)) {
      expect(propertiesWithErrors(ApplyRouteDto, { ...baseRoute, location: loc }))
        .not.toContain('location');
    }
  });

  it('holds the same rule on the custom-route endpoint', () => {
    expect(propertiesWithErrors(ApplyCustomRouteDto, baseCustom)).toContain('location');
    expect(propertiesWithErrors(ApplyCustomRouteDto, { ...baseCustom, location: 'Germany' }))
      .not.toContain('location');
  });
});

describe('a non-USA scenario resolves to itself, not to USA', () => {
  it('keeps a saved non-USA scenario location', () => {
    const r = resolveCostingInputs({ scenarioOverrides: { location: 'India' } });
    expect(r.location).toBe('India');
    expect(r.provenance.location).toBe('scenario_override');
  });

  it('lets an explicit request override the saved scenario', () => {
    const r = resolveCostingInputs({
      requested: { location: 'Germany' }, scenarioOverrides: { location: 'India' },
    });
    expect(r.location).toBe('Germany');
    expect(r.provenance.location).toBe('request');
  });

  it('reports a missing location as absent rather than substituting one', () => {
    const r = resolveCostingInputs({});
    expect(r.location).toBeNull();
    expect(r.provenance.location).toBe('absent');
    // Specifically not the old silent answer.
    expect(r.location).not.toBe('USA');
  });

  it('does not treat blank input as a location', () => {
    const r = resolveCostingInputs({ requested: { location: '   ' } });
    expect(r.location).toBeNull();
    expect(r.provenance.location).toBe('absent');
  });

  it('prices a non-USA location from its own material column and currency', () => {
    // The reason location is a costing input and not a label.
    expect(LOCATION_INFO['India']!.materialCol).toBe('cost_india');
    expect(LOCATION_INFO['India']!.code).toBe('INR');
    expect(LOCATION_INFO['India']!.materialCol).not.toBe(LOCATION_INFO['USA']!.materialCol);
  });
});
