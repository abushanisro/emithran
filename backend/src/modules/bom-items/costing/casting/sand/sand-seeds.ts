// Supplies a sand calculator's inputs from what its spec says each one is (the `source` of every input field,
// calculators/sand-casting-calculators.json). One generic seeder instead of a hand-written seed list per step: the step names only how to
// resolve each kind of source, and an input nobody can supply is reported by name, never filled in.
import type { SourceRef } from '../../../dto/cost-breakdown.dto';
import type { CadEvidenceKey } from '../../shared/cad-evidence';
import type { DomainSpecCalculator } from '../../shared/calculators/domain-calculator-spec';
import type { CalcSeed } from '../../shared/calculators/reference-calculator';
import { stagedLookupKey, type SandReference } from './sand-reference';

/** The reference-data domain of memory/Sand casting (processes/memory-reference-domains.json). */
export const SAND_DOMAIN = 'sand_casting';

/** The part's faces each CAD quantity of the sand calculators is measured over: all of them, for a volume, a modulus or a surface. */
const CAD_EVIDENCE: Readonly<Record<string, CadEvidenceKey>> = {
  volume_mm3: 'part_volume',
  modulus_mm: 'part_volume',
  area_mm2: 'part_surface',
};

/**
 * Where an input of this kind and key was read, when the kind alone says it: a variable by its name, a lookup table's column ("tblX.Column")
 * with the row the provider matched, a CAD quantity's faces. Machines, materials and calculations name their record in the provider.
 */
function refOf(kind: SourceKind, key: string, seed: CalcSeed): SourceRef | undefined {
  if (kind === 'variable') return { kind: 'variable', domain: SAND_DOMAIN, name: key };
  if (kind === 'lookup') {
    const dot = key.indexOf('.');
    if (dot < 0) return undefined;
    return { kind: 'lookup', domain: SAND_DOMAIN, table: stagedLookupKey(key.slice(0, dot)), column: key.slice(dot + 1), row: seed.match?.row ?? null };
  }
  if (kind === 'cad' && CAD_EVIDENCE[key]) return { kind: 'cad', evidence: CAD_EVIDENCE[key] };
  return undefined;
}

export type SourceKind = 'cad' | 'material' | 'machine' | 'variable' | 'lookup' | 'scenario' | 'engine';

/** Resolves one named source of a kind: a value with where it came from, or null when it cannot. */
export type SeedProvider = (key: string) => CalcSeed | null | undefined;
export type SeedProviders = Partial<Record<SourceKind, SeedProvider>>;

const kindOf = (source: object): SourceKind => Object.keys(source)[0] as SourceKind;
const keyOf = (source: object): string => Object.values(source)[0] as string;

/** The seeds of one calculator, and the inputs that could not be supplied (as "Field (kind: key)"). */
export function seedsFor(calc: DomainSpecCalculator, providers: SeedProviders): { seeds: Record<string, CalcSeed>; missing: string[] } {
  const seeds: Record<string, CalcSeed> = {};
  const missing: string[] = [];
  for (const f of calc.fields) {
    if (f.formula || !f.source) continue;
    const kind = kindOf(f.source);
    const key = keyOf(f.source);
    const seed = providers[kind]?.(key);
    if (seed && Number.isFinite(seed.value)) {
      const ref = seed.ref ?? refOf(kind, key, seed);
      seeds[f.name] = ref ? { ...seed, ref } : seed;
    }
    else missing.push(`${f.name} (${kind}: ${key})`);
  }
  return { seeds, missing };
}

/** The `variable` provider: a numeric variable of memory/Sand casting. */
export function variableProvider(ref: SandReference): SeedProvider {
  return (name) => {
    const value = ref.number(name);
    const unit = ref.unit(name) ? ` (${ref.unit(name)})` : '';
    const source = ref.overridden(name)
      ? `Your value for sand casting variable ${name}${unit}: the plant value is ${ref.plantValue(name) ?? 'none'}`
      : `Sand casting variable ${name}${unit}`;
    return value == null ? null : { value, source };
  };
}

/** A provider over values the caller already holds, each with its source text. */
export function valuesProvider(values: Readonly<Record<string, CalcSeed | undefined>>): SeedProvider {
  return (key) => values[key] ?? null;
}
