# ecad-engine

Python service of the electronics costing vertical. It reads a customer board set (Gerber layers, drill file and report,
Pick Place, BOM workbook) and returns a candidate **board feature graph** (contract 1.1) with per-field provenance and
cross-check findings. The backend module is `backend/src/modules/electronics-costing`; the screen is `/electronics`.

It holds **no data of its own**. File roles, Pick Place layer names and footprint classes arrive with each request from the
platform tables in `memory/Electronics` (the backend generates TypeScript copies; `npm run electronics:sync-lookups`).

## What it measures, and what it does not
| Measured from the files | Source file |
|---|---|
| Overall size, enclosed regions and area (centre line of the outline path; panels of several rectangles handled) | outline layer (`.GKO`) |
| Copper layer count | copper layers (`.GTL`, `.GBL`) |
| Drilled holes by finished diameter and plating, checked against the drill report | Excellon `.TXT`, `.DRR` |
| Solder paste opening area per side | paste layers (`.GTP`, `.GBP`) |
| Placements by side and footprint | Pick Place CSV or workbook |

Never measured, never guessed: board thickness, boards per panel and the layer count a document states arrive as **supplied**
facts (each with who stated it); part counts, test points, package classes (until `package_class_lookup.csv` has the footprint)
and through-hole versus surface-mount stay in `unresolved`. The BOM workbook is attached for review; it has no designators, so
it is not matched to placements.

## Running it
```
pip install -r requirements.txt            # Python 3.12 (pydantic-core has no wheel for 3.14 yet)
ECAD_ENGINE_API_KEY=<key> PORT=5100 python main.py
```
Backend `.env`: `ECAD_ENGINE_URL=http://127.0.0.1:5100`, `ECAD_ENGINE_API_KEY=<same key>`. Docker: `docker compose up ecad-engine`
(compose files pass the same variables). Endpoints: `GET /health`, `POST /extract/board` (multipart `files` + JSON `manifest`;
header `X-API-Key`). Limits: `ECAD_MAX_FILE_MB` (25), `ECAD_MAX_FILES` (40), `ECAD_RATE_LIMIT` (30/minute). Customer files are
never logged; only counts are.

## Tests (real data only)
```
pip install -r requirements-dev.txt
python -I -m pytest -q
```
The bundled tests need no board files: they cover the service (authentication, limits, error codes) and the contract schemas.
No sample board, fixture or example graph ships with the engine. Extraction is verified by uploading a real board set through
the platform and comparing the result with the customer's own drawing, drill report and BOM. No Gerber is synthesised.

## The feature-graph contract
| File | Role |
|---|---|
| `contract/schemas/board_feature_graph.v1.schema.json` | Canonical PCBA schema (single source of truth) |
| `contract/schemas/harness_feature_graph.v1.schema.json` | Canonical harness schema |
| `contract/fixtures/valid`, `contract/fixtures/invalid` | Documents both languages must accept / reject |
| `contract/tests/test_contract_fixtures.py` | Python side of the contract test |
| `backend/.../test/contract/feature-graph-contract.spec.ts` | TypeScript side, same fixtures, same schemas |

The backend cannot read this folder at build time (its Docker context is `backend/`), so `npm run electronics:sync-contract`
(in `backend/`) regenerates `domain/feature-graph/schemas.generated.ts`. Never hand-edit it; a spec fails when it drifts.

Every data field carries a **provenance** entry (`measured` from a named source file and the parser, `supplied` by a person or
document, or `derived` from other fields) with a confidence; a field with no entry, or an entry for an absent field, is rejected
(`domain/feature-graph/provenance.ts` holds the cross-field rules). A nested part with a different origin gets its own dotted
entry (`outline.thicknessMm`). A value the input could not provide is listed in `unresolved` and left out of the graph.
`findings` carry cross-checks for the reviewer.

## Changing the contract
1. Edit the schema file(s); bump `contractVersion` for any breaking change.
2. Add or adjust fixtures under `contract/fixtures`.
3. `cd backend && npm run electronics:sync-contract`.
4. Update `domain/feature-graph/contract.ts` to match.
5. Run `python -I -m pytest` here and `cd backend && npx jest src/modules/electronics-costing`.
