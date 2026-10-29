//! True-shape nesting of ONE part type on one sheet: extreme-point bottom-left-fill with real polygon collision. A port of
//! `cad-engine/sheet_metal/nesting.py` that keeps its behaviour (same candidate anchors and order, same rotation order, the same
//! kerf-offset anchors, the same dead-anchor rule, the same evaluation cap and its `capped` flag) so the placements, and therefore
//! the material cost that is derived from them, do not drift. What changes is the cost of each step.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::geom::{self, Bounds, Point};

pub const DEFAULT_ROTATIONS_DEG: [f64; 4] = [0.0, 90.0, 180.0, 270.0];
/// Trial evaluations (anchor x rotation) allowed while filling one sheet; the Python nester's bound. A request may raise it.
pub const MAX_EVALUATIONS: u64 = 150_000;
const EDGE_TOLERANCE: f64 = 1e-6;
/// How often the wall-clock deadline is looked at (in evaluations).
const DEADLINE_CHECK_EVERY: u64 = 64;

fn two() -> f64 {
    2.0
}

/// The `POST /nest` request of cad-engine, unchanged, plus two optional limits.
#[derive(Debug, Deserialize)]
pub struct Request {
    pub outline_points_mm: Vec<Point>,
    #[serde(default)]
    #[allow(dead_code)]
    pub holes_mm: Vec<serde_json::Value>,
    pub sheet_width_mm: f64,
    pub sheet_length_mm: f64,
    pub quantity: i64,
    #[serde(default)]
    pub kerf_mm: f64,
    #[serde(default = "two")]
    pub edge_margin_mm: f64,
    #[serde(default)]
    pub allowed_rotations_deg: Option<Vec<f64>>,
    #[serde(default)]
    pub max_evaluations: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Placement {
    pub x_mm: f64,
    pub y_mm: f64,
    pub rotation_deg: f64,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Nest {
    pub sheet_width_mm: f64,
    pub sheet_length_mm: f64,
    pub parts_per_sheet: usize,
    pub placements: Vec<Placement>,
    pub utilization_pct: f64,
    pub sheets_required: Option<u64>,
    pub capped: bool,
}

/// Python's `round(x, ndigits)`: correctly rounded from the exact binary value, ties to even.
fn round_to(x: f64, digits: usize) -> f64 {
    format!("{x:.digits$}").parse().unwrap_or(x)
}

/// A totally ordered anchor (y first, then x: bottom-to-top, left-to-right), -0.0 normalised to 0.0.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
struct Anchor(u64, u64);

fn key(v: f64) -> u64 {
    // map f64 to a u64 whose integer order is the float order
    let bits = (if v == 0.0 { 0.0 } else { v }).to_bits();
    if bits >> 63 == 1 {
        !bits
    } else {
        bits | (1 << 63)
    }
}

fn unkey(k: u64) -> f64 {
    f64::from_bits(if k >> 63 == 1 { k & !(1 << 63) } else { !k })
}

impl Anchor {
    fn new(x: f64, y: f64) -> Anchor {
        Anchor(key(y), key(x))
    }
    fn x(self) -> f64 {
        unkey(self.1)
    }
    fn y(self) -> f64 {
        unkey(self.0)
    }
}

struct Variant {
    angle: f64,
    ring: Vec<Point>,
    min_x: f64,
    min_y: f64,
    width: f64,
    height: f64,
}

pub fn compute(request: &Request, deadline: Option<Instant>) -> Result<Nest, String> {
    let n_points = request.outline_points_mm.len();
    let Some(base) = geom::clean_outline(&request.outline_points_mm) else {
        return Err(if n_points < 3 {
            format!("outline has only {n_points} point(s) -- need at least 3 to form a polygon")
        } else {
            format!(
                "outline with {n_points} points failed to form a valid polygon (self-intersecting/degenerate topology that \
                 buffer(0) repair could not resolve, or the repaired geometry has zero area)"
            )
        });
    };

    let rotations: Vec<f64> = match &request.allowed_rotations_deg {
        Some(list) if !list.is_empty() => list.clone(),
        _ => DEFAULT_ROTATIONS_DEG.to_vec(),
    };
    let margin = request.edge_margin_mm;
    let usable_w = request.sheet_width_mm - 2.0 * margin;
    let usable_l = request.sheet_length_mm - 2.0 * margin;
    if usable_w <= 0.0 || usable_l <= 0.0 {
        return Err(format!(
            "sheet {}x{}mm with edge_margin_mm={} leaves a non-positive usable area ({usable_w:.1}x{usable_l:.1}mm)",
            request.sheet_width_mm, request.sheet_length_mm, margin
        ));
    }
    let kerf = request.kerf_mm.max(0.0);
    let half_kerf = kerf / 2.0;

    let variants: Vec<Variant> = rotations
        .iter()
        .map(|&angle| {
            let ring = geom::rotate(&base, angle);
            let b = Bounds::of(&ring);
            Variant {
                angle,
                min_x: b.min_x,
                min_y: b.min_y,
                width: b.max_x - b.min_x,
                height: b.max_y - b.min_y,
                ring,
            }
        })
        .collect();

    if variants
        .iter()
        .all(|v| v.width > usable_w || v.height > usable_l)
    {
        let best = variants
            .iter()
            .min_by(|a, b| {
                (a.width - usable_w)
                    .max(a.height - usable_l)
                    .total_cmp(&(b.width - usable_w).max(b.height - usable_l))
            })
            .map_or_else(|| (0.0, 0.0, 0.0), |v| (v.angle, v.width, v.height));
        return Err(format!(
            "part outline (bbox at its best-fitting rotation of {}deg is {:.1}x{:.1}mm) does not fit the sheet's usable area \
             ({usable_w:.1}x{usable_l:.1}mm) at any of the {} allowed rotations ({rotations:?})",
            best.0,
            best.1,
            best.2,
            rotations.len()
        ));
    }

    let sheet_min = (margin, margin);
    let sheet_max = (margin + usable_w, margin + usable_l);
    let cell = variants
        .iter()
        .map(|v| v.width.max(v.height))
        .fold(1.0_f64, f64::max);
    let max_evaluations = request.max_evaluations.unwrap_or(MAX_EVALUATIONS);

    // Each placed part with its bounds grown by kerf/2 (like the grown shapes the Python nester tests) and the stamp of the last
    // candidate that looked at it (so a part sharing several grid cells with a candidate is tested once).
    struct Placed {
        ring: Vec<Point>,
        grown: Bounds,
        seen: u64,
    }
    let mut placed: Vec<Placed> = Vec::new();
    let mut grid: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    let mut placements: Vec<Placement> = Vec::new();

    let cells = |b: &Bounds| {
        let (x0, y0, x1, y1) = (
            (b.min_x / cell).floor() as i64,
            (b.min_y / cell).floor() as i64,
            (b.max_x / cell).floor() as i64,
            (b.max_y / cell).floor() as i64,
        );
        (x0..=x1).flat_map(move |cx| (y0..=y1).map(move |cy| (cx, cy)))
    };

    let mut live: BTreeSet<Anchor> = BTreeSet::from([Anchor::new(sheet_min.0, sheet_min.1)]);
    let mut dead: HashSet<Anchor> = HashSet::new();
    let mut stamp: u64 = 0;
    let mut evaluations: u64 = 0;
    let mut capped = false;

    'fill: loop {
        let mut placed_this_round = false;
        // Anchors are tried bottom-to-top, left-to-right. One that fails at every rotation can never succeed later (obstacles only
        // grow), so it is dropped for good; one that places ends the round, and the next round starts again from the lowest anchor.
        while let Some(&anchor) = live.first() {
            let (ax, ay) = (anchor.x(), anchor.y());
            if ax >= sheet_max.0 || ay >= sheet_max.1 {
                live.remove(&anchor);
                dead.insert(anchor);
                continue;
            }
            let mut found = false;
            for variant in &variants {
                evaluations += 1;
                if evaluations > max_evaluations
                    || (evaluations.is_multiple_of(DEADLINE_CHECK_EVERY)
                        && deadline.is_some_and(|d| Instant::now() > d))
                {
                    capped = true;
                    break;
                }
                if ax + variant.width > sheet_max.0 + EDGE_TOLERANCE
                    || ay + variant.height > sheet_max.1 + EDGE_TOLERANCE
                {
                    continue;
                }
                let (dx, dy) = (ax - variant.min_x, ay - variant.min_y);
                let candidate = geom::translate(&variant.ring, dx, dy);
                let b = Bounds::of(&candidate);
                if b.min_x < sheet_min.0 - EDGE_TOLERANCE
                    || b.min_y < sheet_min.1 - EDGE_TOLERANCE
                    || b.max_x > sheet_max.0 + EDGE_TOLERANCE
                    || b.max_y > sheet_max.1 + EDGE_TOLERANCE
                {
                    continue;
                }
                let grown = b.grown(half_kerf);
                stamp += 1;
                let mut clear = true;
                'neighbours: for c in cells(&grown) {
                    for &idx in grid.get(&c).map_or(&[][..], Vec::as_slice) {
                        let Some(other) = placed.get_mut(idx) else {
                            continue;
                        };
                        if other.seen == stamp {
                            continue;
                        }
                        other.seen = stamp;
                        // a cheap box test first, then the exact one
                        if grown.meets(&other.grown)
                            && geom::conflicts(&candidate, &other.ring, kerf)
                        {
                            clear = false;
                            break 'neighbours;
                        }
                    }
                }
                if !clear {
                    continue;
                }

                let index = placed.len();
                for c in cells(&grown) {
                    grid.entry(c).or_default().push(index);
                }
                placed.push(Placed {
                    ring: candidate,
                    grown,
                    seen: 0,
                });
                placements.push(Placement {
                    x_mm: round_to(dx, 3),
                    y_mm: round_to(dy, 3),
                    rotation_deg: variant.angle,
                });
                // The next positions that are ALREADY `kerf` clear of this part (not its touching corners, which could never pass the
                // clearance test), at its bottom-right and top-left.
                for next in [
                    Anchor::new(b.max_x + request.kerf_mm, b.min_y),
                    Anchor::new(b.min_x, b.max_y + request.kerf_mm),
                ] {
                    if !dead.contains(&next) {
                        live.insert(next);
                    }
                }
                found = true;
                break;
            }
            if capped {
                break 'fill;
            }
            if found {
                placed_this_round = true;
                break;
            }
            live.remove(&anchor);
            dead.insert(anchor);
        }
        if !placed_this_round {
            break;
        }
    }

