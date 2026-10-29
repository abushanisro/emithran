import { sessionKeyFromAuth0Sid } from './session-key';

describe('sessionKeyFromAuth0Sid', () => {
  it('is a stable uuid per sid and differs between sids', () => {
    const a = sessionKeyFromAuth0Sid('abc');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sessionKeyFromAuth0Sid('abc')).toBe(a);
    expect(sessionKeyFromAuth0Sid('abd')).not.toBe(a);
  });
});
