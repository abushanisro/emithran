// What the worker learns from a STEP file: the assembly tree and the properties of each distinct part.
#pragma once

#include <Standard_Handle.hxx>
#include <TDF_Label.hxx>
#include <TDocStd_Document.hxx>

#include <array>
#include <map>
#include <optional>
#include <string>
#include <vector>

// One node of the assembly tree. Repeated components of the same part or sub-assembly under one parent are a
// single node with a quantity (as a BOM lists them).
struct Node {
  std::string id;  // the definition's XDE label entry, e.g. "0:1:1:2"; equal for every use of the same part
  std::string name;
  bool assembly = false;
  int quantity = 1;
  // XDE entries of each use of this node under its parent (one per quantity); model.glb node names end with them.
  std::vector<std::string> instance_ids;
  std::vector<Node> children;
  std::string file;  // top-level nodes: the input file it was read from (D136)
};

using Xyz = std::array<double, 3>;

// Wall thickness by ray casting (casting.cpp): from each surface point straight inwards to the opposite surface,
// weighted by surface area. min and max are the 5th and 95th percentiles (single rays at edges are noise).
// The thinnest wall measured from one face: the smallest distance from a point of the face, through the metal along the inward normal, to the next surface.
struct FaceWall {
  int face;       // TopExp::MapShapes order - 1, as the features, the draft and glb_faces number faces
  double min;     // mm
  int samples;    // rays from this face that found a far side
};

// One wall-thickness ray: where it started on the surface and how far it ran through the metal to the next surface.
struct WallPoint {
  int face;     // numbered as FaceWall::face
  Xyz at;       // mm, the point on the face
  double mm;    // thickness along the inward normal
};

struct WallThickness {
  double min = 0, nominal = 0, max = 0;  // nominal: the area-weighted median
  int samples = 0;
  std::vector<FaceWall> faces;  // every face that had a measurement, in face order: where the thin walls are
  std::vector<WallPoint> points;  // every point_stride-th ray, in face order: the thickness over the surface, for a colour map
  int point_stride = 1;           // 1 while there are at most kMaxWallPoints rays, else the step taken through them
};

// One region of air enclosed between metal along the draw axis: sand must be placed there as a core (D127).
// Measured by rays; exact from the core's own body when it has one (cores.cpp, D145).
struct CoreProperties {
  double volume = 0;  // mm³
  double area = 0;    // mm², the core's whole surface (its prints included); exact, from the body: 0 and not reported without one
  Xyz size{};         // extents, largest first (mm)
  Xyz centre{};       // the middle of its air, by volume (mm)
  bool body = false;       // a solid was made of its faces (drawn in cores_glb)
  std::vector<int> faces;  // the part faces it touches (of the features linked to it)
  std::string problem;     // why it has no body: open_boundary, opening_not_closed, not_a_solid; empty otherwise
};

// The exact parting line (parting.cpp, D144): the outer loop of the part's section across the draw axis, at the
// height where that loop encloses most. Not planar when part of the projected area lies outside it: then a stepped
// parting line is needed and this is only the best flat one.
struct PartingLine {
  double height = 0;         // the plane's position along the draw axis (part coordinates)
  double length = 0;         // of the loop, exact
  double area = 0;           // enclosed by the loop
  double outside = 0;        // share of the projected area outside the loop
  bool planar = true;        // outside below 1 %
  std::vector<Xyz> points;   // the loop as a closed polyline
};

// The draft of one face (draft.cpp): its smallest and largest angle over the face, in degrees, 0 = parallel to the draw axis, negative = undercut. `side`:
// 'c' above the parting plane, 'd' below it, 'b' crossing it (graded by the worse side).
struct FaceDraft {
  int face;  // TopExp::MapShapes order - 1, as the features and glb_faces number faces
  char side;
  double min_deg, max_deg;
};

struct DraftAnalysis {
  bool parting_planar = true;     // false: the parting line is stepped, the halves are only approximate
  std::vector<FaceDraft> faces;
  int at_parting_plane = 0;       // flat faces lying in the parting plane: no draft to grade
  int unmeasured = 0;             // faces without a usable normal
};

// The faces of the part that cannot be withdrawn from the sand along one axis (undercuts.cpp): `share` is the part of the face's sample points that cannot.
struct UndercutFace {
  int face;  // TopExp::MapShapes order - 1, as the features and the draft number faces
  double share;
};

struct UndercutAxis {
  char axis;  // 'x', 'y' or 'z'
  std::vector<UndercutFace> faces;
  double area = 0;  // mm2 of those faces
};

struct UndercutAnalysis {
  std::vector<UndercutAxis> axes;  // x, y, z
};

// What casting cost needs from the geometry (roadmap M4, D126), along one of the part's own axes.
struct CastingProperties {
  char draw_axis = 'z';         // the mould opens along this axis: fewest hidden regions, then shallowest (or the one asked for)
  bool axis_requested = false;  // the draw axis was given (--draw-axis), not chosen
  double draw_depth = 0;        // extent along the draw axis
  double projected_area = 0;    // silhouette seen along the draw axis
  // The exact parting line's length when it is planar; otherwise the perimeter of the silhouette (outer and inner
  // edges, from the ray grid)
  double parting_line = 0;
  std::optional<PartingLine> parting;
  std::optional<UndercutAnalysis> undercuts;  // along each axis of the part; independent of the chosen draw axis and of the parting line
  std::optional<DraftAnalysis> draft;  // along the draw axis, relative to the parting plane (needs the parting line)
  std::vector<std::array<double, 2>> covered;  // centres of the grid cells the part covers (across the axis; not written)
  std::array<double, 2> footprint{};  // extents across the draw axis, larger first
  // Share of the projected area where a ray along the draw axis passes solid, air, solid: material hidden from
  // both mould halves, which needs a core (or is an undercut).
  double hidden_fraction = 0;
  std::optional<WallThickness> wall;
  std::vector<CoreProperties> cores;  // largest first, at most 100
  std::optional<std::string> cores_glb;  // parts/<part>-cores.glb: one node "core <n>" per core with a body
};

