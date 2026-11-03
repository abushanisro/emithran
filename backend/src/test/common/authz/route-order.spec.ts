// Routing order: Express runs the first route that matches, so a ':id' route declared before a static route of the same shape
// swallows it (GET :id/file-url/:fileType hid GET :id/file-url/dxf). This test refuses, for every controller:
//   * a parameter route declared before a static route it would match (declare the static route first), and
//   * two handlers for the same method and path (one is dead, or worse, the wrong one answers).
// The route inventory test (route-policies.spec.ts) lists the routes; this one checks their order.
import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';

const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return entry.name.endsWith('.controller.ts') ? [full] : [];
  });
}

type Ctor = (abstract new (...args: never[]) => unknown) & { prototype: Record<string, unknown> };
interface Route { method: string; segments: string[]; label: string; order: number; controller: string }

const split = (...parts: Array<string | undefined>) => parts.flatMap((p) => (p ?? '').split('/')).filter(Boolean);

function routesOf(controller: Ctor): Route[] {
  const base: string[] = [Reflect.getMetadata(PATH_METADATA, controller)].flat();
  const classVersion: unknown = Reflect.getMetadata(VERSION_METADATA, controller);
  const out: Route[] = [];
  let order = 0;
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
    if (typeof handler !== 'function' || name === 'constructor') continue;
    const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
    const raw = Reflect.getMetadata(PATH_METADATA, handler);
    if (method === undefined || raw === undefined) continue;
    const version = [Reflect.getMetadata(VERSION_METADATA, handler) ?? classVersion ?? '1'].flat()
      .map((v: unknown) => (typeof v === 'string' ? `v${v}` : ''))[0];
    for (const b of base) {
      for (const p of [raw].flat()) {
        const segments = split(version, b, p);
        out.push({ method: RequestMethod[method], segments, label: `${RequestMethod[method]} /${segments.join('/')} (${controller.name}.${name})`, order: order++, controller: controller.name });
      }
    }
  }
  return out;
}

const controllers: Ctor[] = sourceFiles(SRC).flatMap((file) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Object.values(require(file) as Record<string, unknown>).filter(
    (v): v is Ctor => typeof v === 'function' && Reflect.getMetadata(PATH_METADATA, v) !== undefined,
  ),
);

const isParam = (s: string) => s.startsWith(':') || s.includes('*');
/** Would route `p` (earlier) answer every request meant for `s` (later), because `p` has a parameter where `s` has a fixed word? */
const shadows = (p: Route, s: Route) =>
  p.method === s.method
  && p.segments.length === s.segments.length
  && p.segments.every((seg, i) => isParam(seg) || seg === s.segments[i])
  && p.segments.some((seg, i) => isParam(seg) && !isParam(s.segments[i]));

describe('route order', () => {
  const byController = controllers.map((c) => routesOf(c));

  it('no parameter route is declared before a static route it would match', () => {
    const problems: string[] = [];
    for (const routes of byController) {
      for (const p of routes) {
        for (const s of routes.filter((r) => r.order > p.order)) {
          if (shadows(p, s)) problems.push(`${p.label} is declared before ${s.label} and swallows it`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('no two handlers answer the same method and path', () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const r of byController.flat()) {
      const key = `${r.method} /${r.segments.map((s) => (isParam(s) ? ':' : s)).join('/')}`;
      const other = seen.get(key);
      if (other) problems.push(`${r.label} duplicates ${other}`);
      else seen.set(key, r.label);
    }
    expect(problems).toEqual([]);
  });
});
