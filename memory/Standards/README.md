# Standards

Published standards the costing engines read, staged like every other memory/
folder (source_version 2026-Standards, migration 880).

## lookup/iso286_standard_tolerances.csv

ISO 286-1:2010, Table 1: standard tolerance values IT1 to IT18 (micrometres)
for nominal sizes up to 3150 mm. A size range includes its upper bound
("Above" < size <= "Up To And Including"). IT14 to IT18 are not defined for
nominal sizes of 1 mm and below.

Used to express a tolerance entered in mm, at a feature's size, as an IT grade,
so it can be compared with the IT-grade process capabilities in
Machining/lookup/tblGtolProcessCapabilities.csv. Added 2026-10-04 (user
decision); review against your copy of the standard.
