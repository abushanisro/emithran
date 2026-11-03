// Route inventory: every HTTP route of the API declares who may call it (common/authz/authz-policy.ts). AuthzGuard refuses a
// route without a policy at runtime; this test refuses it before merge, and its snapshot (__snapshots__/route-policies.spec.ts.snap)
// is the reviewed table of every route and its policy, so a change of access shows up as a diff. After an intended change:
//   npx jest src/test/common/authz/route-policies.spec.ts -u
import * as fs from 'fs';
import * as path from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';

import { describeAuthzPolicy, resolveAuthzPolicy } from '../../../common/authz/authz-policy';

const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' || entry.name === 'node_modules' ? [] : sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [full] : [];
  });
}

type Ctor = (abstract new (...args: never[]) => unknown) & { prototype: Record<string, unknown> };

const join = (...parts: Array<string | undefined>) =>
  '/' + parts.flatMap((p) => (p ?? '').split('/')).filter(Boolean).join('/');

function routesOf(controller: Ctor): Array<{ route: string; policy: string }> {
  const reflector = new Reflector();
  const base: string[] = [Reflect.getMetadata(PATH_METADATA, controller)].flat();
  const classVersion: unknown = Reflect.getMetadata(VERSION_METADATA, controller);
  const rows: Array<{ route: string; policy: string }> = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
    if (typeof handler !== 'function' || name === 'constructor') continue;
    const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
    const paths: string[] | undefined = Reflect.getMetadata(PATH_METADATA, handler) === undefined
      ? undefined
      : [Reflect.getMetadata(PATH_METADATA, handler)].flat();
    if (method === undefined || paths === undefined) continue;
    // A version is a string, a list of them, or VERSION_NEUTRAL (a symbol: no version prefix); none means main.ts's default, 1.
    const versions = [Reflect.getMetadata(VERSION_METADATA, handler) ?? classVersion ?? '1'].flat()
      .map((v: unknown) => (typeof v === 'string' ? `v${v}` : undefined));
    const policy = describeAuthzPolicy(resolveAuthzPolicy(reflector, handler, controller));
    for (const v of versions) {
      for (const b of base) {
        // the global prefix `api` (common/http/api-prefix.ts), except for the two liveness routes of AppController at the root
        for (const p of paths) rows.push({ route: `${RequestMethod[method]} ${controller.name === 'AppController' ? join(v, b, p) : join('api', v, b, p)}  ${controller.name}.${name}`, policy });
      }
    }
  }
  return rows;
}

const controllerFiles = sourceFiles(SRC).filter((f) => f.endsWith('.controller.ts'));
const controllers: Ctor[] = controllerFiles.flatMap((file) =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Object.values(require(file) as Record<string, unknown>).filter(
    (v): v is Ctor => typeof v === 'function' && Reflect.getMetadata(PATH_METADATA, v) !== undefined,
  ),
);
const routes = controllers.flatMap(routesOf).sort((a, b) => a.route.localeCompare(b.route));

describe('route authorization inventory', () => {
  it('finds every controller: @Controller is only used in *.controller.ts files', () => {
    const elsewhere = sourceFiles(SRC).filter((f) => !f.endsWith('.controller.ts') && /@Controller\(/.test(fs.readFileSync(f, 'utf8')));
    expect(elsewhere.map((f) => path.relative(SRC, f))).toEqual([]);
    expect(controllers.length).toBeGreaterThanOrEqual(controllerFiles.length);
  });

  it('every route declares a policy', () => {
    expect(routes.filter((r) => r.policy === 'NONE').map((r) => r.route)).toEqual([]);
  });

  it('matches the reviewed route-policy table', () => {
    expect(routes.map((r) => `${r.policy.padEnd(15)} ${r.route}`).join('\n')).toMatchSnapshot();
  });
});
