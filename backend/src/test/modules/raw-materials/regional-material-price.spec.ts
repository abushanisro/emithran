import { pickRegionalMaterialPrice } from '../../../modules/raw-materials/services/raw-material-cost.service';

describe('pickRegionalMaterialPrice', () => {
  it("uses the country's own column when it has a price", () => {
    expect(pickRegionalMaterialPrice([{ cost_usa: '2.5', cost_india: '80' }], 'USA')).toEqual({
      price: 2.5, found: true, currency: 'USD', priceSource: 'local',
    });
  });

  it('flags the India price when the local column is empty, instead of passing it off as local', () => {
    const r = pickRegionalMaterialPrice([{ cost_usa: null, cost_india: '80' }], 'USA');
    expect(r).toMatchObject({ price: 80, found: true, currency: 'INR', priceSource: 'fallback_india' });
    expect(r.warning).toContain('has no USA price');
  });

  it('flags the India price for a location with no price column at all', () => {
    const r = pickRegionalMaterialPrice([{ cost_india: '80' }], 'Brazil');
    expect(r).toMatchObject({ price: 80, currency: 'INR', priceSource: 'fallback_india' });
    expect(r.warning).toContain('no price column for location "Brazil"');
  });

  it('reports India prices as local, never as a fallback', () => {
    expect(pickRegionalMaterialPrice([{ cost_india: '80' }], 'India')).toEqual({
      price: 80, found: true, currency: 'INR', priceSource: 'local',
    });
  });

  it('returns found:false with no invented price when nothing is on file', () => {
    expect(pickRegionalMaterialPrice([{ cost_usa: 0, cost_india: null }], 'USA')).toEqual({
      price: 0, found: false, currency: 'USD', priceSource: 'none',
    });
    expect(pickRegionalMaterialPrice([], 'India')).toMatchObject({ found: false, priceSource: 'none' });
  });
});
