import { formatTurn } from './context-formatter';

describe('formatTurn', () => {
  it('embeds the page route, entity snapshot, and question', () => {
    const out = formatTurn({
      pageContext: { route: '/projects/p-1/bom/item-1' },
      snapshot: {
        entityType: 'bom_item',
        entityId: 'item-1',
        data: { partName: 'Bearing Housing', totalCost: 2500 },
      },
      userMessage: 'Why is this expensive?',
    });
    expect(out).toContain('/projects/p-1/bom/item-1');
    expect(out).toContain('bom_item');
    expect(out).toContain('Bearing Housing');
    expect(out).toContain('Why is this expensive?');
  });

  it('escapes html-significant characters in route and entity id', () => {
    const out = formatTurn({
      pageContext: { route: '/foo<bar>' },
      snapshot: {
        entityType: 'bom_item',
        entityId: '<id>',
        data: { x: 1 },
      },
      userMessage: 'q',
    });
    expect(out).toContain('&lt;');
    expect(out).not.toContain('<bar>');
  });

  it('truncates dom snippet at 2000 chars', () => {
    const big = 'x'.repeat(5000);
    const out = formatTurn({
      pageContext: { route: '/x' },
      snapshot: null,
      domSnippet: { text: big },
      userMessage: 'q',
    });
    // The snippet section should not contain more than ~2000 'x' characters
    const match = out.match(/<user-visible-content>([\s\S]*?)<\/user-visible-content>/);
    expect(match).not.toBeNull();
    expect(match![1].trim().length).toBeLessThanOrEqual(2000);
  });

  it('omits the snippet block when no DOM snippet is supplied', () => {
    const out = formatTurn({
      pageContext: { route: '/x' },
      snapshot: null,
      userMessage: 'q',
    });
    expect(out).not.toContain('user-visible-content');
  });

  it('embeds breadcrumbs when provided', () => {
    const out = formatTurn({
      pageContext: { route: '/x', breadcrumbs: ['Project A', 'BOM'] },
      snapshot: null,
      userMessage: 'q',
    });
    expect(out).toContain('Project A');
    expect(out).toContain('BOM');
  });
});
