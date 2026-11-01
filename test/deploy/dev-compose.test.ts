import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

// The local development stack (docker-compose.yml). It is not hardened like docker-compose.prod.yml, so it must at least not be
// reachable from the network the developer's machine is on.
const text = fs.readFileSync(path.resolve(process.cwd(), 'docker-compose.yml'), 'utf8');
const compose = yaml.load(text) as {
  services: Record<string, { ports?: string[]; networks?: string[]; environment?: Record<string, string> }>;
  networks: Record<string, { internal?: boolean }>;
};

describe('docker-compose.yml (local development)', () => {
  it('publishes ports on loopback only', () => {
    for (const [name, s] of Object.entries(compose.services)) {
      for (const port of s.ports ?? []) expect(String(port), name).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('keeps the engines on an internal network: no route in from the host, none out to the internet', () => {
    expect(compose.networks['backend-network']?.internal).toBe(true);
    for (const name of ['cad-engine', 'ecad-engine']) {
      expect(compose.services[name]?.networks).toEqual(['backend-network']);
      expect(compose.services[name]?.ports).toBeUndefined();
    }
  });

  it('does not present itself as a production stack', () => {
    expect(text).not.toMatch(/production stack/i);
    // The backend refuses NODE_ENV=production with APP_ENV=local, the default here.
    expect(compose.services.backend?.environment?.NODE_ENV).toBe('${NODE_ENV:-development}');
  });
});
