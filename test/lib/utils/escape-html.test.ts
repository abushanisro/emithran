import { describe, expect, it } from 'vitest';

import { escapeHtml } from '@/lib/utils/escape-html';

// Regression (2026-10-27): part names, materials and delivery notes were
// written unescaped into innerHTML / print windows (generate-emithran-image,
// DeliveryOrderWorkflow, ScheduleView, BusinessCaseGenerator) — stored XSS in
// the app's own origin.
describe('escapeHtml', () => {
  it('turns a markup payload into inert text', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('cannot break out of a quoted attribute', () => {
    expect(escapeHtml(`x" onload='y`)).toBe('x&quot; onload=&#39;y');
  });

  it('escapes & first so entities are not double-decoded', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('renders null and undefined as empty text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});