// One recognised feature (D132), in the part's own coordinates: the faces it is made of (indices in
// TopExp_Explorer order, as `glb_faces` maps them to the GLB) and, for edge features, polylines.
struct Feature {
  std::string id;    // "<type>:<n>", n counting from 1 per type
  std::string type;  // a feature type of the operations catalogue (PlanarFace, SharpEdge, ...)
  std::vector<int> faces;
  std::vector<std::vector<Xyz>> edges;
  std::vector<std::pair<std::string, double>> parameters;
  std::string parent;  // the feature it belongs to; empty at the top
};

// Measurements of one part definition in its own coordinates, in millimetres. A measurement that is not
// meaningful or failed is empty (null in JSON) and the reason is in `problems`; never a made-up number.
struct PartProperties {
  std::string id;
  std::string name;
  int total_quantity = 0;  // in the whole product: quantities multiplied along each path

  bool valid_as_read = false;  // BRepCheck on the shape as imported
  bool healed = false;         // ShapeFix was applied and kept: valid afterwards and no solid lost
  bool valid = false;          // BRepCheck on the shape that was measured
  int solids = 0, faces = 0, edges = 0;

  // Volume and centre of mass: only for a valid shape with at least one solid. Several solids in one part
  // definition are added up (overlapping solids would be counted twice).
  std::optional<double> volume;
  std::optional<Xyz> centre;
  std::optional<double> area;  // sum of all face areas; meaningful for open shells too
  std::optional<Xyz> box_min, box_max;
  std::optional<Xyz> oriented_size;  // oriented bounding box edges, largest first (orientation not kept)
  std::map<std::string, int> face_types;

  int triangles = 0;          // of the display mesh
  std::optional<std::string> glb;  // parts/<file>.glb, relative to the output folder
  std::optional<CastingProperties> casting;  // only for a valid part with a volume
  // The face shown by each primitive of the part's GLB, in order (faces without a mesh have none).
  std::vector<int> glb_faces;
  std::vector<Feature> features;  // only for a valid part with a volume (D132)

  // Stable codes: empty_shape, no_solid, invalid_geometry, failed:<measurement> (an OCCT exception).
  std::vector<std::string> problems;
};

// Assembly tree of every top-level shape; fills `parts` with each distinct part's label by id (assembly.cpp).
std::vector<Node> read_tree(const occ::handle<TDocStd_Document>& doc, std::map<std::string, TDF_Label>& parts);
// Total quantity of each part in the whole product.
std::map<std::string, int> part_totals(const std::vector<Node>& roots);

// The name stored in the STEP file (product name), as UTF-8; empty when the file has none (assembly.cpp).
std::string name_of(const TDF_Label& label);

// Measures one part definition (properties.cpp).
PartProperties measure(const TDF_Label& part);

// The face of every GLB primitive of a meshed part, in the writer's order (features.cpp).
std::vector<int> glb_faces(const TDF_Label& part);
// The features of a meshed, valid part (features.cpp); throws Standard_Failure on an OCCT error.
// With the casting measurements, faces hidden from both mould halves form voids, linked to their cores (F3).
std::vector<Feature> recognise_features(const TDF_Label& part, const std::optional<CastingProperties>& casting);

// Each core's body from the features linked to it, written as parts/<part>-cores.glb (cores.cpp); throws
// Standard_Failure on an OCCT error. Needs the casting measurements and the features.
void build_cores(const TDF_Label& part, PartProperties& p, const std::string& out_dir);

// Casting measurements of a meshed, valid part (casting.cpp); throws Standard_Failure on an OCCT error.
// `forced_axis` is 0, 1 or 2 to measure along that axis only (an engineer's choice), -1 to choose the best.
// Fills `c.draft` from the part's faces; nothing without a parting line. Throws Standard_Failure on an OCCT error.
void find_draft(const TDF_Label& part, const PartProperties& p, CastingProperties& c);
// Fills `c.undercuts`: the faces that cannot be withdrawn along each axis (undercuts.cpp). Throws Standard_Failure on an OCCT error.
void find_undercuts(const TDF_Label& part, const PartProperties& p, CastingProperties& c);

CastingProperties measure_casting(const TDF_Label& part, const PartProperties& p, int forced_axis = -1);
// The exact parting line along the measured draw axis (parting.cpp); throws Standard_Failure on an OCCT error.
void find_parting_line(const TDF_Label& part, const PartProperties& p, CastingProperties& c);

// Meshes one part definition for display; returns its triangle count (mesh.cpp).
int mesh_part(const TDF_Label& part, const PartProperties& p);
// Writes the given labels (and everything below them) as a binary glTF file; false on failure (mesh.cpp).
bool write_glb(const occ::handle<TDocStd_Document>& doc, const NCollection_Sequence<TDF_Label>& roots,
               const std::string& path);
