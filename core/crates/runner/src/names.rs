//! File names on the wire to the worker. The worker keeps no folders, so every input is written as `NNNN_<basename>`: two
//! files with the same name in different folders cannot collide, and the position prefix is the contract that makes part
//! ids unique across files (`part ids start with the file's position`). The report is mapped back to the zip's own paths.

use domain::Report;

pub fn wire_name(index: usize, path: &str) -> String {
    let base = path.rsplit('/').next().unwrap_or(path);
    format!("{index:04}_{base}")
}

/// The entry name of a part's STEP file (a definition id holds ':', which is not portable in file names).
pub fn part_file_name(definition: &str) -> String {
    format!("{}.step", definition.replace(':', "_"))
}

/// Replaces every wire name in the report with the path the file had in the upload. Unknown names are left as they are.
pub fn restore_file_names(report: &mut Report, paths: &[String]) {
    let original: std::collections::HashMap<String, &String> = paths
        .iter()
        .enumerate()
        .map(|(i, p)| (wire_name(i, p), p))
        .collect();
    let back = |name: &str| {
        original
            .get(name)
            .map_or_else(|| name.to_string(), |p| (*p).clone())
    };

    fn nodes(list: &mut [domain::Node], back: &dyn Fn(&str) -> String) {
        for node in list {
            node.file = back(&node.file);
            nodes(&mut node.children, back);
        }
    }
    for input in &mut report.inputs {
        input.file = back(&input.file);
        input.inside = input.inside.as_deref().map(back);
    }
    nodes(&mut report.assembly, &back);
    for part in &mut report.parts {
        part.file = back(&part.file);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use domain::{Input, InputStatus, Kind, Node, Part, Report, Status};

    #[test]
    fn wire_names_keep_position_and_drop_folders() {
        assert_eq!(wire_name(0, "Pack/a.step"), "0000_a.step");
        assert_eq!(wire_name(12, "b.step"), "0012_b.step");
        assert_ne!(wire_name(0, "x/same.step"), wire_name(1, "y/same.step"));
    }

    #[test]
    fn part_file_names_have_no_colons() {
        assert_eq!(part_file_name("0:1:1:3"), "0_1_1_3.step");
    }

    #[test]
    fn the_report_is_mapped_back_to_the_zip_paths() {
        let paths = vec![
            "Pack/top.step".to_string(),
            "Pack/parts/bolt.step".to_string(),
        ];
        let leaf = Node {
            definition: "1:1".into(),
            name: "Bolt".into(),
            kind: Kind::Part,
            quantity: 1,
            file: wire_name(1, &paths[1]),
            children: vec![],
        };
        let root = Node {
            definition: "0:1".into(),
            name: "Top".into(),
            kind: Kind::Assembly,
            quantity: 1,
            file: wire_name(0, &paths[0]),
            children: vec![leaf],
        };
        let mut report = Report {
            schema_version: 1,
            units: "mm".into(),
            status: Status::Complete,
            inputs: vec![Input {
                file: wire_name(1, &paths[1]),
                status: InputStatus::Ok,
                inside: Some(wire_name(0, &paths[0])),
            }],
            assembly: vec![root],
            parts: vec![Part {
                id: "1:1".into(),
                name: "Bolt".into(),
                file: wire_name(1, &paths[1]),
                quantity_total: 1,
                volume_mm3: None,
                surface_area_mm2: None,
                bounding_box: None,
            }],
            problems: vec![],
        };
        restore_file_names(&mut report, &paths);
        assert_eq!(report.inputs[0].file, "Pack/parts/bolt.step");
        assert_eq!(report.inputs[0].inside.as_deref(), Some("Pack/top.step"));
        assert_eq!(report.assembly[0].file, "Pack/top.step");
        assert_eq!(report.assembly[0].children[0].file, "Pack/parts/bolt.step");
        assert_eq!(report.parts[0].file, "Pack/parts/bolt.step");
    }
}
