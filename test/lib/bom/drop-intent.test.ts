import { describe, expect, it } from 'vitest';

import { dropIntent, type DropItem } from '@/lib/bom/drop-intent';

// The liner BOM: an assembly, two sub-assemblies, their child parts.
const i = (id: string, itemType: string, parentItemId: string | null, bomLevel: string): DropItem => ({ id, name: id, itemType, parentItemId, bomLevel });
const liner = i('liner', 'assembly', null, 'L0');
const cannula = i('cannula', 'sub_assembly', 'liner', 'L1');
const chassis = i('chassis', 'sub_assembly', 'liner', 'L1');
const left = i('left', 'child_part', 'cannula', 'L2');
const right = i('right', 'child_part', 'cannula', 'L2');
const mount = i('mount', 'child_part', 'chassis', 'L2');
const frame = i('frame', 'assembly', null, 'L0');
const ITEMS = [liner, cannula, chassis, left, right, mount, frame];

describe('what dropping one BOM item on another does', () => {
  it('siblings of one type reorder (the dragged item takes the target\'s place); root assemblies swap', () => {
    expect(dropIntent(right, left, ITEMS)).toEqual({ kind: 'reorder', label: 'Move before “left”' });
    expect(dropIntent(chassis, cannula, ITEMS)).toMatchObject({ kind: 'reorder' });
    expect(dropIntent(frame, liner, ITEMS)).toMatchObject({ kind: 'reorder' });
    expect(dropIntent(liner, frame, ITEMS).kind).toBe('reorder');
  });

  it('a child part goes into a sub-assembly (L2) or an assembly; a sub-assembly into an assembly (L1)', () => {
    expect(dropIntent(mount, cannula, ITEMS)).toEqual({ kind: 'into', label: 'Move into “cannula”', parentId: 'cannula', bomLevel: 'L2' });
    expect(dropIntent(mount, frame, ITEMS)).toMatchObject({ kind: 'into', parentId: 'frame', bomLevel: 'L2' });
    expect(dropIntent(cannula, frame, ITEMS)).toMatchObject({ kind: 'into', parentId: 'frame', bomLevel: 'L1' });
  });

  it('where it already is: nothing to do', () => {
    expect(dropIntent(left, cannula, ITEMS)).toEqual({ kind: 'none', label: 'Already in “cannula”' });
    expect(dropIntent(left, left, ITEMS).kind).toBe('none');
  });

  it('refuses what the BOM does not allow, saying why: upward moves, child into child, into its own sub-components', () => {
    expect(dropIntent(cannula, mount, ITEMS)).toEqual({ kind: 'invalid', label: 'A sub-assembly can\'t go into a child part' });
    expect(dropIntent(cannula, left, ITEMS)).toEqual({ kind: 'invalid', label: '“cannula” can\'t go into its own sub-components' });
    expect(dropIntent(liner, cannula, ITEMS)).toEqual({ kind: 'invalid', label: '“liner” can\'t go into its own sub-components' });
    expect(dropIntent(frame, cannula, ITEMS)).toEqual({ kind: 'invalid', label: 'An assembly can\'t go into a sub-assembly' });
    expect(dropIntent(mount, left, ITEMS)).toEqual({ kind: 'invalid', label: 'A child part can\'t go into a child part' });
  });
});
