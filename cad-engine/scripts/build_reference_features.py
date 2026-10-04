"""
Generate the canonical manufacturing-feature vocabulary from the reference
operation catalogs. This is the ONLY place feature-type names are derived --
the CAD engine and the backend both consume the generated files, never a
hand-typed list.

Sources (raw, untouched, source of truth):
  memory/sheetmetal/process/process_operations.csv     (391 rows)
  memory/machining/operations_full__operations.csv     (1174 rows)
  memory/machining/operations_full__warnings.csv       (disclosed capture gaps)
  memory/Die Casting/Processes/operations.csv          (122 rows)

Grammar of every row (same as memory/sheetmetal/process/build-taxonomy.mjs):
  Machine:Level[:Level...]
where each Level is either a bare category label ("Die Station", "Setup") or
"Operation//Feature". Consecutive Operation//Feature levels form a parent ->
child feature chain, e.g.
  "3 Axis Mill:Countersinking//SimpleHole:Countersinking//Edge"
  -> SimpleHole (op Countersinking) has child Edge (op Countersinking).
A feature token may itself carry a ":"-suffix sub-operation in the raw data
("SimpleHole:Countersinking"); the split on ":" handles that uniformly.

Outputs (generated -- do not hand-edit, re-run this script):
  cad-engine/shared/reference_features.json
  backend/src/modules/bom-items/costing/shared/reference-features.generated.ts

Run from the repo root or anywhere:  python cad-engine/scripts/build_reference_features.py
"""

from __future__ import annotations

import csv
import hashlib
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO = Path(__file__).resolve().parents[2]
SOURCES = {
    "sheet_metal": REPO / "memory" / "sheetmetal" / "process" / "process_operations.csv",
    "machining": REPO / "memory" / "machining" / "operations_full__operations.csv",
    "die_casting": REPO / "memory" / "Die Casting" / "Processes" / "operations.csv",
    # Same Machine:Operation//Feature grammar and casting feature vocabulary as
    # die casting; each process keeps its own catalog because the physics
    # differ (sand cores undercuts, so it has no SlideBundle; investment adds
    # CoreBundle). memory/Casting is NOT included: its catalog names
    # operations-as-features (HoleInsertCoring, DieCastAsMStepHole, ...), a
    # different grammar that cannot be mapped without inventing a rule.
    "sand_casting": REPO / "memory" / "Sand casting" / "Processes" / "operations.csv",
    "investment_casting": REPO / "memory" / "Casting Investment" / "Processes" / "operations.csv",
}
# Domains whose catalogs are casting catalogs (shared alias handling below).
CASTING_DOMAINS = {"die_casting", "sand_casting", "investment_casting"}
MACHINING_WARNINGS = REPO / "memory" / "machining" / "operations_full__warnings.csv"

# Real spelling inconsistencies in memory/Die Casting/Processes/operations.csv, confirmed
# present in the source file itself (not a parsing bug here): "ComboVoids" (plural) appears
# only under Gravity Die Casting's "No Side Pull" group, vs. "ComboVoid" (singular) everywhere
# else; "MultiStopHole" appears only under "Core Refractory Coat", vs. "MultiStepHole"
# everywhere else. Canonicalized to the dominant spelling here, once, at generation time, so
# downstream consumers (predicates, the generated TS union) match on exactly one string that
# means the real feature -- memory/Die Casting/Processes/operations.csv itself is never edited,
# so the generator's own sha256 provenance stamp always reflects the real upstream file.
_DIE_CASTING_FEATURE_ALIASES = {
    "ComboVoids": "ComboVoid",
    "MultiStopHole": "MultiStepHole",
}
OUT_JSON = REPO / "cad-engine" / "shared" / "reference_features.json"
OUT_TS = (
    REPO / "backend" / "src" / "modules" / "bom-items" / "costing" / "shared"
    / "reference-features.generated.ts"
)


def _read_rows(domain: str) -> List[str]:
    path = SOURCES[domain]
    with path.open(encoding="utf-8-sig", newline="") as fh:
        reader = csv.DictReader(fh)
        column = (
            "raw_operation_string" if domain == "sheet_metal"
            else "processName" if domain == "machining"
            else "Process Name"  # casting catalogs
        )
        if column not in (reader.fieldnames or []):
            raise SystemExit(f"{path}: expected column {column!r}, found {reader.fieldnames}")
        return [row[column].strip() for row in reader if row[column].strip()]


def parse_row(raw: str) -> Tuple[str, List[Tuple[str, str]]]:
    """Return (machine, [(operation, feature), ...]) -- only the Operation//Feature
    levels, in chain order. Category labels are dropped (they carry no feature)."""
    machine, _, rest = raw.partition(":")
    chain: List[Tuple[str, str]] = []
    pending_labels: List[str] = []
    for token in rest.split(":"):
        if "//" in token:
            op, feature = token.split("//", 1)
            # A bare label directly before "Op//Feature" is part of the
            # operation's own name ("Die Station:Bending", "Setup:Hobbing").
            full_op = ":".join(pending_labels + [op]) if pending_labels else op
            chain.append((full_op.strip(), feature.strip()))
            pending_labels = []
        elif token.strip():
            pending_labels.append(token.strip())
    return machine.strip(), chain


