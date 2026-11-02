import { Client } from 'pg';

import { databaseClientConfig } from './db-connection';

const remote = 'postgresql://user:p%2Fw%3A1@db.example.com:5432/postgres';

describe('databaseClientConfig', () => {
  it('keeps the CA when the URL says sslmode=require (the URL used to replace it)', () => {
    const config = databaseClientConfig(`${remote}?sslmode=require`, 'PEM');
    expect(config.ssl).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
    expect(config.connectionString).toBe(remote);
    // What node-postgres actually ends up with once it has parsed the URL too.
    expect((new Client(config) as unknown as { ssl: unknown }).ssl).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
  });

  it('encrypts without verifying when no CA is given', () => {
    expect(databaseClientConfig(`${remote}?sslmode=verify-full`).ssl).toEqual({ rejectUnauthorized: false });
  });

  it('connects without TLS to a local host or with sslmode=disable', () => {
    expect(databaseClientConfig('postgres://postgres:postgres@127.0.0.1:54322/postgres', 'PEM').ssl).toBe(false);
    expect(databaseClientConfig(`${remote}?sslmode=disable`, 'PEM').ssl).toBe(false);
  });

  it('keeps the other URL parameters and the encoded password', () => {
    const config = databaseClientConfig(`${remote}?sslmode=require&application_name=migrate&sslrootcert=/x.crt`);
    expect(config.connectionString).toBe(`${remote}?application_name=migrate`);
  });
});
