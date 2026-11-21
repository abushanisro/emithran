import { describe, expect, it } from 'vitest';

import { routePickKeyOf, routePicksOf } from '@/lib/routing/route-pick';

const route = (routeId: string, routeLabel = routeId) => ({ routeId, routeLabel });

// A part's route choice: the one reading of it for the Workflow Builder's Set Route, the Manual route restored after a reload, and Apply.
describe('the route choice a complete route carries', () => {
  it.each([
    ['forging-closed_die_hammer', { forgingRoute: 'closed_die_hammer' }],
    ['composites-atl', { compositesRoute: 'atl' }],
    ['additive-resin_curing', { additiveRoute: 'resin_curing' }],
    ['bar-tube-plate_oxyfuel', { barTubeRoute: 'plate_oxyfuel' }],
    ['assembly-robotic', { assemblyRoute: 'robotic' }],
    ['im-insert-3-axis', { insertMoldingRoute: '3_axis' }],
    ['ms-vertical', { multiShotRoute: 'vertical' }],
    ['multispindle-twin', { multiSpindleRoute: 'twin' }],
    ['partassembly-robotic', { partAssemblyRoute: 'robotic' }],
    ['hydroform-fluid-cell', { hydroformRoute: 'fluid-cell' }],
  ])('%s is its family\'s choice, and no other family\'s', (routeId, picks) => {
    expect(routePicksOf(route(routeId), null)).toEqual(picks);
  });

  it('a die casting route is its process (its label); a route of a family with no choice of its own carries none', () => {
    expect(routePicksOf(route('dc-hpdc', 'High Pressure Die Casting'), 'die_cast')).toEqual({ dieCastingProcess: 'High Pressure Die Casting' });
    expect(routePicksOf(route('dc-hpdc', 'High Pressure Die Casting'), 'sand_cast')).toEqual({});
    expect(routePicksOf(route('3-axis-mill', '3 Axis Mill'), 'milled')).toEqual({});
    expect(routePicksOf(route('partassembly-'), 'part_assembly')).toEqual({});
  });
});

describe('the key a part keeps its route choice under', () => {
  it('its Process\'s, when that engine reads its own, whatever the part was analysed as', () => {
    expect(routePickKeyOf({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Part Assembly' } }, 'milled')).toBe('partAssemblyRoute');
    expect(routePickKeyOf({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Multi-Spindle Machining' } }, 'turned')).toBe('multiSpindleRoute');
    expect(routePickKeyOf({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Assembly Plastic Molding' } }, 'plastic_molded')).toBe('multiShotRoute');
    expect(routePickKeyOf({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Assembly Molding' } }, 'plastic_molded')).toBe('insertMoldingRoute');
    expect(routePickKeyOf({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Assembly' } }, 'die_cast')).toBe('assemblyRoute');
    // A hydroformed part is analysed as sheet metal, whose own routes carry no choice; its engine reads hydroformRoute.
    expect(routePickKeyOf({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Sheet Metal - Hydroforming' } }, 'sheet_metal')).toBe('hydroformRoute');
    expect(routePickKeyOf({ itemType: 'child_part' }, 'sheet_metal')).toBeNull();
  });

  it('an assembly or sub-assembly with no Process of its own is costed as an assembly; one set to another Process is not', () => {
    expect(routePickKeyOf({ itemType: 'assembly', scenarioOverrides: {} }, null)).toBe('assemblyRoute');
    expect(routePickKeyOf({ itemType: 'sub_assembly' }, null)).toBe('assemblyRoute');
    expect(routePickKeyOf({ itemType: 'assembly', scenarioOverrides: { processGroup: 'Part Assembly' } }, null)).toBe('partAssemblyRoute');
  });

  it('else its family\'s (as it was analysed); none for a family whose routes carry no choice', () => {
    expect(routePickKeyOf({ itemType: 'child_part' }, 'die_cast')).toBe('dieCastingProcess');
    expect(routePickKeyOf({ itemType: 'child_part', scenarioOverrides: { processGroup: 'Forging' } }, 'forged')).toBe('forgingRoute');
    expect(routePickKeyOf({ itemType: 'child_part' }, 'composite')).toBe('compositesRoute');
    expect(routePickKeyOf({ itemType: 'child_part' }, 'additive')).toBe('additiveRoute');
    expect(routePickKeyOf({ itemType: 'child_part' }, 'bar_tube')).toBe('barTubeRoute');
    expect(routePickKeyOf({ itemType: 'child_part' }, 'milled')).toBeNull();
    expect(routePickKeyOf({ itemType: 'child_part' }, null)).toBeNull();
    expect(routePickKeyOf(null, 'forged')).toBeNull();
  });
});
