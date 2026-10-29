//! The small amount of 2D geometry the nester needs: points, rotation, bounds, area, and whether two polygons conflict at a given
//! kerf. Plain `f64` throughout so a placement computed here is the same number a Python/shapely run computes (shapely's affine
//! rotate and translate are reproduced operation for operation).

use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::float::single::SingleFloatOverlay;

pub type Point = [f64; 2];

/// Overlap area (mm2) below which two parts are considered merely touching. The same threshold the Python nester uses.
pub const OVERLAP_EPS: f64 = 1e-6;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Bounds {
    pub fn of(points: &[Point]) -> Bounds {
        let mut b = Bounds {
            min_x: f64::INFINITY,
            min_y: f64::INFINITY,
            max_x: f64::NEG_INFINITY,
            max_y: f64::NEG_INFINITY,
        };
        for p in points {
            b.min_x = b.min_x.min(p[0]);
            b.min_y = b.min_y.min(p[1]);
            b.max_x = b.max_x.max(p[0]);
            b.max_y = b.max_y.max(p[1]);
        }
        b
    }

    pub fn width(&self) -> f64 {
        self.max_x - self.min_x
    }

    pub fn height(&self) -> f64 {
        self.max_y - self.min_y
    }

    pub fn grown(&self, by: f64) -> Bounds {
        Bounds {
            min_x: self.min_x - by,
            min_y: self.min_y - by,
            max_x: self.max_x + by,
            max_y: self.max_y + by,
        }
    }

    /// True when the boxes overlap or touch (shapely's `intersects` on envelopes).
    pub fn meets(&self, other: &Bounds) -> bool {
        self.min_x <= other.max_x
            && other.min_x <= self.max_x
            && self.min_y <= other.max_y
            && other.min_y <= self.max_y
    }
}

/// The edges of a closed ring, the last point joining back to the first.
fn edges(ring: &[Point]) -> impl Iterator<Item = (Point, Point)> + '_ {
    ring.iter()
        .copied()
        .zip(ring.iter().copied().cycle().skip(1))
}

/// Signed area (shoelace); positive for a counter-clockwise ring.
pub fn signed_area(ring: &[Point]) -> f64 {
    edges(ring)
        .map(|(a, b)| a[0] * b[1] - b[0] * a[1])
        .sum::<f64>()
        / 2.0
}

/// shapely.affinity.rotate(geom, angle, origin=(0, 0)): the sine and cosine below 2.5e-16 are zeroed so a quarter turn is exact.
pub fn rotate(ring: &[Point], degrees: f64) -> Vec<Point> {
    let radians = degrees.to_radians();
    let (mut sin, mut cos) = radians.sin_cos();
    if cos.abs() < 2.5e-16 {
        cos = 0.0;
    }
    if sin.abs() < 2.5e-16 {
        sin = 0.0;
    }
    ring.iter()
        .map(|p| [cos * p[0] + -sin * p[1], sin * p[0] + cos * p[1]])
        .collect()
}

pub fn translate(ring: &[Point], dx: f64, dy: f64) -> Vec<Point> {
    ring.iter().map(|p| [p[0] + dx, p[1] + dy]).collect()
}

// --- segments -------------------------------------------------------------------------------------------------------------

fn cross(o: Point, a: Point, b: Point) -> f64 {
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

fn on_segment(a: Point, b: Point, p: Point) -> bool {
    p[0] >= a[0].min(b[0])
        && p[0] <= a[0].max(b[0])
        && p[1] >= a[1].min(b[1])
        && p[1] <= a[1].max(b[1])
}

/// True when the closed segments share at least one point (crossing, touching, or overlapping collinearly).
fn segments_meet(a: Point, b: Point, c: Point, d: Point) -> bool {
    let (d1, d2, d3, d4) = (
        cross(c, d, a),
        cross(c, d, b),
        cross(a, b, c),
        cross(a, b, d),
    );
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0))
        && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0))
    {
        return true;
    }
    (d1 == 0.0 && on_segment(c, d, a))
        || (d2 == 0.0 && on_segment(c, d, b))
        || (d3 == 0.0 && on_segment(a, b, c))
        || (d4 == 0.0 && on_segment(a, b, d))
}

