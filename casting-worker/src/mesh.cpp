// Triangle meshes and binary glTF (GLB) files for the 3D viewer and the BOM thumbnails (roadmap S2, D117).
// Meshes are computed on the part definitions; every use of a part in the product shares them.

#include "model.hpp"

#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <Message_ProgressRange.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <Poly_Triangulation.hxx>
#include <RWGltf_CafWriter.hxx>
#include <RWMesh_CoordinateSystem.hxx>
#include <RWMesh_NameFormat.hxx>
#include <TopExp.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include <algorithm>
#include <cmath>

int mesh_part(const TDF_Label& part, const PartProperties& p) {
  const TopoDS_Shape shape = XCAFDoc_ShapeTool::GetShape(part);
  // Chord error 0.1 % of the part's size (at least 0.01 mm): fine enough to see holes and fillets, small files.
  double size = 100.0;
  if (p.box_min && p.box_max) {
    const double dx = (*p.box_max)[0] - (*p.box_min)[0], dy = (*p.box_max)[1] - (*p.box_min)[1],
                 dz = (*p.box_max)[2] - (*p.box_min)[2];
    size = std::sqrt(dx * dx + dy * dy + dz * dz);
  }
  BRepMesh_IncrementalMesh mesher(shape, std::max(0.01, 0.001 * size), false, 0.5, true);
  NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher> faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  int triangles = 0;
  for (int i = 1; i <= faces.Extent(); ++i) {
    TopLoc_Location location;
    const occ::handle<Poly_Triangulation> t = BRep_Tool::Triangulation(TopoDS::Face(faces(i)), location);
    if (!t.IsNull()) triangles += t->NbTriangles();
  }
  return triangles;
}

bool write_glb(const occ::handle<TDocStd_Document>& doc, const NCollection_Sequence<TDF_Label>& roots,
               const std::string& path) {
  RWGltf_CafWriter writer(path.c_str(), true);
  // glTF is Y-up in metres; the document is Z-up in millimetres.
  writer.ChangeCoordinateSystemConverter().SetInputLengthUnit(0.001);
  writer.ChangeCoordinateSystemConverter().SetInputCoordinateSystem(RWMesh_CoordinateSystem_Zup);
  // Node names end with the XDE label entry ("bolt [0:1:1:4:1]"), which result.json lists as instance_ids.
  writer.SetNodeNameFormat(RWMesh_NameFormat_ProductAndInstanceAndOcaf);
  const NCollection_IndexedDataMap<TCollection_AsciiString, TCollection_AsciiString> info;
  return writer.Perform(doc, roots, nullptr, info, Message_ProgressRange());
}
