// The first article inspection (formula registry F-39): a one-off per part number on the CMM, from the CMM Inspection model of memory/Secondary process.
import { FIRST_ARTICLE_PARTS, firstArticleInspection } from '../../../../../modules/bom-items/costing/secondary/secondary-process-engine';
import { firstArticleSummary } from '../../../../../modules/bom-items/costing/secondary/first-article';

describe('firstArticleSummary', () => {
  const costed = { status: 'costed' as const, reason: '', costPerPartUsd: 120, machine: { name: 'Axiom Too 1200' } as never, trace: [{ label: 'Probe touches per part', value: 40, source: '' }] };

  it('is a one-off spread over the job only for display, with the touches and parts measured', () => {
    expect(firstArticleSummary(costed, 10_000, 5)).toEqual({
      costUsd: 120, perPartUsd: 0.0024, machineName: 'Axiom Too 1200',
      detail: `40 probe touches: the CMM program written once and ${FIRST_ARTICLE_PARTS} first-run parts measured in full, with the CMM setup.`,
    });
  });

  it('has no per-part share without a volume, and says why it is not priced', () => {
    expect(firstArticleSummary(costed, null, 5).perPartUsd).toBeNull();
    expect(firstArticleSummary({ ...costed, status: 'gap' as never, costPerPartUsd: null, reason: 'No CMM machine on file for this location.' }, 100, 1))
      .toMatchObject({ costUsd: null, detail: 'Not priced: No CMM machine on file for this location.' });
  });
});

describe('firstArticleInspection', () => {
  it('names the gap when the CMM reference is not staged', () => {
    const r = firstArticleInspection({ features: [], holeCount: null } as never, { variables: new Map(), lookups: new Map(), defaultMachine: new Map() } as never, []);
    expect(r).toMatchObject({ process: 'First Article Inspection', status: 'gap' });
  });
});
