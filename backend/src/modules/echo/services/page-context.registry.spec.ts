import { lookupRoute } from './page-context.registry';

describe('PageContextRegistry.lookupRoute', () => {
  it('matches /projects/:id/bom variants', () => {
    expect(lookupRoute('/projects/p-1/bom')?.displayName).toBe('BOM editor');
    expect(lookupRoute('/projects/p-1/bom/item-1')?.displayName).toBe('BOM editor');
  });

  it('matches process planning', () => {
    expect(lookupRoute('/projects/p-1/process-planning')?.displayName).toBe('Process planning');
  });

  it('returns null for unknown routes', () => {
    expect(lookupRoute('/something/else')).toBeNull();
    expect(lookupRoute('')).toBeNull();
    expect(lookupRoute(null)).toBeNull();
  });

  it('returns project entry for /projects/:id (not deeper)', () => {
    const entry = lookupRoute('/projects/p-1');
    expect(entry?.displayName).toBe('Project');
  });

  it('prefers a more specific match over a parent', () => {
    const bom = lookupRoute('/projects/p-1/bom');
    const project = lookupRoute('/projects/p-1');
    expect(bom?.displayName).toBe('BOM editor');
    expect(project?.displayName).toBe('Project');
  });

  it('every registered entry exposes at least one suggestion', () => {
    const candidates = [
      '/projects/p/bom',
      '/projects/p/process-planning',
      '/projects/p/supplier-nomination',
      '/projects/p/rfq',
      '/projects/p/production-planning',
      '/raw-materials',
      '/vave',
      '/projects/p',
    ];
    for (const r of candidates) {
      const entry = lookupRoute(r);
      expect(entry).not.toBeNull();
      expect(entry!.suggestions.length).toBeGreaterThan(0);
    }
  });
});
