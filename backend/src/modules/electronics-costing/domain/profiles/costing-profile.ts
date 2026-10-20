// Costing profile: the percentage terms that turn material and conversion cost into a price
// (rejection, SG&A, profit, inventory carrying cost, packing...). A profile is data chosen per
// customer, never constants in code. All arithmetic is in integer paise so a to-the-paisa check
// cannot drift on float noise; each term is rounded half-up to the paisa, and the total is the
// sum of the rounded lines, which is how the reference report adds up.

export type LedgerBase = 'material' | 'conversion';

export interface ProfileTerm {
  /** Ledger line name, e.g. 'sga'. Unique within a profile. */
  name: string;
  /** Percent, up to two decimals (1.5 = 1.5%). */
  ratePct: number;
  /** What the percentage is taken of: the sum of these ledger components. */
  base: LedgerBase[];
}

export interface CostingProfile {
  name: string;
  terms: ProfileTerm[];
}

export interface LedgerLine {
  name: string;
  /** The base the rate was applied to, in paise. */
  basePaise: number;
  ratePct: number;
  amountPaise: number;
}

export interface Ledger {
  materialPaise: number;
  conversionPaise: number;
  terms: LedgerLine[];
  totalPaise: number;
}

export function toPaise(amount: number): number {
  return Math.round(amount * 100);
}

export function fromPaise(paise: number): number {
  return paise / 100;
}

// ratePct in basis points (hundredths of a percent) keeps the rate an integer too.
function percentOfHalfUp(basePaise: number, ratePct: number): number {
  const basisPoints = Math.round(ratePct * 100);
  return Math.floor((basePaise * basisPoints * 2 + 10_000) / 20_000);
}

export function validateProfile(profile: CostingProfile): string[] {
  const issues: string[] = [];
  const names = profile.terms.map((t) => t.name);
  for (const dup of new Set(names.filter((n, i) => names.indexOf(n) !== i))) issues.push(`duplicate term ${dup}`);
  for (const t of profile.terms) {
    if (!Number.isFinite(t.ratePct) || t.ratePct < 0) issues.push(`${t.name}: rate must be a non-negative number`);
    if (Math.abs(t.ratePct * 100 - Math.round(t.ratePct * 100)) > 1e-9) issues.push(`${t.name}: rate has more than two decimals`);
    if (t.base.length === 0) issues.push(`${t.name}: needs at least one base component`);
  }
  return issues;
}

/**
 * material: the component (and bare-board) cost per unit, 0 when the component layer is off.
 * conversion: the assembly cost per unit (setup + process + consumables), summed from engine lines.
 */
export function applyCostingProfile(profile: CostingProfile, materialPaise: number, conversionPaise: number): Ledger {
  const issues = validateProfile(profile);
  if (issues.length > 0) throw new RangeError(`Invalid costing profile "${profile.name}": ${issues.join('; ')}`);
  if (![materialPaise, conversionPaise].every((v) => Number.isInteger(v) && v >= 0)) {
    throw new RangeError('material and conversion must be non-negative whole paise');
  }
  const component: Record<LedgerBase, number> = { material: materialPaise, conversion: conversionPaise };
  const terms = profile.terms.map((t): LedgerLine => {
    const basePaise = t.base.reduce((sum, b) => sum + component[b], 0);
    return { name: t.name, basePaise, ratePct: t.ratePct, amountPaise: percentOfHalfUp(basePaise, t.ratePct) };
  });
  const totalPaise = materialPaise + conversionPaise + terms.reduce((sum, t) => sum + t.amountPaise, 0);
  return { materialPaise, conversionPaise, terms, totalPaise };
}
