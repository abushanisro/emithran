/**
 * Resolves the Echo API base URL. Mirrors the convention used by
 * `lib/api/config.ts` so Echo follows the same gateway/proxy rules as the
 * rest of the platform.
 *
 * The backend mounts the EchoController at `api/echo` with version 1, so
 * the public path is `<gateway>/v1/api/echo/...`.
 */

export function getEchoBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_GATEWAY_URL;
  const base = fromEnv && fromEnv.length > 0 ? fromEnv : 'http://localhost:4000/v1/api';
  // Accept either the gateway root or the v1/api root — normalise to v1/api/echo
  if (/\/v\d+\/api\/?$/.test(base)) return `${base.replace(/\/$/, '')}/echo`;
  return `${base.replace(/\/$/, '')}/v1/api/echo`;
}
