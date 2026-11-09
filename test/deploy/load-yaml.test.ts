import { describe, expect, it } from 'vitest';

import { loadYaml } from './load-yaml';

describe('loadYaml', () => {
  it('expands a YAML merge key, so a service inherits the settings it shares', () => {
    const doc = loadYaml('x-hardened: &hardened\n  read_only: true\n  cap_drop: [ALL]\nservices:\n  api:\n    <<: *hardened\n    image: api\n') as {
      services: { api: Record<string, unknown> };
    };
    expect(doc.services.api).toEqual({ read_only: true, cap_drop: ['ALL'], image: 'api' });
  });

  it('keeps a key the service sets itself over the shared one', () => {
    const doc = loadYaml('base: &b\n  restart: always\nservices:\n  api:\n    <<: *b\n    restart: "no"\n') as { services: { api: { restart: string } } };
    expect(doc.services.api.restart).toBe('no');
  });

  it('reads a workflow\'s `on:` key as the text "on", not a boolean', () => {
    expect(Object.keys(loadYaml('on:\n  push: {}\n') as object)).toEqual(['on']);
  });
});