fn point_segment_distance_sq(p: Point, a: Point, b: Point) -> f64 {
    let (abx, aby) = (b[0] - a[0], b[1] - a[1]);
    let len_sq = abx * abx + aby * aby;
    let t = if len_sq == 0.0 {
        0.0
    } else {
        (((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len_sq).clamp(0.0, 1.0)
    };
    let (dx, dy) = (p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby));
    dx * dx + dy * dy
}

/// Point strictly inside the ring (even-odd); only meaningful when the point is not on the boundary.
fn contains_point(ring: &[Point], p: Point) -> bool {
    let mut inside = false;
    for (pj, pi) in edges(ring) {
        if (pi[1] > p[1]) != (pj[1] > p[1])
            && p[0] < (pj[0] - pi[0]) * (p[1] - pi[1]) / (pj[1] - pi[1]) + pi[0]
        {
            inside = !inside;
        }
    }
    inside
}

/// Area of the intersection of two rings (an exact boolean operation); used only when their boundaries touch or cross.
pub fn overlap_area(a: &[Point], b: &[Point]) -> f64 {
    // The 64-bit engine: the default 32-bit one snaps coordinates to about 1e-7 mm, whose area error exceeds the 1e-6 mm2 threshold.
    let shapes =
        a.to_vec()
            .overlay_as::<i64>(&b.to_vec(), OverlayRule::Intersect, FillRule::NonZero);
    shapes
        .iter()
        .map(|shape| {
            shape
                .iter()
                .enumerate()
                .map(|(i, ring)| {
                    if i == 0 {
                        signed_area(ring).abs()
                    } else {
                        -signed_area(ring).abs()
                    }
                })
                .sum::<f64>()
        })
        .sum()
}

/// Smallest distance between two closed segments (zero when they meet).
fn segment_distance_sq(a0: Point, a1: Point, b0: Point, b1: Point) -> f64 {
    if segments_meet(a0, a1, b0, b1) {
        return 0.0;
    }
    point_segment_distance_sq(a0, b0, b1)
        .min(point_segment_distance_sq(a1, b0, b1))
        .min(point_segment_distance_sq(b0, a0, a1))
        .min(point_segment_distance_sq(b1, a0, a1))
}

/// The edges of `ring` that come near `window` (their box meets it): the only edges that can be within clearance of the other part.
fn edges_near(ring: &[Point], window: &Bounds) -> Vec<(Point, Point)> {
    edges(ring)
        .filter(|&(p, q)| Bounds::of(&[p, q]).meets(window))
        .collect()
}

/// Is any edge of `a` closer than `limit` (mm) to any edge of `b`? Stops at the first such pair.
fn any_pair_closer_than(a: &[(Point, Point)], b: &[(Point, Point)], limit: f64) -> bool {
    let limit_sq = limit * limit;
    a.iter().any(|&(a0, a1)| {
        let seg = Bounds::of(&[a0, a1]).grown(limit);
        b.iter().any(|&(b0, b1)| {
            Bounds::of(&[b0, b1]).meets(&seg) && segment_distance_sq(a0, a1, b0, b1) <= limit_sq
        })
    })
}

fn contains_bounds(outer: &Bounds, inner: &Bounds, slack: f64) -> bool {
    outer.min_x - slack <= inner.min_x
        && outer.min_y - slack <= inner.min_y
        && outer.max_x + slack >= inner.max_x
        && outer.max_y + slack >= inner.max_y
}

/// Do two placed parts conflict with `kerf` mm of clearance required between them? Equivalent to the Python nester's test (each part
/// grown by kerf/2, conflict when the grown shapes overlap by more than 1e-6 mm2), without building the grown shapes: they overlap
/// exactly when the parts are closer than `kerf`. Only edges inside the overlap window of the two parts are compared.
pub fn conflicts(a: &[Point], b: &[Point], kerf: f64) -> bool {
    // Boundaries closer than this are treated as touching: floating point cannot say which side of the other part a vertex that is
    // 1e-15 mm away lies on (a circle's leftmost vertex is at y = 10 + 1.2e-15, its twin's rightmost at exactly 10).
    const TOUCH: f64 = 1e-9;
    let (ba, bb) = (Bounds::of(a), Bounds::of(b));
    let reach = kerf.max(0.0) + TOUCH;
    let (ga, gb) = (ba.grown(reach), bb.grown(reach));
    if !ga.meets(&bb) {
        return false; // farther apart than the clearance, and neither can contain the other
    }
    let window = Bounds {
        min_x: ga.min_x.max(gb.min_x),
        min_y: ga.min_y.max(gb.min_y),
        max_x: ga.max_x.min(gb.max_x),
        max_y: ga.max_y.min(gb.max_y),
    };
    let (near_a, near_b) = (edges_near(a, &window), edges_near(b, &window));

    if kerf > 0.0 {
        // Clearance required: any pair of edges closer than the kerf (touching and crossing included) is a conflict.
        if any_pair_closer_than(&near_a, &near_b, kerf - OVERLAP_EPS) {
            return true;
        }
    } else if any_pair_closer_than(&near_a, &near_b, TOUCH) {
        // No clearance: touching boundaries conflict only if the parts really overlap (butted edge to edge they overlap by zero area).
        return overlap_area(a, b) > OVERLAP_EPS;
    }
    // Boundaries are clearly apart: the one remaining conflict is a part lying entirely inside the other.
    (contains_bounds(&bb, &ba, 0.0)
        && b.len() >= 3
        && a.first().is_some_and(|&p| contains_point(b, p)))
        || (contains_bounds(&ba, &bb, 0.0) && b.first().is_some_and(|&p| contains_point(a, p)))
}

/// Repairs an outline the way shapely's `Polygon(points).buffer(0)` does, then keeps the largest piece: a ring that does not cross
/// itself is returned unchanged (numbers untouched); a self-intersecting one is resolved and its largest region taken.
pub fn clean_outline(points: &[Point]) -> Option<Vec<Point>> {
    let mut ring: Vec<Point> = Vec::with_capacity(points.len());
    for &p in points {
        if ring.last() != Some(&p) {
            ring.push(p);
        }
    }
    while ring.len() > 1 && ring.first() == ring.last() {
        ring.pop();
    }
    if ring.len() < 3 {
        return None;
    }
    let crosses_itself = {
        let all: Vec<(Point, Point)> = edges(&ring).collect();
        let n = all.len();
        all.iter().enumerate().any(|(i, &(a0, a1))| {
            all.iter()
                .enumerate()
                .skip(i + 2)
                .any(|(j, &(b0, b1))| !(i == 0 && j == n - 1) && segments_meet(a0, a1, b0, b1))
        })
    };
    if !crosses_itself {
        return (signed_area(&ring).abs() > 0.0).then_some(ring);
    }
    let resolved = ring.overlay(
        &Vec::<Vec<Point>>::new(),
        OverlayRule::Subject,
        FillRule::NonZero,
    );
    resolved
        .into_iter()
        .filter_map(|shape| shape.into_iter().next())
        .max_by(|x, y| signed_area(x).abs().total_cmp(&signed_area(y).abs()))
        .filter(|r| r.len() >= 3 && signed_area(r).abs() > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x: f64, y: f64, s: f64) -> Vec<Point> {
        vec![[x, y], [x + s, y], [x + s, y + s], [x, y + s]]
    }

    #[test]
    fn a_quarter_turn_is_exact() {
        assert_eq!(rotate(&[[1.0, 0.0]], 90.0), vec![[0.0, 1.0]]);
        assert_eq!(rotate(&[[1.0, 0.0]], 180.0), vec![[-1.0, 0.0]]);
        assert_eq!(rotate(&[[1.0, 0.0]], 270.0), vec![[0.0, -1.0]]);
    }

    #[test]
    fn butted_squares_do_not_conflict_at_zero_kerf_but_overlapping_ones_do() {
        assert!(!conflicts(
            &square(0.0, 0.0, 10.0),
            &square(10.0, 0.0, 10.0),
            0.0
        ));
        assert!(conflicts(
            &square(0.0, 0.0, 10.0),
            &square(5.0, 0.0, 10.0),
            0.0
        ));
        assert!(
            conflicts(&square(0.0, 0.0, 10.0), &square(0.0, 0.0, 10.0), 0.0),
            "identical squares overlap fully"
        );
    }

    #[test]
    fn clearance_is_the_distance_between_the_parts() {
        let a = square(0.0, 0.0, 10.0);
        assert!(
            conflicts(&a, &square(10.0, 0.0, 10.0), 2.0),
            "touching is too close when 2 mm is required"
        );
        assert!(
            conflicts(&a, &square(11.0, 0.0, 10.0), 2.0),
            "1 mm apart is too close"
        );
        assert!(
            !conflicts(&a, &square(12.0, 0.0, 10.0), 2.0),
            "exactly kerf apart is allowed"
        );
        assert!(!conflicts(&a, &square(30.0, 0.0, 10.0), 2.0));
    }

    #[test]
    fn a_part_inside_another_conflicts_even_though_no_edges_meet() {
        assert!(conflicts(
            &square(0.0, 0.0, 100.0),
            &square(40.0, 40.0, 5.0),
            0.0
        ));
        assert!(conflicts(
            &square(0.0, 0.0, 100.0),
            &square(40.0, 40.0, 5.0),
            1.0
        ));
    }

    #[test]
    fn a_bump_fits_in_a_concave_notch_but_not_through_the_wall() {
        // an L: the notch is the 10x10 corner x in [10,20], y in [10,20]
        let l = vec![
            [0.0, 0.0],
            [20.0, 0.0],
            [20.0, 10.0],
            [10.0, 10.0],
            [10.0, 20.0],
            [0.0, 20.0],
        ];
        assert!(
            !conflicts(&l, &square(10.0, 10.0, 10.0), 0.0),
            "a square sits in the notch, touching the L"
        );
        assert!(conflicts(&l, &square(8.0, 8.0, 10.0), 0.0));
    }

    #[test]
    fn outlines_are_cleaned_and_a_bow_tie_keeps_its_largest_lobe() {
        assert_eq!(clean_outline(&[[0.0, 0.0], [1.0, 0.0]]), None);
        let closed =
            clean_outline(&[[0.0, 0.0], [4.0, 0.0], [4.0, 4.0], [0.0, 4.0], [0.0, 0.0]]).unwrap();
        assert_eq!(closed.len(), 4, "the repeated closing point is dropped");
        assert_eq!(
            clean_outline(&[[0.0, 0.0], [4.0, 0.0], [4.0, 0.0], [4.0, 4.0]])
                .unwrap()
                .len(),
            3
        );
        // a figure-eight (two triangles meeting at the centre, one larger)
        let bow = clean_outline(&[[0.0, 0.0], [10.0, 10.0], [10.0, 0.0], [0.0, 10.0]]).unwrap();
        assert!(
            signed_area(&bow).abs() > 20.0 && signed_area(&bow).abs() < 30.0,
            "area {}",
            signed_area(&bow)
        );
        assert_eq!(
            clean_outline(&[[0.0, 0.0], [5.0, 0.0], [10.0, 0.0]]),
            None,
            "zero area"
        );
    }
}
