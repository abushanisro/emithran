import { deprecationHeaders } from './api-v1';

describe('deprecationHeaders', () => {
  it('sends the deprecation date as an RFC 9745 structured date, not a boolean', () => {
    expect(deprecationHeaders({})).toEqual({ deprecation: '@1793664000' }); // 2026-11-03T00:00:00Z
    expect(deprecationHeaders({ LEGACY_API_DEPRECATED_AT: '2027-01-01' }).deprecation).toBe('@1798761600');
  });

  it('formats the sunset as an RFC 8594 HTTP-date whatever form the date was given in', () => {
    expect(deprecationHeaders({ LEGACY_API_SUNSET: '2027-06-30' }).sunset).toBe('Wed, 30 Jun 2027 00:00:00 GMT');
    expect(deprecationHeaders({ LEGACY_API_SUNSET: 'Wed, 30 Jun 2027 00:00:00 GMT' }).sunset).toBe('Wed, 30 Jun 2027 00:00:00 GMT');
  });

  it('has no sunset unless one is announced', () => {
    expect(deprecationHeaders({}).sunset).toBeUndefined();
  });

  it('passes the documentation URL through', () => {
    expect(deprecationHeaders({ API_DEPRECATION_DOCS_URL: 'https://docs.example.com/deprecations/v1' }).docs).toBe('https://docs.example.com/deprecations/v1');
  });

  it.each([
    [{ LEGACY_API_DEPRECATED_AT: 'soon' }, /not a date/],
    [{ LEGACY_API_SUNSET: 'next year' }, /not a date/],
    [{ LEGACY_API_SUNSET: '2026-01-01' }, /before the deprecation date/],
    [{ API_DEPRECATION_DOCS_URL: 'http://docs.example.com' }, /https URL/],
    [{ API_DEPRECATION_DOCS_URL: 'javascript:alert(1)' }, /https URL/],
  ])('refuses a wrong setting at start: %j', (env, message) => {
    expect(() => deprecationHeaders(env)).toThrow(message);
  });
});
