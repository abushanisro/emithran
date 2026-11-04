# Retired migration generators

Every script that generated or checked a migration was removed on 2026-11-05; git history keeps them
(`git log --diff-filter=D -- backend/migrations/scripts`). The committed migrations stay, and they are already applied.

Why they were removed:

- Since migration 936 no migration writes reference rows (`REFERENCE_DATA.json`, checked by
  `src/common/migrations/reference-data.spec.ts`): rates, lookups and process knowledge ship in versioned data packages,
  not in migrations. A generator that produces such a migration has nothing left to produce.
- They read `memory/` (private reference data that is never committed), so they could not run for anyone without it, and
  the migrations they wrote are the record of what was seeded.
- The one thing the repository still needs from this folder is `lib/memory-machine-seed.js` (`readCsv`), which the
  unit tests use to read the real reference CSVs.

The calculator migrations (956, 958, 959, 964 sand casting; the die-casting, machining and heat-treatment ones) are not here:
they are generated from calculator specs by `backend/scripts/generate-*-calculators-migration.ts`, which stay, and a test
checks each committed migration equals what its spec generates.

An earlier retirement (2026-09-29) removed the injection-moulding generators that read JSON files since replaced by the
Plastic Modeling CSVs; their migrations (619, 637, 651 to 688) were superseded by 823 and 835.
