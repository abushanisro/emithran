import { assertNotProduction, productionReason } from './environment-guard';

describe('environment guard', () => {
  it('allows local and stage', () => {
    expect(productionReason({ APP_ENV: 'local' })).toBeNull();
    expect(productionReason({ APP_ENV: 'stage' })).toBeNull();
    expect(productionReason({})).toBeNull();
  });

  it('blocks APP_ENV=prd', () => {
    expect(productionReason({ APP_ENV: 'prd' })).toMatch(/APP_ENV/);
  });

  it('throws a message that says what to do', () => {
    expect(() => assertNotProduction({ APP_ENV: 'prd' })).toThrow(/Refusing to run the data-creating e2e suites.*local or stage/);
    expect(() => assertNotProduction({ APP_ENV: 'stage' })).not.toThrow();
  });
});
