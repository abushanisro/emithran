import {
  deriveGdtSeverity,
  normalizeGdtSymbol,
  resolveInspectionRule,
  type InspectionRuleRow,
} from './gdt-severity';

// Mirror of three seeded bands from migration 334 — enough to prove matching
const RULES: InspectionRuleRow[] = [
  {
    gdt_symbol: 'position', tol_max_mm: 0.05, severity: 'high', inspection_method: 'cmm',
    inspection_time_min: 8, cost_impact_percent: 12, cost_impact_range: '+10–15%',
    reason_codes: ['TIGHT_POSITION', 'CMM_REQUIRED'], manufacturing_actions: ['CMM inspection required'],
  },
  {
    gdt_symbol: 'position', tol_max_mm: 0.2, severity: 'medium', inspection_method: 'cmm',
    inspection_time_min: 8, cost_impact_percent: 6, cost_impact_range: '+4–8%',
    reason_codes: ['TIGHT_POSITION', 'CMM_REQUIRED'], manufacturing_actions: [],
  },
  {
    gdt_symbol: 'position', tol_max_mm: 1e9, severity: 'low', inspection_method: 'height_gauge',
    inspection_time_min: 4, cost_impact_percent: 2, cost_impact_range: '+1–3%',
    reason_codes: [], manufacturing_actions: [],
  },
  {
    gdt_symbol: '*', tol_max_mm: 0.1, severity: 'medium', inspection_method: 'caliper',
    inspection_time_min: 2, cost_impact_percent: 6, cost_impact_range: '+4–8%',
    reason_codes: ['UNKNOWN_TYPE'], manufacturing_actions: [],
  },
  {
    gdt_symbol: '*', tol_max_mm: 1e9, severity: 'low', inspection_method: 'visual',
    inspection_time_min: 1, cost_impact_percent: 2, cost_impact_range: '+1–3%',
    reason_codes: ['UNKNOWN_TYPE'], manufacturing_actions: [],
  },
];

describe('resolveInspectionRule — DB band matching', () => {
  it('picks the tightest band that contains the tolerance', () => {
    expect(resolveInspectionRule(RULES, 'position', 0.05).severity).toBe('high');
    expect(resolveInspectionRule(RULES, 'position', 0.1).severity).toBe('medium');
    expect(resolveInspectionRule(RULES, 'position', 0.5).severity).toBe('low');
    expect(resolveInspectionRule(RULES, 'position', 0.5).inspectionMethod).toBe('height_gauge');
  });

  it('falls back to the * catch-all for unknown symbols', () => {
    const result = resolveInspectionRule(RULES, 'wobbliness', 0.05);
    expect(result.inspectionMethod).toBe('caliper');
    expect(result.reasonCodes).toContain('UNKNOWN_TYPE');
  });

  it('falls back to the code matrix when no rules are loaded (KB outage)', () => {
    const result = resolveInspectionRule([], 'position', 0.05);
    expect(result).toEqual(deriveGdtSeverity('position', 0.05));
    expect(result.inspectionMethod).toBe('cmm');
  });

  it('normalizes drawing symbols before matching (profile_surface → profile rules)', () => {
    // No profile rows in fixture → falls to code fallback? No: symbol 'profile'
    // has no rows here, so the '*' rows match. Prove normalization by symbol:
    expect(normalizeGdtSymbol('profile_surface')).toBe('profile');
    expect(normalizeGdtSymbol('profile_line')).toBe('profile');
    expect(normalizeGdtSymbol('total_runout')).toBe('runout');
    expect(normalizeGdtSymbol('concentricity')).toBe('runout');
    expect(normalizeGdtSymbol('symmetry')).toBe('position');
    // symmetry rides position's DB bands
    expect(resolveInspectionRule(RULES, 'symmetry', 0.05).severity).toBe('high');
  });
});

describe('deriveGdtSeverity — code fallback matrix', () => {
  it('profile_surface no longer falls to the unknown-type default', () => {
    const result = deriveGdtSeverity('profile_surface', 0.1);
    expect(result.inspectionMethod).toBe('cmm');
    expect(result.reasonCodes).toContain('TIGHT_PROFILE');
  });

  it('total runout maps onto the runout thresholds', () => {
    expect(deriveGdtSeverity('total_runout', 0.02).severity).toBe('high');
    expect(deriveGdtSeverity('total_runout', 0.02).inspectionMethod).toBe('cmm');
  });
});
