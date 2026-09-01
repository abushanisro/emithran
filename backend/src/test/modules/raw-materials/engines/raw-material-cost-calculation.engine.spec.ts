import { RawMaterialCostCalculationEngine } from '../../../../modules/raw-materials/engines/raw-material-cost-calculation.engine';

describe('RawMaterialCostCalculationEngine', () => {
  const engine = new RawMaterialCostCalculationEngine();

  describe('scrap adjustment (no double-counting)', () => {
    // Scrap is already fully captured by the gross-vs-net usage difference
    // (steps 1-4). Applying the scrap% again as a cost multiplier on top of
    // that would double-count the same yield loss, which is why the engine
    // forces scrapAdjustment to 0 regardless of the scrap% passed in.
    it('always returns scrapAdjustment = 0, independent of the scrap % input', () => {
      const lowScrap = engine.calculate({
        unitCost: 1.2, grossUsage: 2.066, netUsage: 1.234, scrap: 5, overhead: 5,
      });
      const highScrap = engine.calculate({
        unitCost: 1.2, grossUsage: 2.066, netUsage: 1.234, scrap: 40.27, overhead: 5,
      });

      expect(lowScrap.scrapAdjustment).toBe(0);
      expect(highScrap.scrapAdjustment).toBe(0);
      // Changing only the descriptive scrap% must not change the cost total.
      expect(highScrap.totalCost).toBe(lowScrap.totalCost);
    });

    it('subtotal before overhead equals net material cost (scrap step is a no-op)', () => {
      const result = engine.calculate({
        unitCost: 1.2, grossUsage: 2.066, netUsage: 1.234, scrap: 40.27, overhead: 5,
      });
      expect(result.subtotalBeforeOverhead).toBe(result.netMaterialCost);
    });
  });

  describe('RTP2 MAG2 FRONTFRAME live regression (SECC, 1.6mm)', () => {
    // Live-reported numbers: net part weight 1.234kg, true-shape nested gross
    // weight/part 2.066kg (1250x2500mm sheet, 19 parts/sheet, 59.7% mass
    // utilization -> ~40.3% scrap). No reclaim in this case. Overhead 5%.
    const GROSS_KG = 2.066;
    const NET_KG = 1.234;
    const SCRAP_PCT = ((GROSS_KG - NET_KG) / GROSS_KG) * 100; // ~40.27%
    const UNIT_COST = 1.2; // $/kg, representative SECC rate
    const OVERHEAD_PCT = 5;

    it('computes utilization and scrap% from mass, matching the nesting result', () => {
      const result = engine.calculate({
        unitCost: UNIT_COST, grossUsage: GROSS_KG, netUsage: NET_KG, scrap: SCRAP_PCT, overhead: OVERHEAD_PCT,
      });
      expect(result.materialUtilizationRate).toBeCloseTo(59.73, 1);
      expect(result.scrapRate).toBeCloseTo(40.27, 1);
    });

    it('preserves the 5% overhead and never applies a second, independent cost formula', () => {
      const result = engine.calculate({
        unitCost: UNIT_COST, grossUsage: GROSS_KG, netUsage: NET_KG, scrap: SCRAP_PCT, overhead: OVERHEAD_PCT,
      });
      expect(result.overheadPercentage).toBe(5);
      expect(result.overheadCost).toBeCloseTo(result.netMaterialCost * 0.05, 3);
      expect(result.totalCost).toBeCloseTo(result.netMaterialCost * 1.05, 3);
    });

    it('the displayed step breakdown reconciles exactly to the displayed total (no phantom terms)', () => {
      const result = engine.calculate({
        unitCost: UNIT_COST, grossUsage: GROSS_KG, netUsage: NET_KG, scrap: SCRAP_PCT, overhead: OVERHEAD_PCT,
      });
      // gross - reclaim = net; net + scrapAdjustment(=0) + overhead = total
      const reconciledTotal = result.grossMaterialCost - result.reclaimValue + result.scrapAdjustment + result.overheadCost;
      expect(reconciledTotal).toBeCloseTo(result.totalCost, 3);
    });
  });
});
