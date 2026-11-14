import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DesignGuidanceView, guidanceHighlight, rangePosition } from '@/components/features/manufacturing-intelligence/DesignGuidanceTab';
import type { DesignGuidance } from '@/lib/api/hooks/useBOMItems';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

// The Design Guidance tab, rendered from the guidance the backend returned for the real Cannula Holder (aluminium 6061, 5 axis mill).

const CANNULA: DesignGuidance = {
  family: 'milled', processGroup: 'Machining',
  costDrivers: { count: 1, items: [{ label: 'The part needs a 5 axis mill: 1 oblique setup', detail: 'Bring the features square to the part.', severity: 'major', occurrences: [{ featureId: 'h', occurrenceIndex: 1 }], faces: [17] }] },
  material: { name: 'Aluminum, ANSI 6061', currency: 'USD', costPerCm3: { value: 0.0159, min: 0.0017, max: 5.3125 }, massKg: { value: 0.0304, min: 0.0003, max: 0.128 }, comparedWith: 336, comparedGroups: ['Ferrous & Non-Ferrous', 'Machining'] },
  thickness: { recommendedMinMm: 0.8, recommendedMaxMm: null, partMinMm: 0.8, partMaxMm: 4.261, maxMinRatio: 5.326, source: 'tblMachiningMinWall (aluminum)', items: [] },
  moldTooling: null,
  machining: { routing: '5 Axis Mill → Part Setup → Tapping', scrapPct: 92.2, machinedFeatures: 93, items: [] },
  tolerances: { withTolerances: 0, drivingMachining: null, drivingFinishing: null, items: [], machiningItems: [], finishingItems: [] },
  setups: { count: 2, perpendicular: 1, oblique: 1, fewFeatureSetups: 1, fewFeatureLimit: 5, items: [] },
  holesAndFillets: { holeDiametersMm: [1.6, 2.5, 4, 18.4], filletRadiiMm: [1.5, 2], nonStandardTools: 1, holeItems: [], filletItems: [], nonStandardItems: [] },
  notModelled: { thicknessRecommendedMax: 'A machined part is cut from solid stock: there is no recommended maximum wall.', drivingMachining: 'Every feature of a machined part is machined.' },
};

const DRIVER = CANNULA.costDrivers.items[0] ?? { label: '', detail: null, severity: null, occurrences: [], faces: [] };

const html = (g: DesignGuidance, operations: Parameters<typeof DesignGuidanceView>[0]['operations'] = []) => renderToStaticMarkup(createElement(DesignGuidanceView, { guidance: g, operations }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');

describe('DesignGuidanceView', () => {
  const markup = html(CANNULA, [{ operation: 'Rough Milling', process: '5 Axis Mill', timeSec: 300, count: 1 }, { operation: 'Drilling', process: '5 Axis Mill', timeSec: 100, count: 4 }]);
  const out = text(markup);

  it('shows each panel that applies to a machined part, and no mold tooling', () => {
    for (const title of ['Cost Drivers', 'Material', 'Thickness', 'Machining', 'Tolerances and Finishing Operations', 'Machining Setups', 'Machined Holes and Fillets', 'Slow Operations']) expect(out).toContain(title);
    expect(out).not.toContain('Special Mold Tooling');
  });

  it('prints the values the backend gave', () => {
    expect(out).toContain('|Potential Cost Drivers|1|');
    expect(out).toContain('|Cost/Volume (USD / cm³)|0.0159|');
    expect(out).toContain('|Machining Scrap (%)|92.2|');
    expect(out).toContain('|Distinct hole diameters|4|');
    expect(out).toContain('|Setups with fewer than 5 features|1|');
  });

  it('a value the model does not hold is a dash with its reason on hover, never a zero', () => {
    expect(out).toContain('|Recommended Maximum (mm)|—|');
    expect(markup).toContain('title="A machined part is cut from solid stock: there is no recommended maximum wall."');
    expect(out).toContain('|Driving machining|—|');
  });

  it('a Review with nothing behind it is disabled; one with items is not', () => {
    const buttons = [...markup.matchAll(/<button[^>]*>Review<\/button>/g)].map((m) => m[0]);
    expect(buttons.filter((b) => !b.includes('disabled=""'))).toHaveLength(1);
    expect(buttons.length).toBeGreaterThan(5);
  });

  it('ranks the operations by their share of the cycle', () => {
    expect(out).toContain('75.0% · 300 s');
    expect(out).toContain('Drilling × 4');
    expect(out.indexOf('Rough Milling')).toBeLessThan(out.indexOf('Drilling × 4'));
  });

  it('shows the mold tooling of a molded part and drops the machining panels it has none of', () => {
    const molded = text(html({ ...CANNULA, family: 'plastic_molded', processGroup: 'Plastic Molding', moldTooling: { slides: 0, lifters: 4, cores: null, items: [] }, machining: null, setups: null, holesAndFillets: null }));
    expect(molded).toContain('|Special Mold Tooling|');
    expect(molded).toContain('|Lifters|4|');
    expect(molded).not.toContain('Machining Setups');
  });
});

describe('rangePosition', () => {
  it('places a value on a logarithmic scale between the least and the greatest', () => {
    expect(rangePosition({ value: 1, min: 1, max: 100 })).toBe(0);
    expect(rangePosition({ value: 10, min: 1, max: 100 })).toBeCloseTo(0.5);
    expect(rangePosition({ value: 100, min: 1, max: 100 })).toBe(1);
  });
  it('has no position without a value or a range', () => {
    expect(rangePosition({ value: null, min: 1, max: 100 })).toBeNull();
    expect(rangePosition({ value: 5, min: 5, max: 5 })).toBeNull();
  });
});

describe('guidanceHighlight', () => {
  const features = [{ id: 'h', feature_type: 'SimpleHole', occurrences: [{ centroid: [0, 0, 0], face_ids: [1] }, { centroid: [1, 2, 3], face_ids: [17] }] }] as unknown as FeatureNodeV2[];
  it('lights the feature instances an item names', () => {
    expect(guidanceHighlight(DRIVER, features)?.occurrences).toEqual([{ centroid: [1, 2, 3], face_ids: [17] }]);
  });
  it('falls back to the faces when the analysis has no such feature, and to nothing when there are none', () => {
    expect(guidanceHighlight(DRIVER, [])?.occurrences[0]?.face_ids).toEqual([17]);
    expect(guidanceHighlight({ label: 'x', detail: null, severity: null, occurrences: [], faces: [] }, features)).toBeNull();
  });
});
