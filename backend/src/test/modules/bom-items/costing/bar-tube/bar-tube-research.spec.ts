import { extrusionDieUsd, laserChartOf, laserMaterialFactor, rotaryDrawDieSetUsd } from '../../../../../modules/bom-items/costing/bar-tube/bar-tube-research';

describe('published figures the memory data lacks', () => {
  it('a material\'s laser speed over carbon steel\'s, from the IPG chart at the power at or below the machine\'s', () => {
    // 1000 W, 2 mm: stainless 6 over carbon steel 4 = 1.5; aluminium 5 / 4 = 1.25; brass 2 / 4 = 0.5.
    expect(laserMaterialFactor('stainless', 2, 1000)).toEqual({ factor: 1.5, chartWatts: 1000 });
    expect(laserMaterialFactor('aluminium', 2, 1000)).toEqual({ factor: 1.25, chartWatts: 1000 });
    expect(laserMaterialFactor('brass', 2, 1000)).toEqual({ factor: 0.5, chartWatts: 1000 });
    // 2500 W reads the 2000 W chart; 1.5 mm interpolates: aluminium (20 + 10) / 2 = 15 over steel (25 + 5.2) / 2 = 15.1.
    const f = laserMaterialFactor('aluminium', 1.5, 2500);
    expect('factor' in f && f.chartWatts).toBe(2000);
    expect('factor' in f && f.factor).toBeCloseTo(15 / 15.1, 6);
  });

  it('past the thickest the chart cuts a material at that power, the laser does not cut it', () => {
    expect(laserMaterialFactor('aluminium', 4, 1000)).toEqual({ reason: expect.stringMatching(/a 1000 W laser cuts aluminium up to 3 mm .* the material is 4 mm/) });
  });

  it('each cut-code family\'s chart; titanium and super alloys take stainless\'s and say so; copper has none below about 6 kW', () => {
    expect(laserChartOf(1.1, 'Steel')).toEqual({ chart: 'carbon_steel', note: null });
    expect(laserChartOf(5.12, 'Stainless Steel')).toEqual({ chart: 'stainless', note: null });
    expect(laserChartOf(30.11, 'Aluminum')).toEqual({ chart: 'aluminium', note: null });
    expect(laserChartOf(23.1, 'Titanium')!.note).toMatch(/titanium: stainless steel's/);
    expect(laserChartOf(33.3, 'Brass')).toEqual({ chart: 'brass', note: null });
    expect(laserChartOf(33.3, 'Copper')).toBeNull();
  });

  it('an extrusion die: the cited range midpoint for the press size, hollow or solid, 1,000 USD per extra void', () => {
    expect(extrusionDieUsd(76.2, 0).usd).toBe(550);      // 3 in press, solid: (300 + 800) / 2
    expect(extrusionDieUsd(76.2, 1).usd).toBe(2350);     // hollow: (1,200 + 3,500) / 2
    expect(extrusionDieUsd(203.2, 0).usd).toBe(1500);    // 8 in press (AEC 7-10 in): (1,000 + 2,000) / 2
    expect(extrusionDieUsd(203.2, 3).usd).toBe(2600 + 2000);
    expect(extrusionDieUsd(304.8, 0).usd).toBe(6150);    // 12 in: (2,300 + 10,000) / 2
  });

  it('a rotary draw die set: 751 USD per inch of OD (Baileigh round sets), 1.38 x for a square set', () => {
    expect(rotaryDrawDieSetUsd(50.8, true).usd).toBe(1502);   // 2 in: list 1,505
    expect(rotaryDrawDieSetUsd(19.05, true).usd).toBe(563);   // 3/4 in: list 566
    expect(rotaryDrawDieSetUsd(31.75, false).usd).toBe(1295); // 1-1/4 in square: list 1,292
  });
});
