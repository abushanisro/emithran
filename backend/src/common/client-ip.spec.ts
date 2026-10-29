import { clientIp } from './client-ip';

const request = (headers: Record<string, string | string[]> = {}, ip = '172.18.0.5') => ({ headers, ip });

describe('clientIp', () => {
  it('uses the peer address by default, so a forged header changes nothing', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.9' }), false)).toBe('172.18.0.5');
  });

  it('uses the real client address from Cloudflare when the deployment trusts it', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.9' }), true)).toBe('203.0.113.9');
    expect(clientIp(request({ 'cf-connecting-ip': '2001:db8::1' }), true)).toBe('2001:db8::1');
  });

  it('ignores a trusted header that is not an IP address, so it cannot inject a key or a log line', () => {
    for (const bad of ['', 'not-an-ip', '1.2.3.4, 5.6.7.8', "1.2.3.4\nX-Forged: 1", '999.1.1.1']) {
      expect(clientIp(request({ 'cf-connecting-ip': bad }), true)).toBe('172.18.0.5');
    }
  });

  it('falls back through the socket to a placeholder, never throwing', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.2' } }, true)).toBe('10.0.0.2');
    expect(clientIp({}, true)).toBe('unknown');
  });

  it('reads the flag from TRUST_CLOUDFLARE_HEADERS when not told', () => {
    const before = process.env.TRUST_CLOUDFLARE_HEADERS;
    process.env.TRUST_CLOUDFLARE_HEADERS = 'true';
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    process.env.TRUST_CLOUDFLARE_HEADERS = 'false';
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('172.18.0.5');
    if (before === undefined) delete process.env.TRUST_CLOUDFLARE_HEADERS;
    else process.env.TRUST_CLOUDFLARE_HEADERS = before;
  });
});
