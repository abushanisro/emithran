import { describe, expect, it } from 'vitest';

import { isAllowedOrigin } from '@/lib/server/bff/origin';

const APP = 'https://app.example.com';
const request = (method: string, origin?: string) =>
  new Request(`${APP}/api/v1/projects`, { method, headers: origin ? { origin } : {} });

describe('isAllowedOrigin', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])('lets a safe %s through from anywhere', (method) => {
    expect(isAllowedOrigin(request(method), APP)).toBe(true);
    expect(isAllowedOrigin(request(method, 'https://evil.example'), APP)).toBe(true);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('allows %s only from the app origin', (method) => {
    expect(isAllowedOrigin(request(method, APP), APP)).toBe(true);
    expect(isAllowedOrigin(request(method, 'https://evil.example'), APP)).toBe(false);
    expect(isAllowedOrigin(request(method, 'https://app.example.com.evil.example'), APP)).toBe(false);
    expect(isAllowedOrigin(request(method, 'null'), APP)).toBe(false);
  });

  it('refuses an unsafe method that carries no Origin', () => {
    expect(isAllowedOrigin(request('POST'), APP)).toBe(false);
  });

  it('compares origins, not strings, so a trailing slash or path in the setting does not matter', () => {
    expect(isAllowedOrigin(request('POST', APP), `${APP}/`)).toBe(true);
  });
});
