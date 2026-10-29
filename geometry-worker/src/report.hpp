// The version-1 assembly report (cad-engine/contract/assembly.schema.json) and the export of every distinct part as a STEP file.
// Port of cad-engine/shared/assembly_report.py. A measurement that cannot be taken is null with a problem code, never a guess.
#pragma once

#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include <TopoDS_Shape.hxx>
#include <nlohmann/json.hpp>

namespace gw {

struct Built {
  nlohmann::json report;
  std::map<std::string, TopoDS_Shape> shapes;  // every distinct part of the kept assemblies, by definition id
  std::vector<std::string> part_ids;           // in the order they appear in report["parts"]
  bool any_readable = false;
};

// Thrown by the checkpoint when the deadline has passed. Work in progress is abandoned; nothing is half-written.
struct DeadlineExceeded {};

// `files` is (name as it will appear in the report, path on disk) per STEP file; all files form one product. `checkpoint` is
// called between files and parts so a deadline can stop the work (OCCT calls themselves cannot be interrupted).
Built build_report(const std::vector<std::pair<std::string, std::string>>& files, const std::function<void()>& checkpoint);

// The entry name of a part in the parts folder (a definition id holds ':', which is not portable in file names).
std::string part_file_name(const std::string& definition);

// Writes each distinct part as `<dir>/<part_file_name(id)>`.
void export_parts(const Built& built, const std::string& dir, const std::function<void()>& checkpoint);

}  // namespace gw
