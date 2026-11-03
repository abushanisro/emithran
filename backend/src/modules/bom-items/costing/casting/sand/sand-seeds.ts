// Supplies a sand calculator's inputs from what its spec says each one is (the `source` of every input field,
// calculators/sand-casting-calculators.json). One generic seeder instead of a hand-written seed list per step: the step names only how to
// resolve each kind of source, and an input nobody can supply is reported by name, never filled in.
import type { DomainSpecCalculator } from '../../shared/calculators/domain-calculator-spec';
import type { CalcSeed } from '../../shared/calculators/reference-calculator';
import type { SandReference } from './sand-reference';

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
    if (seed && Number.isFinite(seed.value)) seeds[f.name] = seed;
    else missing.push(`${f.name} (${kind}: ${key})`);
  }
  return { seeds, missing };
}

/** The `variable` provider: a numeric variable of memory/Sand casting. */
export function variableProvider(ref: SandReference): SeedProvider {
  return (name) => {
    const value = ref.number(name);
    return value == null ? null : { value, source: `Sand casting variable ${name}${ref.unit(name) ? ` (${ref.unit(name)})` : ''}` };
  };
}

/** A provider over values the caller already holds, each with its source text. */
export function valuesProvider(values: Readonly<Record<string, { value: number; source: string } | undefined>>): SeedProvider {
  return (key) => values[key] ?? null;
}
