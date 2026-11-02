import { clientIp, clientIpSettings, signForwardedClientIp, trustProxySetting } from './client-ip';

const request = (headers: Record<string, string | string[]> = {}, ip = '172.18.0.5') => ({ headers, ip });
const cloudflare = { trustCloudflareHeaders: true };
const none = { trustCloudflareHeaders: false };

const SECRET = 'a-shared-secret-of-at-least-32-characters';
const NOW = 1_800_000_000;
const bff = { trustCloudflareHeaders: false, bffForwardSecret: SECRET, nowSeconds: () => NOW };
const forwarded = (ip: string, signature = signForwardedClientIp(SECRET, ip, NOW)) =>
  request({ 'x-emithran-client-ip': ip, 'x-emithran-client-ip-signature': signature });

describe('clientIp', () => {
  it('uses the peer address by default, so a forged header changes nothing', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.9' }), none)).toBe('172.18.0.5');
  });

  it('uses the real client address from Cloudflare when the deployment trusts it', () => {
    expect(clientIp(request({ 'cf-connecting-ip': '203.0.113.9' }), cloudflare)).toBe('203.0.113.9');
    expect(clientIp(request({ 'cf-connecting-ip': '2001:db8::1' }), cloudflare)).toBe('2001:db8::1');
  });

  it('ignores a trusted header that is not an IP address, so it cannot inject a key or a log line', () => {
    for (const bad of ['', 'not-an-ip', '1.2.3.4, 5.6.7.8', "1.2.3.4\nX-Forged: 1", '999.1.1.1']) {
      expect(clientIp(request({ 'cf-connecting-ip': bad }), cloudflare)).toBe('172.18.0.5');
    }
  });

  it('falls back through the socket to a placeholder, never throwing', () => {
    expect(clientIp({ headers: {}, socket: { remoteAddress: '10.0.0.2' } }, cloudflare)).toBe('10.0.0.2');
    expect(clientIp({}, cloudflare)).toBe('unknown');
  });

  it('reads its settings from the environment when not told', () => {
    expect(clientIpSettings({ TRUST_CLOUDFLARE_HEADERS: 'true', BFF_FORWARD_SECRET: SECRET })).toEqual({ trustCloudflareHeaders: true, bffForwardSecret: SECRET });
    expect(clientIpSettings({})).toEqual({ trustCloudflareHeaders: false, bffForwardSecret: undefined });
  });
});

describe('clientIp behind the BFF (address forwarded with an HMAC)', () => {
  it('matches the BFF\'s signature format (same vector as test/lib/server/bff/forward.test.ts)', () => {
    expect(signForwardedClientIp(SECRET, '203.0.113.7', NOW)).toBe('1800000000.d8520f7e2398d5c93fea926eb6d44339f2b30d7caeabf60e25dfabc5fce79401');
  });

  it('uses the forwarded address when the signature verifies', () => {
    expect(clientIp(forwarded('203.0.113.7'), bff)).toBe('203.0.113.7');
    expect(clientIp(forwarded('2001:db8::7'), bff)).toBe('2001:db8::7');
  });

  it('uses the peer address when the signature is missing, wrong, for another address, or made with another secret', () => {
    expect(clientIp(request({ 'x-emithran-client-ip': '203.0.113.7' }), bff)).toBe('172.18.0.5');
    expect(clientIp(forwarded('203.0.113.7', `${NOW}.${'0'.repeat(64)}`), bff)).toBe('172.18.0.5');
    expect(clientIp(forwarded('203.0.113.7', signForwardedClientIp(SECRET, '203.0.113.8', NOW)), bff)).toBe('172.18.0.5');
    expect(clientIp(forwarded('203.0.113.7', signForwardedClientIp('another-secret-of-at-least-32-chars!!', '203.0.113.7', NOW)), bff)).toBe('172.18.0.5');
    expect(clientIp(forwarded('203.0.113.7', 'garbage'), bff)).toBe('172.18.0.5');
  });

  it('refuses a stale signature, so a captured one cannot be replayed later', () => {
    expect(clientIp(forwarded('203.0.113.7', signForwardedClientIp(SECRET, '203.0.113.7', NOW - 61)), bff)).toBe('172.18.0.5');
    expect(clientIp(forwarded('203.0.113.7', signForwardedClientIp(SECRET, '203.0.113.7', NOW - 30)), bff)).toBe('203.0.113.7');
  });

  it('never trusts a forwarded address without a configured secret', () => {
    expect(clientIp(forwarded('203.0.113.7'), none)).toBe('172.18.0.5');
  });

  it('refuses a signed value that is not an address', () => {
    const bad = '1.2.3.4\nX-Forged: 1';
    expect(clientIp(forwarded(bad), bff)).toBe('172.18.0.5');
  });
});

describe('trustProxySetting', () => {
  it('is an explicit hop count or proxy list, trusting nothing by default', () => {
    expect(trustProxySetting(undefined)).toBe(0);
    expect(trustProxySetting('1')).toBe(1);
    expect(trustProxySetting('10.0.0.0/8, 172.16.0.1')).toEqual(['10.0.0.0/8', '172.16.0.1']);
  });

  it.each(['true', 'yes', '10.0.0.0/33', 'loopback', '1.2.3.4/8/1'])('refuses %s', (bad) => {
    expect(() => trustProxySetting(bad)).toThrow(/TRUST_PROXY/);
  });
});