def build_domain(domain: str) -> Dict:
    rows = _read_rows(domain)
    features: Dict[str, Dict] = {}
    unparsed: List[str] = []

    def entry(name: str) -> Dict:
        return features.setdefault(name, {
            "operations": set(), "machines": set(),
            "parent_features": set(), "child_features": set(),
        })

    for raw in rows:
        machine, chain = parse_row(raw)
        if not chain:
            unparsed.append(raw)  # machine-level op with no feature (e.g. "Setup")
            continue
        parent: Optional[str] = None
        for op, feature in chain:
            if domain in CASTING_DOMAINS:
                feature = _DIE_CASTING_FEATURE_ALIASES.get(feature, feature)
            e = entry(feature)
            e["operations"].add(op)
            e["machines"].add(machine)
            if parent is not None:
                e["parent_features"].add(parent)
                entry(parent)["child_features"].add(feature)
            parent = feature

    return {
        "row_count": len(rows),
        "feature_types": {
            name: {k: sorted(v) for k, v in sorted(data.items())}
            for name, data in sorted(features.items())
        },
        "rows_without_feature": sorted(set(unparsed)),
    }


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    domains = {d: build_domain(d) for d in SOURCES}

    warnings: List[str] = []
    if MACHINING_WARNINGS.exists():
        with MACHINING_WARNINGS.open(encoding="utf-8-sig", newline="") as fh:
            warnings = [r["value"].strip() for r in csv.DictReader(fh) if r.get("value")]
    domains["machining"]["source_capture_warnings"] = warnings

    doc = {
        "_generated_by": "cad-engine/scripts/build_reference_features.py -- do not hand-edit",
        "sources": {
            d: {"path": str(p.relative_to(REPO)).replace("\\", "/"), "sha256": _sha256(p)}
            for d, p in SOURCES.items()
        },
        "domains": domains,
    }
    OUT_JSON.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def ts_union(names: List[str]) -> str:
        return "\n".join(f"  | '{n}'" for n in names)

    # One TS type name + domain key per domain -- new domains are added here only
    # (DOMAIN_TS_NAMES), never by hand-writing a new emission block per domain.
    DOMAIN_TS_NAMES = {
        "sheet_metal": "SheetMetalFeatureType",
        "machining": "MachiningFeatureType",
        "die_casting": "DieCastingFeatureType",
        "sand_casting": "SandCastingFeatureType",
        "investment_casting": "InvestmentCastingFeatureType",
    }
    missing_names = [d for d in domains if d not in DOMAIN_TS_NAMES]
    if missing_names:
        raise SystemExit(f"DOMAIN_TS_NAMES is missing an entry for: {missing_names}")

    ops = {
        d: {f: v["operations"] for f, v in domains[d]["feature_types"].items()}
        for d in domains
    }
    domain_literal = " | ".join(f"'{d}'" for d in domains)
    type_decls = "\n\n".join(
        f"export type {DOMAIN_TS_NAMES[d]} =\n{ts_union(sorted(domains[d]['feature_types']))};"
        for d in domains
    )
    record_fields = "\n".join(
        f"  readonly {d}: Readonly<Record<{DOMAIN_TS_NAMES[d]}, readonly string[]>>;"
        for d in domains
    )
    ts = (
        "// GENERATED by cad-engine/scripts/build_reference_features.py -- do not hand-edit.\n"
        "// Canonical manufacturing feature vocabulary, derived from the reference\n"
        "// operation catalogs (memory/sheetmetal/process/process_operations.csv,\n"
        "// memory/machining/operations_full__operations.csv,\n"
        "// memory/Die Casting/Processes/operations.csv). The CAD engine emits\n"
        "// exactly these feature_type strings (cad-engine/shared/reference_features.json).\n\n"
        f"{type_decls}\n\n"
        "/** Real operation names the reference catalog pairs with each feature type. */\n"
        "export const REFERENCE_FEATURE_OPERATIONS: {\n"
        f"{record_fields}\n"
        f"}} = {json.dumps(ops, indent=2, ensure_ascii=False)} as const;\n\n"
        "/** True when `operation` is a real catalog pairing for `featureType` in `domain`. */\n"
        "export function isReferenceOperation(\n"
        f"  domain: {domain_literal},\n"
        "  featureType: string,\n"
        "  operation: string,\n"
        "): boolean {\n"
        "  const table = REFERENCE_FEATURE_OPERATIONS[domain] as Record<string, readonly string[]>;\n"
        "  return (table[featureType] ?? []).includes(operation);\n"
        "}\n"
    )
    OUT_TS.write_text(ts, encoding="utf-8")

    for d in domains:
        print(f"{d}: {domains[d]['row_count']} rows -> {len(domains[d]['feature_types'])} feature types")
    print(f"wrote {OUT_JSON.relative_to(REPO)}\nwrote {OUT_TS.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
