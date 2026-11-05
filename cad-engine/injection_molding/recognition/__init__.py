"""
Geometric recognition for injection-molded parts (the plastic feature taxonomy of memory/Plastic Modeling).

The engine measures geometric FACTS (surfaces, the mold-opening direction, draft and undercut on every face); which operation a feature needs
(NoCore, SideCore, Lifter, UnscrewMandrel, ...) is decided by the backend from the staged reference variables and the operation catalog, exactly as
sheet metal does. Nothing here is specific to one resin or one press.

  mesh.py            tessellate every face of a shape into oriented triangles (the only module that touches OpenCASCADE)
  census.py          how many faces of each surface type, and their area
  pull_direction.py  the mold-opening direction: found from all surfaces by visibility, or supplied by the engineer
  draft.py           draft and undercut on every face, whatever its surface type

All logic after the tessellation is pure (triangles in, numbers out), so it is tested without OpenCASCADE.
"""
