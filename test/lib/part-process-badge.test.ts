import { describe, expect, it } from 'vitest';

import { partProcessBadge } from '@/lib/features/display-format';

describe('partProcessBadge', () => {
  it('shows the chosen process, not the CAD guess (an insert-molded part read as "Injection Moulded 100%")', () => {
    expect(partProcessBadge({ family: 'plastic_molded', confidence: 1 }, 'Assembly Molding')).toEqual({
      label: 'Assembly Molding', confidence: null, title: 'Chosen process. The CAD reads the geometry as Injection Moulded (100%).',
    });
  });

  it('falls back to the CAD family and its confidence when no process is chosen', () => {
    expect(partProcessBadge({ family: 'plastic_molded', confidence: 0.92 }, null)).toMatchObject({ label: 'Injection Moulded · 92%', confidence: 0.92 });
    expect(partProcessBadge(null, null)).toBeNull();
    expect(partProcessBadge(null, 'Machining')).toMatchObject({ label: 'Machining', title: 'Chosen process.' });
  });
});
