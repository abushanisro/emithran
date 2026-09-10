"""
Regression test for a real, live bug (reported 2026-09-10): detect_part_family()
was rewritten (2026-09-10, see test_detect_part_family.py) from sequential
gate-and-stop into a scored comparison so genuine injection-molded evidence is
weighed even on a thin flat part -- but doing so exposed a second, unrelated,
pre-existing bug: InjectionMoldedFeatureExtractor.__init__ used
SheetMetalFeatureExtractor() (composition, not inheritance -- reusing its
antiparallel-face-pair histogram / cylindrical-face collection primitives)
without ever importing it. injection_molding/feature_extractor.py's own
docstring says it was "split out of the former feature_extractors.py, ...
unchanged, verbatim" (2026-09-01) -- the split lost the import.

Because the OLD classifier almost never actually reached the injection_molded
branch for a real part, memory_optimizer.py never instantiated this class in
production, so the NameError ("name 'SheetMetalFeatureExtractor' is not
defined") stayed dormant until the classifier fix made a real thin-flat-shell
part (TERMINAL BOX COVER VP TYPE-I) classify as injection_molded, at which
point memory_optimizer.py's own broad try/except silently swallowed the crash
and returned manufacturing_intelligence={'error': ...} -- which the backend
then read as family=null and defaulted back to sheet_metal. This test would
have caught the bug on its own, independent of any classifier change.
"""

import pytest

pytest.importorskip("OCC")

from injection_molding.feature_extractor import InjectionMoldedFeatureExtractor  # noqa: E402  (after importorskip)
from sheet_metal.feature_extractor import SheetMetalFeatureExtractor  # noqa: E402  (after importorskip)


def test_instantiation_does_not_raise_nameerror():
    extractor = InjectionMoldedFeatureExtractor()
    assert isinstance(extractor._sm, SheetMetalFeatureExtractor)
