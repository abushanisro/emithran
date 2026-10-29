// Checks the worker against hand-worked answers (Petrus D126): shapes whose volume, area and extents are known from the
// formulas, written as real STEP files, read back through the same code the service runs. The fixtures are the ones the
// NestJS e2e uses (backend/test/fixtures/cad, written with pythonocc 7.7.2): the parity test is that this worker reads them
// exactly as the Python engine does.
#include <cmath>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>

#include <BRepPrimAPI_MakeBox.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <TopLoc_Location.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include "assembly.hpp"
#include "measure.hpp"
#include "report.hpp"
#include "step_io.hpp"

namespace {

int failures = 0;

#define CHECK(condition)                                                               \
  do {                                                                                 \
    if (!(condition)) {                                                                \
      std::cerr << __FILE__ << ":" << __LINE__ << ": CHECK failed: " #condition "\n";  \
      ++failures;                                                                      \
    }                                                                                  \
  } while (0)

bool near(double a, double b, double tolerance) { return std::fabs(a - b) <= tolerance; }

std::string fixture(const std::string& name) {
  const char* dir = std::getenv("GW_FIXTURES");
  return std::string(dir != nullptr ? dir : "../backend/test/fixtures/cad") + "/" + name;
}

const auto no_deadline = [] {};

using nlohmann::json;

json report_of(const std::vector<std::string>& paths) {
  std::vector<std::pair<std::string, std::string>> files;
  for (const std::string& p : paths) files.emplace_back(std::filesystem::path(p).filename().string(), p);
  return gw::build_report(files, no_deadline).report;
}

void single_part_plate() {
  const json r = report_of({fixture("plate.step")});
  CHECK(r["status"] == "complete");
  CHECK(r["assembly"].size() == 1);
  CHECK(r["assembly"][0]["kind"] == "part" && r["assembly"][0]["quantity"] == 1);
  CHECK(r["assembly"][0]["name"] == "Plate");
  const json& p = r["parts"][0];
  CHECK(p["quantity_total"] == 1);
  CHECK(near(p["volume_mm3"], 40.0 * 30.0 * 3.0, 0.01));                              // 3600
  CHECK(near(p["surface_area_mm2"], 2.0 * (40 * 30 + 40 * 3 + 30 * 3), 0.01));        // 2820
  CHECK(near(p["bounding_box"]["length"], 40.0, 0.001) && near(p["bounding_box"]["width"], 30.0, 0.001));
  CHECK(near(p["bounding_box"]["height"], 3.0, 0.001));
  CHECK(near(p["bounding_box"]["diagonal"], std::sqrt(40.0 * 40 + 30 * 30 + 3 * 3), 0.001));
}

void nested_assembly_quantities_multiply_down_the_tree() {
  const json r = report_of({fixture("nested-assembly.step")});
  CHECK(r["status"] == "complete");
  const json& top = r["assembly"][0];
  CHECK(top["name"] == "Top" && top["kind"] == "assembly" && top["quantity"] == 1);
  CHECK(top["children"].size() == 2);
  json sub, cyl;
  for (const json& c : top["children"]) (c["name"] == "Sub" ? sub : cyl) = c;
  CHECK(sub["quantity"] == 2 && cyl["quantity"] == 1);
  CHECK(sub["children"].size() == 2);
  // Box: 2 Sub x 2; Cyl: 2 Sub x 1 + 1 in Top
  CHECK(r["parts"].size() == 2);
  for (const json& p : r["parts"]) {
    if (p["name"] == "Box") {
      CHECK(p["quantity_total"] == 4);
      CHECK(near(p["volume_mm3"], 10.0 * 20 * 30, 0.01));  // 6000
      CHECK(near(p["surface_area_mm2"], 2200.0, 0.01));
    } else {
      CHECK(p["name"] == "Cyl" && p["quantity_total"] == 3);
      CHECK(near(p["volume_mm3"], M_PI * 25.0 * 40.0, 0.01));  // 3141.59
      CHECK(near(p["surface_area_mm2"], 2 * M_PI * 5.0 * 40.0 + 2 * M_PI * 25.0, 0.01));
    }
  }
  CHECK(r["problems"].empty());
}

void several_files_form_one_product_with_unique_ids() {
  const json r = report_of({fixture("plate.step"), fixture("pin.step"), fixture("plate.step")});
  CHECK(r["inputs"].size() == 3 && r["assembly"].size() == 3);
  CHECK(r["parts"].size() == 3);  // the same file twice is two files: ids start with the file's position
  CHECK(r["parts"][0]["id"].get<std::string>().rfind("0:", 0) == 0);
  CHECK(r["parts"][1]["id"].get<std::string>().rfind("1:", 0) == 0);
  CHECK(r["parts"][2]["id"].get<std::string>().rfind("2:", 0) == 0);
}

void a_missing_or_garbage_file_is_unreadable_not_fatal() {
  const std::string garbage = (std::filesystem::temp_directory_path() / "gw_garbage.step").string();
  std::ofstream(garbage) << "this is not a STEP file";
  const json r = report_of({fixture("plate.step"), garbage, "/no/such/file.step"});
  CHECK(r["status"] == "partial");
  CHECK(r["inputs"][0]["status"] == "ok" && r["inputs"][1]["status"] == "unreadable" && r["inputs"][2]["status"] == "unreadable");
  CHECK(r["parts"].size() == 1);
  std::filesystem::remove(garbage);
}

void exported_parts_read_back_with_the_same_volume() {
  std::vector<std::pair<std::string, std::string>> files{{"nested-assembly.step", fixture("nested-assembly.step")}};
  gw::Built built = gw::build_report(files, no_deadline);
  const std::filesystem::path dir = std::filesystem::temp_directory_path() / "gw_export";
  std::filesystem::remove_all(dir);
  std::filesystem::create_directories(dir);
  gw::export_parts(built, dir.string(), no_deadline);
  int checked = 0;
  for (const std::string& id : built.part_ids) {
    const std::string path = (dir / gw::part_file_name(id)).string();
    CHECK(std::filesystem::exists(path));
    const gw::Assembly again = gw::read_assembly(path, "");
    CHECK(again.roots.size() == 1 && again.roots[0].kind == gw::Kind::Part);
    const double before = gw::measure_solid(built.shapes.at(id)).volume;
    const double after = gw::measure_solid(again.shapes.begin()->second).volume;
    CHECK(near(before, after, 0.01));
    ++checked;
  }
  CHECK(checked == 2);
  std::filesystem::remove_all(dir);
}

void part_file_names_have_no_colons() { CHECK(gw::part_file_name("0:1:1:3") == "0_1_1_3.step"); }

// A chain of assemblies deeper than the bound must be refused as unreadable, not crash the stack.
void nesting_past_the_bound_is_refused() {
  Handle(TDocStd_Document) doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  Handle(XCAFDoc_ShapeTool) tool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  TDF_Label current = tool->AddShape(BRepPrimAPI_MakeBox(1, 1, 1).Shape(), false);
  for (int i = 0; i < gw::kMaxDepth + 5; ++i) {
    TDF_Label parent = tool->NewShape();
    tool->AddComponent(parent, current, TopLoc_Location());
    current = parent;
  }
  tool->UpdateAssemblies();
  const std::string path = (std::filesystem::temp_directory_path() / "gw_deep.step").string();
  STEPCAFControl_Writer writer;
  CHECK(writer.Transfer(doc, STEPControl_AsIs));
  CHECK(writer.Write(path.c_str()) == IFSelect_RetDone);
  const json r = report_of({path});
  CHECK(r["inputs"][0]["status"] == "unreadable");
  CHECK(r["assembly"].empty());
  std::filesystem::remove(path);
}

}  // namespace

int main() {
  single_part_plate();
  nested_assembly_quantities_multiply_down_the_tree();
  several_files_form_one_product_with_unique_ids();
  a_missing_or_garbage_file_is_unreadable_not_fatal();
  exported_parts_read_back_with_the_same_volume();
  part_file_names_have_no_colons();
  nesting_past_the_bound_is_refused();
  if (failures != 0) {
    std::cerr << failures << " check(s) failed\n";
    return 1;
  }
  std::cout << "all checks passed\n";
  return 0;
}
