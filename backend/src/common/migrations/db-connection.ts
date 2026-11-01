import * as fs from 'fs';

// Connection settings for the operator scripts (migrate, should-cost-calibrate) that talk to a database directly.
//
// node-postgres lets TLS parameters in the URL (sslmode, sslrootcert, ...) replace the `ssl` option passed beside it, so
// `?sslmode=require` silently discarded the CA given in MIGRATE_DATABASE_SSL_CA and verified the server against Node's
// built-in roots instead ("self-signed certificate in certificate chain" on Supabase, RDS, ...). TLS is therefore taken
// from these settings only: the URL's TLS parameters are removed, except sslmode=disable, which still turns TLS off.

const URL_TLS_PARAMS = ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type TlsSettings = false | { rejectUnauthorized: boolean; ca?: string };

/**
 * The client config for `databaseUrl`. Local hosts and sslmode=disable connect without TLS. Anywhere else TLS is used; with
 * `ca` (the provider's CA certificate, PEM) the server is verified against it, without it the link is encrypted but the
 * server is not authenticated.
 */
export function databaseClientConfig(databaseUrl: string, ca?: string): { connectionString: string; ssl: TlsSettings } {
  const url = new URL(databaseUrl);
  const disabled = url.searchParams.get('sslmode') === 'disable';
  for (const name of URL_TLS_PARAMS) url.searchParams.delete(name);
  const ssl: TlsSettings =
    disabled || LOCAL_HOSTS.has(url.hostname) ? false : ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: false };
  return { connectionString: url.toString(), ssl };
}

/** The provider CA certificate named by MIGRATE_DATABASE_SSL_CA (a file path) in the env file, or in the process environment. */
export function caCertificate(settings: Record<string, string | undefined>): string | undefined {
  const file = settings.MIGRATE_DATABASE_SSL_CA ?? process.env.MIGRATE_DATABASE_SSL_CA;
  return file ? fs.readFileSync(file, 'utf8') : undefined;
}
