import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CalculationTracePanel } from '@/components/features/process-planning/CalculationTracePanel';
import type { PhysicsGap } from '@/lib/api/hooks/useBOMItems';

const html = (gap: PhysicsGap) => renderToStaticMarkup(createElement(CalculationTracePanel, { line: { physicsGap: gap } }));
const base = { gapType: 'unsupported_operation' as const, process: 'Injection Molding', machineClass: 'injection_molding', reason: 'Cycle time not derivable.' };

describe('the required action of an unsupported-operation gap', () => {
  it('shows the action the engine gives when it is not engineering work (migrations to apply)', () => {
    const out = html({ ...base, requiredCapability: 'Cycle time', requiredAction: 'Apply migrations 975 and 976 to this database (npm run db:migrate).' });
    expect(out).toContain('Apply migrations 975 and 976 to this database (npm run db:migrate).');
    expect(out).not.toContain('an engineering task');
    expect(out).not.toContain('needs new calculator capability');
  });

  it('keeps the engineering-task wording for a gap that is one', () => {
    const out = html({ ...base, requiredCapability: 'Cycle time (material thermal data + press timing)' });
    expect(out).toContain('this process needs new calculator capability (Cycle time (material thermal data + press timing)) — an engineering task, not a missing data row.');
  });
});
