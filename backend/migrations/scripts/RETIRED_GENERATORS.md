# Retired generators

Their committed migrations stay and are already applied. Only the scripts that
produced them were removed; git history keeps them.

Removed 2026-09-29. They read the memory/Injection JSON files that commit 7fd2705
replaced with memory/Plastic Modeling CSVs, and what they produced is now
produced elsewhere:

| Generator | Migration | Superseded by |
| --- | --- | --- |
| gen_619_seed_material_cure_time.js | 619_seed_material_cure_time.sql | 835_raw_materials_reference_cure_time.sql (cure time from the staged 2026-Plastic materials, joined by name instead of copied row UUIDs) |
| gen_637_seed_im_reference_data.js | 637_seed_im_reference_data.sql | 823_stage_memory_domains (variables and processes, source_version 2026-Plastic) |
| gen_651 … gen_688 (_seed_im_lookup_*) | 651 … 688 | 823_stage_memory_domains (all 40 Plastic lookup tables) |

No code reads the im_reference_data variable, process or lookup_table rows that
these migrations wrote. The only im_reference_data rows still read are the
machine rows, which come from migration 648 (mhr.service name lookup).

Every other generator that read a deleted JSON file now reads the CSV through
`lib/memory-csv.js`. Each one was checked by regenerating its migration and
comparing it with the committed file: the output is equal, apart from blank
keys that are now absent (a CSV cannot tell blank from null) and the source path
in comments. The exceptions are recorded in each generator's header:
gen_594, whose committed output came from a draft that 595–599 later corrected,
and gen_809, whose output now rebrands the vendor name (migration 837).
