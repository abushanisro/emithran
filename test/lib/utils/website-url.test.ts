import { describe, it, expect } from 'vitest';
import { normalizeWebsiteUrl } from '@/lib/utils/website-url';

describe('normalizeWebsiteUrl', () => {
  it('returns null for empty/missing values', () => {
    expect(normalizeWebsiteUrl(null)).toBeNull();
    expect(normalizeWebsiteUrl(undefined)).toBeNull();
    expect(normalizeWebsiteUrl('')).toBeNull();
    expect(normalizeWebsiteUrl('   ')).toBeNull();
  });

  it('returns null for known placeholder strings regardless of case', () => {
    expect(normalizeWebsiteUrl('Not Specified')).toBeNull();
    expect(normalizeWebsiteUrl('not specified')).toBeNull();
    expect(normalizeWebsiteUrl('N/A')).toBeNull();
    expect(normalizeWebsiteUrl('None')).toBeNull();
    expect(normalizeWebsiteUrl('TBD')).toBeNull();
    expect(normalizeWebsiteUrl('-')).toBeNull();
  });

  it('passes through a URL that already has a protocol', () => {
    expect(normalizeWebsiteUrl('https://acme.com')).toBe('https://acme.com');
    expect(normalizeWebsiteUrl('http://acme.com')).toBe('http://acme.com');
  });

  it('prepends https:// to a bare domain', () => {
    expect(normalizeWebsiteUrl('www.acme.com')).toBe('https://www.acme.com');
    expect(normalizeWebsiteUrl('acme.com')).toBe('https://acme.com');
    expect(normalizeWebsiteUrl('  acme.com  ')).toBe('https://acme.com');
  });

  it('returns null for free text that is not a domain (no dot, or contains spaces)', () => {
    expect(normalizeWebsiteUrl('Contact via phone only')).toBeNull();
    expect(normalizeWebsiteUrl('acme')).toBeNull();
  });
});
