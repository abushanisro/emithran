import { readFileSync } from 'fs';
import { join } from 'path';

// OrganizationContextGuard is applied per route, not globally. A route that reads @CurrentOrganization() without it gets undefined, and what it
// writes carries no organization (the first Apply Scenario failed on exactly that: "new row violates row-level security policy").
describe('BOMItemsController: every route that reads the organization is guarded', () => {
  const source = readFileSync(join(__dirname, '..', '..', '..', 'modules', 'bom-items', 'bom-items.controller.ts'), 'utf8');
  // each member is the text up to its closing brace at class level: its decorators, in any order, and its body. The class carries no guard of its own.
  const routes = source.split(/\n  }\n/).filter((chunk) => /@(?:Get|Post|Put|Patch|Delete)\(/.test(chunk));

  it('finds the routes it checks', () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(source).not.toMatch(/@UseGuards\(OrganizationContextGuard\)\s*\n@ApiTags/); // not a class-level guard
    expect(routes.filter((r) => r.includes('@CurrentOrganization()')).length).toBeGreaterThanOrEqual(3);
  });

  it.each(routes.filter((r) => r.includes('@CurrentOrganization()')).map((r) => [(/async (\w+)\(/.exec(r)?.[1] ?? '?'), r]))(
    '%s has @UseGuards(OrganizationContextGuard)',
    (_name, route) => {
      const header = route.slice(0, route.indexOf('async '));
      expect(header).toContain('@UseGuards(OrganizationContextGuard)');
    },
  );
});
