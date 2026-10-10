import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CAD_EVIDENCE_BY_FIELD, cadEvidenceKeyFor } from '@/lib/features/cad-evidence-fields';

describe('cadEvidenceKeyFor', () => {
  it('names the CAD quantity only for a CAD-sourced value', () => {
    expect(cadEvidenceKeyFor('Cutting Length', 'CAD feature extraction — total cut path length')).toBe('cut_length');
    expect(cadEvidenceKeyFor('No Of Starts', 'CAD feature extraction — pierce/start count')).toBe('pierce_count');
    expect(cadEvidenceKeyFor('Cutting Length', 'Entered in the calculator')).toBeUndefined();
    expect(cadEvidenceKeyFor('Cutting Speed', 'CAD feature extraction')).toBeUndefined();
    expect(cadEvidenceKeyFor('Cutting Length', undefined)).toBeUndefined();
  });

  it('is identical to the backend table (no drift between the two ends)', () => {
    const source = readFileSync(
      resolve(__dirname, '../../../backend/src/modules/bom-items/costing/shared/cad-evidence.ts'), 'utf-8',
    );
    const table = source.slice(source.indexOf('EVIDENCE_BY_FIELD'));
    const backend = Object.fromEntries(
      [...table.matchAll(/'([^']+)':\s*'([a-z_]+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(backend).toEqual(CAD_EVIDENCE_BY_FIELD);
  });
});
