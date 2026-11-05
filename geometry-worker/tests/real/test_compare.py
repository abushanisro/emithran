import unittest

from compare import Stats, categorize, compare_bom, compare_reports

PART = {"id": "0:1", "name": "Gear", "file": "a.step", "quantity_total": 2, "volume_mm3": 1000.0, "surface_area_mm2": 600.0,
        "bounding_box": {"length": 20.0, "width": 10.0, "height": 5.0, "diagonal": 23.0}}


def report(**over):
    base = {"schema_version": 1, "units": "mm", "status": "complete", "inputs": [{"file": "a.step", "status": "ok", "inside": None}],
            "assembly": [{"definition": "0:1", "name": "Gear", "kind": "part", "quantity": 2, "file": "a.step", "children": []}],
            "parts": [dict(PART)], "problems": []}
    base.update(over)
    return base


class CompareReports(unittest.TestCase):
    def test_identical_reports_have_no_findings(self):
        self.assertEqual(compare_reports(report(), report()), [])

    def test_a_difference_inside_the_tolerance_is_not_a_finding_but_is_measured(self):
        stats = Stats()
        other = report(parts=[{**PART, "volume_mm3": 1000.4}])
        self.assertEqual(compare_reports(report(), other, stats), [])
        self.assertAlmostEqual(stats.max_rel["parts[0:1].volume_mm3"], 0.0004)

    def test_a_volume_beyond_the_tolerance_is_geometry(self):
        found = compare_reports(report(), report(parts=[{**PART, "volume_mm3": 1010.0}]))
        self.assertEqual([(f["category"], f["path"]) for f in found], [("geometry", "parts[0:1].volume_mm3")])

    def test_a_quantity_is_not_geometry(self):
        found = compare_reports(report(), report(parts=[{**PART, "quantity_total": 3}]))
        self.assertEqual([f["category"] for f in found], ["quantity"])

    def test_a_missing_key_is_named_and_says_which_side_lacks_it(self):
        part = dict(PART)
        del part["bounding_box"]
        found = compare_reports(report(), report(parts=[part]))
        self.assertEqual([(f["category"], f["path"], f["detail"]) for f in found], [("missing_field", "parts[0:1].bounding_box", "only in python")])

    def test_status_and_problems_are_processing(self):
        found = compare_reports(report(), report(status="partial", problems=[{"part": "0:1", "code": "invalid_geometry"}]))
        self.assertEqual({f["category"] for f in found}, {"processing"})
        self.assertGreaterEqual(len(found), 2)

    def test_parts_are_matched_by_id_not_by_position(self):
        other = {**PART, "id": "0:2", "name": "Shaft"}
        a = report(parts=[dict(PART), other])
        b = report(parts=[other, dict(PART)])
        self.assertEqual(compare_reports(a, b), [])

    def test_a_part_on_one_side_only_is_structure(self):
        found = compare_reports(report(), report(parts=[]))
        self.assertIn(("structure", "parts[0:1]"), [(f["category"], f["path"]) for f in found])

    def test_a_different_tree_is_structure(self):
        tree = [{"definition": "0:1", "name": "Renamed", "kind": "part", "quantity": 2, "file": "a.step", "children": []}]
        found = compare_reports(report(), report(assembly=tree))
        self.assertEqual([(f["category"], f["path"]) for f in found], [("structure", "assembly[0].name")])

    def test_categorize(self):
        self.assertEqual(categorize("parts[0:1].bounding_box.length"), "geometry")
        self.assertEqual(categorize("assembly[0].children[1].quantity"), "quantity")
        self.assertEqual(categorize("inputs[a.step].status"), "processing")
        self.assertEqual(categorize("assembly[0].name"), "structure")


class CompareBom(unittest.TestCase):
    items = [{"id": "i1", "parentItemId": None, "name": "liner", "itemType": "assembly", "quantity": 1, "volume": None},
             {"id": "i2", "parentItemId": "i1", "name": "Gear", "itemType": "child_part", "quantity": 2, "volume": 1000.0}]

    def test_the_fakes_own_ids_do_not_matter_but_the_tree_does(self):
        renamed = [{**self.items[0], "id": "x1"}, {**self.items[1], "id": "x2", "parentItemId": "x1"}]
        self.assertEqual(compare_bom(self.items, renamed), [])
        orphan = [self.items[0], {**self.items[1], "parentItemId": None}]
        self.assertEqual([f["path"] for f in compare_bom(self.items, orphan)], ["bom[1].parentItemId"])


if __name__ == "__main__":
    unittest.main()
