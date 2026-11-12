import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { MaterialScopeToggle } from '@/components/features/manufacturing-intelligence/MaterialScopeToggle';

// The Material Database's process choice: two buttons, "<process> materials" and "All processes", the active one pressed.
const render = (scope: 'process' | 'all') =>
  renderToStaticMarkup(createElement(MaterialScopeToggle, { processGroup: 'Sand Casting', scope, onChange: vi.fn() }));

describe('Material Database process buttons', () => {
  it('shows both choices as buttons, the process one pressed by default', () => {
    const html = render('process');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Sand Casting materials<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>All processes<\/button>/);
    expect(html).not.toContain('<select');
  });

  it('marks "All processes" pressed when chosen', () => {
    const html = render('all');
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Sand Casting materials<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>All processes<\/button>/);
  });
});
