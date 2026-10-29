import fs from 'node:fs';
import path from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

// Policy as code for the monitoring stack (docs/ops/monitoring.md): what it may expose, what it may mount, and what a
// dashboard or alert may read. A failing test here is the reminder of why the rule was made.
const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), 'utf8');

interface Service {
  image?: string;
  read_only?: boolean;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  privileged?: boolean;
  profiles?: string[];
  ports?: string[];
  volumes?: string[];
  networks?: string[];
  environment?: Record<string, string>;
  command?: string[];
  depends_on?: unknown;
  healthcheck?: unknown;
  deploy?: { resources?: { limits?: { memory?: string } } };
}
const compose = yaml.load(read('docker-compose.monitoring.yml')) as { services: Record<string, Service>; volumes: Record<string, unknown> };
const services = Object.entries(compose.services);

describe('docker-compose.monitoring.yml', () => {
  it('pins every image by digest', () => {
    for (const [, s] of services) expect(s.image).toMatch(/@sha256:[0-9a-f]{64}$/);
  });

  it('is hardened like the app: read-only, no capabilities, no privilege escalation, limits and a healthcheck', () => {
    for (const [name, s] of services) {
      expect(s.read_only, name).toBe(true);
      expect(s.cap_drop, name).toEqual(['ALL']);
      expect(s.cap_add, name).toBeUndefined();
      expect(s.privileged, name).toBeUndefined();
      expect(s.security_opt, name).toContain('no-new-privileges:true');
      expect(s.deploy?.resources?.limits?.memory, name).toBeTruthy();
      expect(s.healthcheck, name).toBeTruthy();
    }
  });

  it('publishes exactly one port, Grafana, on the loopback interface only; Prometheus and the exporters are unreachable from outside', () => {
    const published = services.flatMap(([name, s]) => (s.ports ?? []).map((p) => [name, String(p)] as const));
    expect(published).toHaveLength(1);
    expect(published[0]?.[0]).toBe('grafana');
    expect(published[0]?.[1]).toMatch(/^127\.0\.0\.1:/);
  });

  it('never mounts the Docker socket, and only the host-metrics exporter (opt-in profile) mounts the host', () => {
    for (const [name, s] of services) {
      for (const volume of s.volumes ?? []) {
        expect(volume, name).not.toContain('docker.sock');
        const host = volume.split(':')[0] ?? '';
        const isHostPath = host.startsWith('/') || host.startsWith('.');
        if (isHostPath && name !== 'node-exporter') expect(volume, `${name} must mount config read-only`).toMatch(/:ro$/);
      }
    }
    expect(compose.services['node-exporter']?.profiles).toEqual(['host-metrics']);
  });

  it('keeps Prometheus off the edge network: only Grafana joins it, to be reachable through the tunnel', () => {
    expect(compose.services.prometheus?.networks).toEqual(['monitoring', 'app-internal']);
    expect(compose.services.blackbox?.networks).toEqual(['monitoring', 'app-internal']);
    expect(compose.services.grafana?.networks).toEqual(['monitoring', 'app-edge']);
  });

  it('turns anonymous access and sign-up off, and takes the admin password and secret key from the env file with no default', () => {
    const env = compose.services.grafana?.environment ?? {};
    expect(env.GF_AUTH_ANONYMOUS_ENABLED).toBe('false');
    expect(env.GF_USERS_ALLOW_SIGN_UP).toBe('false');
    expect(String(env.GF_SECURITY_ADMIN_PASSWORD)).toMatch(/^\$\{GRAFANA_ADMIN_PASSWORD:\?/);
    expect(String(env.GF_SECURITY_SECRET_KEY)).toMatch(/^\$\{GRAFANA_SECRET_KEY:\?/);
    expect(String(env.GRAFANA_PG_PASSWORD)).not.toMatch(/:-[^}]/); // no default password
  });

  it('caps what Prometheus keeps, by time and by size', () => {
    const args = (compose.services.prometheus?.command ?? []).join(' ');
    expect(args).toMatch(/retention\.time=/);
    expect(args).toMatch(/retention\.size=/);
    expect(args).toContain('--web.enable-otlp-receiver');
  });

  it('contains no secret value, only references to the env file', () => {
    const text = read('docker-compose.monitoring.yml');
    expect(text).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{20,}|sk-ant-|AIza[0-9A-Za-z_-]{20,}|supabase\.co/);
  });

  it('is fully described by the env templates: every required variable exists in both', () => {
    const required = [...new Set([...read('docker-compose.monitoring.yml').matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((m) => m[1]))];
    for (const template of ['env/stage.env.example', 'env/prd.env.example']) {
      const defined = new Set(read(template).split('\n').filter((l) => /^[A-Z]/.test(l)).map((l) => l.split('=')[0]));
      expect(required.filter((v) => !defined.has(v!)), template).toEqual([]);
    }
  });

  it('is not a dependency of the app: no app compose file mentions the monitoring services', () => {
    for (const file of ['docker-compose.prod.yml', 'docker-compose.yml']) {
      const appServices = Object.keys((yaml.load(read(file)) as { services: Record<string, unknown> }).services);
      expect(appServices.filter((n) => ['prometheus', 'grafana', 'blackbox', 'node-exporter'].includes(n)), file).toEqual([]);
      const dependsOnMonitoring = JSON.stringify(Object.values((yaml.load(read(file)) as { services: Record<string, { depends_on?: unknown }> }).services).map((x) => x.depends_on ?? null));
      expect(dependsOnMonitoring, file).not.toMatch(/prometheus|grafana|blackbox/);
    }
  });
});

describe('Grafana dashboards and rules', () => {
  const dashboardFiles = fs.readdirSync(path.resolve(root, 'monitoring/grafana/dashboards')).filter((f) => f.endsWith('.json'));
  type Target = { datasource?: { uid?: string }; expr?: string; rawSql?: string };
  type Panel = { type: string; title?: string; targets?: Target[]; panels?: Panel[] };
  const targets = dashboardFiles.flatMap((f) => {
    const d = JSON.parse(read(`monitoring/grafana/dashboards/${f}`)) as { panels: Panel[] };
    return d.panels.flatMap((p) => (p.targets ?? []).map((t) => ({ file: f, title: p.title, ...t })));
  });

  it('has the four dashboards, each a valid JSON document with a stable uid', () => {
    expect(dashboardFiles.sort()).toEqual(['application-performance.json', 'cad-and-costing.json', 'executive-kpi-overview.json', 'infrastructure-and-database.json']);
    const uids = dashboardFiles.map((f) => (JSON.parse(read(`monitoring/grafana/dashboards/${f}`)) as { uid: string }).uid);
    expect(new Set(uids).size).toBe(4);
  });

  it('queries only the two provisioned datasources', () => {
    for (const t of targets) expect(['prometheus', 'kpi-postgres'], `${t.file}: ${t.title}`).toContain(t.datasource?.uid);
  });

  it('never groups or filters a metric by an identifier (organization, user, item, file, request)', () => {
    for (const t of targets.filter((x) => x.expr)) expect(t.expr, `${t.file}: ${t.title}`).not.toMatch(/\b(org|organization|user|actor|item|file|bom|request_id|session|email)[a-z_]*\s*[=~!,)]/i);
  });

  it('reads only the aggregate kpi views from the database, never a base table', () => {
    for (const t of targets.filter((x) => x.rawSql)) {
      const tables = [...(t.rawSql ?? '').matchAll(/\b(?:from|join)\s+([a-z_.]+)/gi)].map((m) => m[1]);
      for (const table of tables) expect(table, `${t.file}: ${t.title}`).toMatch(/^kpi\./);
    }
  });

  it('every alert rule has a severity, a hold time, a summary and a response', () => {
    const doc = yaml.load(read('monitoring/prometheus/rules/alerts.yml')) as { groups: { rules: { alert: string; for?: string; labels?: { severity?: string }; annotations?: { summary?: string; response?: string } }[] }[] };
    const rules = doc.groups.flatMap((g) => g.rules);
    expect(rules.length).toBeGreaterThanOrEqual(10);
    for (const r of rules) {
      expect(r.labels?.severity, r.alert).toMatch(/^(warning|critical)$/);
      expect(r.for, `${r.alert} must wait, so a short spike does not fire it`).toBeTruthy();
      expect(r.annotations?.summary, r.alert).toBeTruthy();
      expect(r.annotations?.response, r.alert).toBeTruthy();
    }
  });
});
