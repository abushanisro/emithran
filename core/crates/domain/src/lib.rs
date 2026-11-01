//! The assembly report the geometry worker writes (`cad-engine/contract/assembly.schema.json`, version 1) and the rules it must
//! obey. The JSON Schema checks the shape; `verify` checks what a schema cannot: that the numbers agree with each other.
//! No I/O: the same function guards a worker's output before it is stored, and it is the unit-test oracle for the worker.

#![cfg_attr(
    test,
    allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::indexing_slicing,
        clippy::panic
    )
)]

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

/// A product tree nests a few levels; the worker refuses deeper (Petrus and the Python engine use the same bound).
pub const MAX_DEPTH: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Part,
    Assembly,
    EmptyAssembly,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub definition: String,
    pub name: String,
    pub kind: Kind,
    /// Instances under the parent.
    pub quantity: u64,
    pub file: String,
    pub children: Vec<Node>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BoundingBox {
    pub length: f64,
    pub width: f64,
    pub height: f64,
    pub diagonal: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Part {
    pub id: String,
    pub name: String,
    pub file: String,
    pub quantity_total: u64,
    pub volume_mm3: Option<f64>,
    pub surface_area_mm2: Option<f64>,
    pub bounding_box: Option<BoundingBox>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InputStatus {
    Ok,
    Unreadable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Input {
    pub file: String,
    pub status: InputStatus,
    pub inside: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Problem {
    pub part: String,
    pub code: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Complete,
    Partial,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Report {
    pub schema_version: u32,
    pub units: String,
    pub status: Status,
    pub inputs: Vec<Input>,
    pub assembly: Vec<Node>,
    pub parts: Vec<Part>,
    pub problems: Vec<Problem>,
}

/// Total quantity of every part definition: quantities multiply down each path of the tree.
pub fn part_totals(roots: &[Node]) -> HashMap<&str, u64> {
    fn walk<'a>(node: &'a Node, factor: u64, totals: &mut HashMap<&'a str, u64>) {
        let factor = factor.saturating_mul(node.quantity);
        if node.kind == Kind::Part {
            let total = totals.entry(node.definition.as_str()).or_insert(0);
            *total = total.saturating_add(factor);
        }
        for child in &node.children {
            walk(child, factor, totals);
        }
    }
    let mut totals = HashMap::new();
    for root in roots {
        walk(root, 1, &mut totals);
    }
    totals
}

/// Every way the report disagrees with itself. Empty means it can be trusted. (A wrong number is worse than a missing one:
/// the worker writes `null` and a problem code for what it could not measure, and this refuses anything that is neither.)
/// An OCAF entry id as the worker writes it: `^[0-9]+(:[0-9]+)*$`. The runner puts part ids into file names
/// (`parts/<id>.step`) and storage keys, so anything else (a `/`, `..`, an empty segment) is refused here.
pub fn is_entry_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .split(':')
            .all(|segment| !segment.is_empty() && segment.bytes().all(|b| b.is_ascii_digit()))
}

pub fn verify(report: &Report) -> Vec<String> {
    let mut found = Vec::new();
    if report.schema_version != 1 {
        found.push(format!(
            "schema_version is {}, this core reads 1",
            report.schema_version
        ));
    }
    if report.units != "mm" {
        found.push(format!("units is {:?}, expected \"mm\"", report.units));
    }

    fn walk(node: &Node, depth: usize, found: &mut Vec<String>) {
        if !is_entry_id(&node.definition) {
            found.push(format!(
                "{:?}: a definition id must be digits separated by ':'",
                node.definition
            ));
        }
        if node.quantity == 0 {
            found.push(format!("{}: quantity is 0", node.definition));
        }
        if depth > MAX_DEPTH {
            found.push(format!(
                "{}: nested deeper than {MAX_DEPTH} levels",
                node.definition
            ));
            return;
        }
        match (node.kind, node.children.is_empty()) {
            (Kind::Assembly, true) => found.push(format!(
                "{}: an assembly with no children (should be empty_assembly)",
                node.definition
            )),
            (Kind::Part | Kind::EmptyAssembly, false) => found.push(format!(
                "{}: only an assembly has children",
                node.definition
            )),
            _ => {}
        }
        for child in &node.children {
            walk(child, depth + 1, found);
        }
    }
    for root in &report.assembly {
        walk(root, 0, &mut found);
    }

    let mut ids = HashSet::new();
    for part in &report.parts {
        if !is_entry_id(&part.id) {
            found.push(format!(
                "{:?}: a part id must be digits separated by ':'",
                part.id
            ));
        }
        if !ids.insert(part.id.as_str()) {
            found.push(format!("{}: listed twice in parts", part.id));
        }
        let measures = [part.volume_mm3, part.surface_area_mm2];
        if measures
            .iter()
            .flatten()
            .any(|v| !v.is_finite() || *v < 0.0)
        {
            found.push(format!(
                "{}: a measurement is negative or not a number",
                part.id
            ));
        }
        if let Some(b) = &part.bounding_box {
            let sorted = b.length >= b.width && b.width >= b.height && b.height >= 0.0;
            if ![b.length, b.width, b.height, b.diagonal]
                .iter()
                .all(|v| v.is_finite())
                || !sorted
            {
                found.push(format!(
                    "{}: bounding box is not finite and sorted longest first",
                    part.id
                ));
            }
        }
    }

    // Each part in the tree is listed once with the total the tree implies; nothing else is listed.
    let totals = part_totals(&report.assembly);
    for (definition, total) in &totals {
        match report.parts.iter().find(|p| p.id == *definition) {
            None => found.push(format!("{definition}: in the tree but missing from parts")),
            Some(part) if part.quantity_total != *total => {
                found.push(format!(
                    "{definition}: quantity_total is {} but the tree gives {total}",
                    part.quantity_total
                ));
            }
            Some(_) => {}
        }
    }
    for part in &report.parts {
        if !totals.contains_key(part.id.as_str()) {
            found.push(format!("{}: in parts but not in the tree", part.id));
        }
    }

    // A part without a measurement must say why; a problem must point at something real.
    let unmeasured = |p: &Part| {
        p.volume_mm3.is_none() || p.surface_area_mm2.is_none() || p.bounding_box.is_none()
    };
    for part in report.parts.iter().filter(|p| unmeasured(p)) {
        if !report.problems.iter().any(|p| p.part == part.id) {
            found.push(format!(
                "{}: not measured and no problem code explains it",
                part.id
            ));
        }
    }

    // `complete` is a promise: every input was read.
    if report.status == Status::Complete
        && report
            .inputs
            .iter()
            .any(|i| i.status == InputStatus::Unreadable)
    {
        found.push("status is complete but an input was unreadable".to_string());
    }
    if report.status == Status::Complete && report.assembly.is_empty() {
        found.push("status is complete but there is no assembly".to_string());
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node(definition: &str, kind: Kind, quantity: u64, children: Vec<Node>) -> Node {
        Node {
            definition: definition.into(),
            name: definition.into(),
            kind,
            quantity,
            file: "a.step".into(),
            children,
        }
    }

    fn part(id: &str, total: u64) -> Part {
        Part {
            id: id.into(),
            name: id.into(),
            file: "a.step".into(),
            quantity_total: total,
            volume_mm3: Some(6000.0),
            surface_area_mm2: Some(2200.0),
            bounding_box: Some(BoundingBox {
                length: 30.0,
                width: 20.0,
                height: 10.0,
                diagonal: 37.4166,
            }),
        }
    }

    /// The nested assembly the engine's own fixtures describe: Top = 2 x Sub + 1 Cyl; Sub = 2 x Box + 1 Cyl.
    fn nested() -> Report {
        let sub = node(
            "0:1:1:2",
            Kind::Assembly,
            2,
            vec![
                node("0:1:1:3", Kind::Part, 2, vec![]),
                node("0:1:1:4", Kind::Part, 1, vec![]),
            ],
        );
        let top = node(
            "0:1:1:1",
            Kind::Assembly,
            1,
            vec![sub, node("0:1:1:4", Kind::Part, 1, vec![])],
        );
        Report {
            schema_version: 1,
            units: "mm".into(),
            status: Status::Complete,
            inputs: vec![Input {
                file: "a.step".into(),
                status: InputStatus::Ok,
                inside: None,
            }],
            assembly: vec![top],
            parts: vec![part("0:1:1:3", 4), part("0:1:1:4", 3)],
            problems: vec![],
        }
    }

    #[test]
    fn quantities_multiply_down_each_path() {
        let report = nested();
        let totals = part_totals(&report.assembly);
        assert_eq!(totals.get("0:1:1:3"), Some(&4)); // Box: 2 Sub x 2
        assert_eq!(totals.get("0:1:1:4"), Some(&3)); // Cyl: 2 Sub x 1 + 1 in Top
    }

    #[test]
    fn a_consistent_report_has_no_violations() {
        assert_eq!(verify(&nested()), Vec::<String>::new());
    }

    #[test]
    fn a_wrong_total_is_caught() {
        let mut report = nested();
        report.parts[0].quantity_total = 5;
        assert_eq!(
            verify(&report),
            vec!["0:1:1:3: quantity_total is 5 but the tree gives 4".to_string()]
        );
    }

    #[test]
    fn a_part_in_the_tree_but_not_listed_and_one_listed_but_absent_are_caught() {
        let mut report = nested();
        report.parts.remove(1);
        report.parts.push(part("9:9", 1));
        let found = verify(&report);
        assert!(found.contains(&"0:1:1:4: in the tree but missing from parts".to_string()));
        assert!(found.contains(&"9:9: in parts but not in the tree".to_string()));
    }

    #[test]
    fn a_missing_measurement_needs_a_reason() {
        let mut report = nested();
        report.parts[0].volume_mm3 = None;
        assert_eq!(
            verify(&report),
            vec!["0:1:1:3: not measured and no problem code explains it".to_string()]
        );
        report.problems.push(Problem {
            part: "0:1:1:3".into(),
            code: "failed:measure".into(),
        });
        assert_eq!(verify(&report), Vec::<String>::new());
    }

    #[test]
    fn impossible_numbers_are_refused() {
        let mut report = nested();
        report.parts[0].volume_mm3 = Some(-1.0);
        report.parts[1].bounding_box = Some(BoundingBox {
            length: 1.0,
            width: 5.0,
            height: 1.0,
            diagonal: 5.2,
        });
        let found = verify(&report);
        assert!(found.iter().any(|f| f.contains("negative or not a number")));
        assert!(found.iter().any(|f| f.contains("sorted longest first")));
    }

    #[test]
    fn structure_rules_hold() {
        let mut report = nested();
        report.assembly.push(node("x", Kind::Assembly, 1, vec![]));
        report.assembly.push(node(
            "y",
            Kind::Part,
            0,
            vec![node("z", Kind::Part, 1, vec![])],
        ));
        let found = verify(&report);
        assert!(
            found
                .iter()
                .any(|f| f.starts_with("x: an assembly with no children"))
        );
        assert!(found.iter().any(|f| f.starts_with("y: quantity is 0")));
        assert!(
            found
                .iter()
                .any(|f| f.starts_with("y: only an assembly has children"))
        );
    }

    #[test]
    fn complete_means_every_input_was_read() {
        let mut report = nested();
        report.inputs.push(Input {
            file: "bad.step".into(),
            status: InputStatus::Unreadable,
            inside: None,
        });
        assert_eq!(
            verify(&report),
            vec!["status is complete but an input was unreadable".to_string()]
        );
        report.status = Status::Partial;
        assert_eq!(verify(&report), Vec::<String>::new());
    }

    #[test]
    fn nesting_past_the_bound_is_refused_without_overflowing_the_stack() {
        let mut deep = node("leaf", Kind::Part, 1, vec![]);
        for i in 0..(MAX_DEPTH + 5) {
            deep = node(&format!("a{i}"), Kind::Assembly, 1, vec![deep]);
        }
        let mut report = nested();
        report.assembly = vec![deep];
        assert!(
            verify(&report)
                .iter()
                .any(|f| f.contains("nested deeper than 64 levels"))
        );
    }

    #[test]
    fn an_id_that_could_become_a_path_is_refused() {
        for bad in ["../../x", "0:1/../2", "", "0::1", ":1", "1:", "0:1:a", "1 "] {
            assert!(!is_entry_id(bad), "{bad:?} must be refused");
        }
        for good in ["0", "0:1", "0:1:1:12"] {
            assert!(is_entry_id(good), "{good:?} must be accepted");
        }

        let mut report = nested();
        report.parts[0].id = "../../x".into();
        let found = verify(&report);
        assert!(
            found.contains(&"\"../../x\": a part id must be digits separated by ':'".to_string())
        );

        let mut report = nested();
        if let Some(root) = report.assembly.first_mut() {
            root.definition = "../../x".into();
        }
        assert!(
            verify(&report)
                .iter()
                .any(|f| f.starts_with("\"../../x\": a definition id"))
        );
    }

    #[test]
    fn the_json_the_python_engine_writes_parses() {
        let json = r#"{"schema_version":1,"units":"mm","status":"partial","inputs":[{"file":"a.step","status":"unreadable","inside":null}],
            "assembly":[],"parts":[],"problems":[],"future_field":true}"#;
        let report: Report = serde_json::from_str(json).expect("contract json");
        assert_eq!(report.status, Status::Partial);
    }
}
