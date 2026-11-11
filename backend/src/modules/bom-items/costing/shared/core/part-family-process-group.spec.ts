import { processChoiceConflict } from './part-family-process-group';

describe('processChoiceConflict', () => {
  it('names the Process the geometry calls for when the chosen one disagrees', () => {
    expect(processChoiceConflict({ family: 'sheet_metal', geometricFamily: 'milled' })).toBe(
      "This part's Process is Sheet Metal, but its geometry reads as Machining (milled). Set its Process to Machining; reanalyzing as Sheet Metal will not change this.",
    );
  });

  it('says nothing when they agree, are of one process group, or either is unknown', () => {
    expect(processChoiceConflict({ family: 'sheet_metal', geometricFamily: 'sheet_metal' })).toBeNull();
    expect(processChoiceConflict({ family: 'milled', geometricFamily: 'turned' })).toBeNull(); // both Machining
    expect(processChoiceConflict({ family: 'sheet_metal' })).toBeNull(); // an analysis from an older engine
    expect(processChoiceConflict({ family: 'sheet_metal', geometricFamily: 'something_new' })).toBeNull();
    expect(processChoiceConflict(undefined)).toBeNull();
  });
});