    let parts = placements.len();
    let usable_area = usable_w * usable_l;
    let base_area = geom::signed_area(&base).abs();
    let utilization = if parts == 0 {
        0.0
    } else if usable_area > 0.0 {
        round_to(100.0 * (base_area * parts as f64) / usable_area, 1)
    } else {
        0.0
    };
    let sheets_required = (parts > 0 && request.quantity > 0)
        .then(|| (request.quantity as u64).div_ceil(parts as u64));
    Ok(Nest {
        sheet_width_mm: request.sheet_width_mm,
        sheet_length_mm: request.sheet_length_mm,
        parts_per_sheet: parts,
        placements,
        utilization_pct: utilization,
        sheets_required,
        capped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(w: f64, h: f64) -> Vec<Point> {
        vec![[0.0, 0.0], [w, 0.0], [w, h], [0.0, h]]
    }

    fn request(
        outline: Vec<Point>,
        sheet: (f64, f64),
        quantity: i64,
        kerf: f64,
        margin: f64,
    ) -> Request {
        Request {
            outline_points_mm: outline,
            holes_mm: vec![],
            sheet_width_mm: sheet.0,
            sheet_length_mm: sheet.1,
            quantity,
            kerf_mm: kerf,
            edge_margin_mm: margin,
            allowed_rotations_deg: Some(vec![0.0]),
            max_evaluations: None,
        }
    }

    #[test]
    fn squares_fill_a_square_sheet_exactly() {
        // 100x100 usable (margin 0), 10x10 parts, no kerf: a 10x10 grid of 100
        let nest = compute(
            &request(rect(10.0, 10.0), (100.0, 100.0), 250, 0.0, 0.0),
            None,
        )
        .unwrap();
        assert_eq!(nest.parts_per_sheet, 100);
        assert_eq!(nest.utilization_pct, 100.0);
        assert_eq!(nest.sheets_required, Some(3));
        assert!(!nest.capped);
    }

    #[test]
    fn kerf_leaves_a_gap_between_parts() {
        // 10x10 parts with 2 mm kerf need 12 mm pitch: 100 mm fits 8 per row (8*10 + 7*2 = 94; a ninth would need 106)
        let nest = compute(
            &request(rect(10.0, 10.0), (100.0, 100.0), 1, 2.0, 0.0),
            None,
        )
        .unwrap();
        assert_eq!(nest.parts_per_sheet, 64);
    }

    #[test]
    fn the_edge_margin_shrinks_the_usable_area() {
        let nest = compute(
            &request(rect(10.0, 10.0), (100.0, 100.0), 1, 0.0, 5.0),
            None,
        )
        .unwrap();
        assert_eq!(nest.parts_per_sheet, 81); // 90 x 90 usable
        let first = &nest.placements[0];
        assert_eq!((first.x_mm, first.y_mm), (5.0, 5.0));
    }

    #[test]
    fn a_rotation_lets_a_long_part_fit() {
        let mut r = request(rect(80.0, 10.0), (50.0, 100.0), 1, 0.0, 0.0);
        assert!(
            compute(&r, None).is_err(),
            "80 mm does not fit a 50 mm wide sheet unrotated"
        );
        r.allowed_rotations_deg = Some(vec![0.0, 90.0]);
        let nest = compute(&r, None).unwrap();
        assert!(
            nest.parts_per_sheet >= 1 && nest.placements.iter().all(|p| p.rotation_deg == 90.0)
        );
    }

    #[test]
    fn an_l_shape_interlocks_with_a_copy_rotated_into_its_notch() {
        let l = vec![
            [0.0, 0.0],
            [20.0, 0.0],
            [20.0, 10.0],
            [10.0, 10.0],
            [10.0, 20.0],
            [0.0, 20.0],
        ];
        let mut r = request(l, (40.0, 20.0), 1, 0.0, 0.0);
        r.allowed_rotations_deg = Some(vec![0.0, 90.0, 180.0, 270.0]);
        let nest = compute(&r, None).unwrap();
        // area 300 each, sheet 800: two Ls tile a 20x30 region by interlocking, which a bounding-box packer (400 each) cannot do
        assert!(nest.parts_per_sheet >= 2, "got {}", nest.parts_per_sheet);
    }

    #[test]
    fn refusals_say_why() {
        assert!(
            compute(
                &request(vec![[0.0, 0.0], [1.0, 1.0]], (10.0, 10.0), 1, 0.0, 0.0),
                None
            )
            .unwrap_err()
            .contains("only 2 point(s)")
        );
        assert!(
            compute(&request(rect(10.0, 10.0), (10.0, 10.0), 1, 0.0, 6.0), None)
                .unwrap_err()
                .contains("non-positive usable area")
        );
        assert!(
            compute(
                &request(rect(200.0, 200.0), (100.0, 100.0), 1, 0.0, 0.0),
                None
            )
            .unwrap_err()
            .contains("does not fit the sheet's usable area")
        );
    }

    #[test]
    fn the_evaluation_cap_returns_a_partial_honest_answer() {
        let mut r = request(rect(1.0, 1.0), (1000.0, 1000.0), 1, 0.0, 0.0);
        r.max_evaluations = Some(500);
        let nest = compute(&r, None).unwrap();
        assert!(nest.capped);
        assert!(nest.parts_per_sheet > 0 && nest.parts_per_sheet < 500);
    }

    #[test]
    fn a_zero_deadline_stops_the_work() {
        let r = request(rect(1.0, 1.0), (1000.0, 1000.0), 1, 0.0, 0.0);
        let nest = compute(&r, Some(Instant::now())).unwrap();
        assert!(nest.capped);
    }

    #[test]
    fn rounding_matches_pythons_round() {
        assert_eq!(round_to(2.675, 2), 2.67); // the classic: 2.675 is stored a little below
        assert_eq!(round_to(0.5, 0), 0.0); // ties to even
        assert_eq!(round_to(1.2345678, 3), 1.235);
    }

    #[test]
    fn anchor_order_is_bottom_to_top_then_left_to_right() {
        let mut set = BTreeSet::new();
        for (x, y) in [(5.0, 1.0), (1.0, 2.0), (0.0, 1.0), (-3.0, 1.0)] {
            set.insert(Anchor::new(x, y));
        }
        let order: Vec<(f64, f64)> = set.iter().map(|a| (a.x(), a.y())).collect();
        assert_eq!(order, vec![(-3.0, 1.0), (0.0, 1.0), (5.0, 1.0), (1.0, 2.0)]);
    }
}
