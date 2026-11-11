import { describe, expect, it } from 'vitest';

import { processChoiceConflict } from '@/lib/features/process-group';

describe('processChoiceConflict', () => {
  it('uses the same words as the backend, so the nest message and the panels agree', () => {
    expect(processChoiceConflict({ family: 'sheet_metal', geometricFamily: 'milled' })).toBe(
      "This part's Process is Sheet Metal, but its geometry reads as Machining (milled). Set its Process to Machining; reanalyzing as Sheet Metal will not change this.",
    );
  });
  it('is null when there is nothing to tell', () => {
    expect(processChoiceConflict({ family: 'milled', geometricFamily: 'mill_turn' })).toBeNull();
    expect(processChoiceConflict({ family: 'sheet_metal' })).toBeNull();
    expect(processChoiceConflict(null)).toBeNull();
  });
});
