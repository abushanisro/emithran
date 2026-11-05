import { AUTOMATIC_PULL_DIRECTION, isPullAxis, pullDirectionView } from '../../../../../modules/bom-items/costing/plastic-molding/override/pull-direction';

const row = (source_path: string | null) => ({ axis: 'y', reason: 'tool opens along Y', set_by: 'u1', set_at: '2026-11-05T10:00:00Z', source_path });

describe('pullDirectionView', () => {
  it('no row is the automatic choice', () => {
    expect(pullDirectionView(null, 'a.step')).toBe(AUTOMATIC_PULL_DIRECTION);
  });

  it('applies while the item still has the file it was chosen on', () => {
    expect(pullDirectionView(row('a.step'), 'a.step')).toMatchObject({ axis: 'y', declaredAxis: 'y', status: 'in_force', notice: null });
  });

  it('is held back, not silently kept, when the file was replaced', () => {
    const v = pullDirectionView(row('a.step'), 'b.step');
    expect(v).toMatchObject({ axis: null, declaredAxis: 'y', status: 'needs_confirmation' });
    expect(v.notice).toMatch(/replaced/);
  });

  it('an item with no file yet keeps it', () => {
    expect(pullDirectionView(row('a.step'), null).status).toBe('in_force');
  });

  it('an axis this backend does not know is no override', () => {
    expect(pullDirectionView({ ...row('a.step'), axis: 'w' }, 'a.step')).toBe(AUTOMATIC_PULL_DIRECTION);
    expect(isPullAxis('w')).toBe(false);
    expect(isPullAxis('z')).toBe(true);
  });
});
