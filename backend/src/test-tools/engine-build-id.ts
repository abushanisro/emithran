// An identifier of the plastic cost engine's actual code: a hash of every source file the engine pulls in at runtime (its transitive relative imports),
// so two different implementations can never share an identifier, whatever version string anyone maintains by hand. Used by the generator
// (scripts/engine-build-id.ts) that writes plastic-molding/engine-build.generated.ts, and by the test that fails when that file is stale.
//
// What it covers: the engine's own files and every relative import they reach (`import type` is erased at compile time and is not followed), json
// imports included. What it does not cover: npm packages (pinned by package-lock.json) and the staged reference data (identified by its own fingerprint).
// Line endings are normalised, so a checkout on Windows and one on macOS give the same hash.
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const IMPORT = /^\s*(?:import|export)\s+(?!type\b)(?:[^;]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm;

function resolveImport(from: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The root file and every runtime source file it reaches, sorted. A generated file is the output of this very computation and is left out. */
export function engineClosure(rootFile: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || file.endsWith('.generated.ts')) return;
    seen.add(file);
    if (!file.endsWith('.ts')) return; // a json file has no imports
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const next = resolveImport(file, m[1]!);
      if (next) visit(next);
    }
  };
  visit(path.resolve(rootFile));
  return [...seen].sort();
}

export interface EngineBuild { codeHash: string; files: number }

export function computeEngineBuild(rootFile: string, repoRoot: string): EngineBuild {
  const files = engineClosure(rootFile);
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(`${path.relative(repoRoot, f).split(path.sep).join('/')}\n`);
    hash.update(`${fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')}\n`);
  }
  return { codeHash: hash.digest('hex').slice(0, 24), files: files.length };
}
