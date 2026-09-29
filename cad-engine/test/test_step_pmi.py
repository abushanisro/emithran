"""
shared/step_pmi.py against real STEP input, read by OpenCASCADE's own reader.

The GD&T fixture is an AP242 Part 21 file with the schema's own tolerance
entities: a simple FLATNESS_TOLERANCE whose magnitude is in millimetres, and
the AP242 complex instance
(GEOMETRIC_TOLERANCE GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE POSITION_TOLERANCE)
referencing a datum system, with its magnitude in inches (a
CONVERSION_BASED_UNIT) — so both the type identification paths and the unit
conversion are exercised. pythonocc 7.7.2 cannot author semantic GD&T
(XCAFDoc_GeomTolerance is not wrapped), hence a written file rather than an
XDE-built one.

A plain STEP export of a real box carries no tolerance entities and must report
none — GD&T is never inferred from geometry.
"""
import os
import tempfile

from OCC.Core.BRepPrimAPI import BRepPrimAPI_MakeBox  # type: ignore
from OCC.Core.IFSelect import IFSelect_RetDone  # type: ignore
from OCC.Core.STEPControl import STEPControl_AsIs, STEPControl_Writer  # type: ignore

from shared.step_pmi import read_step_gdt

AP242_WITH_GDT = """ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('gdt.stp','2026-09-27T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));
ENDSEC;
DATA;
#1=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#2=DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.);
#3=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#1);
#4=(CONVERSION_BASED_UNIT('INCH',#3)LENGTH_UNIT()NAMED_UNIT(#2));
#10=APPLICATION_CONTEXT('managed model based 3d engineering');
#11=PRODUCT_CONTEXT('',#10,'mechanical');
#12=PRODUCT('part','part','',(#11));
#13=PRODUCT_DEFINITION_FORMATION('','',#12);
#14=PRODUCT_DEFINITION_CONTEXT('part definition',#10,'design');
#15=PRODUCT_DEFINITION('design','',#13,#14);
#16=PRODUCT_DEFINITION_SHAPE('','',#15);
#17=SHAPE_ASPECT('top face','',#16,.T.);
#18=SHAPE_ASPECT('bore','',#16,.T.);
#20=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.05),#1);
#21=FLATNESS_TOLERANCE('flatness','',#20,#17);
#30=DATUM('','',#16,.F.,'A');
#31=DATUM_REFERENCE_COMPARTMENT('','',#16,.F.,#30,$);
#32=DATUM_SYSTEM('','',#16,.F.,(#31));
#33=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.004),#4);
#34=(GEOMETRIC_TOLERANCE('position','',#33,#18)GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE((#32))POSITION_TOLERANCE());
ENDSEC;
END-ISO-10303-21;
"""


def test_reads_semantic_gdt_with_unit_conversion():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "gdt.stp")
        with open(path, "w") as fh:
            fh.write(AP242_WITH_GDT)
        result = read_step_gdt(path)

    assert result["status"] == "read", result
    assert result["unresolved"] == []
    by_type = {c["type"]: c["tolerance"] for c in result["gdt_callouts"]}
    assert by_type == {"flatness": 0.05, "position": 0.1016}


def test_plain_step_reports_no_gdt():
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "plain.step")
        writer = STEPControl_Writer()
        writer.Transfer(BRepPrimAPI_MakeBox(40.0, 30.0, 20.0).Shape(), STEPControl_AsIs)
        assert writer.Write(path) == IFSelect_RetDone
        result = read_step_gdt(path)

    assert result == {"status": "no_tolerance_entities", "gdt_callouts": [], "unresolved": []}
