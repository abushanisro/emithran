import { describe, expect, it } from 'vitest';

import { statusToneClasses } from '@/components/common/status-badge';

describe('StatusBadge tones', () => {
  it('builds every tone from theme tokens, never raw palette colours', () => {
    for (const classes of Object.values(statusToneClasses)) {
      expect(classes).not.toMatch(/\b(text|bg|border)-(red|green|amber|emerald|yellow|orange|gray)-\d/);
    }
  });

  it('maps each semantic tone to its matching token', () => {
    expect(statusToneClasses.success).toContain('text-success');
    expect(statusToneClasses.warning).toContain('text-warning');
    expect(statusToneClasses.destructive).toContain('text-destructive');
    expect(statusToneClasses.info).toContain('text-info');
    expect(statusToneClasses.neutral).toContain('text-muted-foreground');
  });
});
