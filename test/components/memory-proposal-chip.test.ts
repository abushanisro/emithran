import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MemoryProposalChip } from '@/components/features/manufacturing-intelligence/CopilotPanel';

const base = {
  proposalId: '00000000-0000-4000-8000-0000000000a1',
  add: ['show costs per 1000 parts'],
  remove: [] as string[],
  expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  turn: 1,
  status: 'pending' as const,
};
const html = (proposal: Parameters<typeof MemoryProposalChip>[0]['proposal']) =>
  renderToStaticMarkup(createElement(MemoryProposalChip, { proposal, onSave: () => undefined, onDismiss: () => undefined }));

describe('copilot memory proposal chip', () => {
  it('asks before saving: shows the change with Save and Dismiss', () => {
    const out = html(base);
    expect(out).toContain('Save to copilot memory?');
    expect(out).toContain('+ show costs per 1000 parts');
    expect(out).toContain('>Save<');
    expect(out).toContain('>Dismiss<');
  });

  it('offers no Save once the proposal has expired, was dismissed or saved', () => {
    expect(html({ ...base, expiresAt: new Date(Date.now() - 1000).toISOString() })).not.toContain('>Save<');
    expect(html({ ...base, status: 'dismissed' })).toContain('nothing was saved');
    expect(html({ ...base, status: 'saved' })).not.toContain('>Dismiss<');
  });

  it('renders proposed text as text, never markup', () => {
    expect(html({ ...base, add: ['<img src=x onerror=alert(1)>'] })).not.toContain('<img');
  });
});
