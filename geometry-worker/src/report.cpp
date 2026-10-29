#include "report.hpp"

#include <algorithm>

#include <BRepCheck_Analyzer.hxx>
#include <Standard_Failure.hxx>

#include "assembly.hpp"
#include "measure.hpp"
#include "step_io.hpp"

namespace gw {

using nlohmann::json;

namespace {

double round4(double x) { return std::round(x * 1e4) / 1e4; }

// True when `name` is a component (not a root) somewhere below `nodes`.
bool contains(const std::vector<Node>& nodes, const std::string& name) {
  for (const Node& node : nodes) {
    for (const Node& child : node.children) {
      if (child.name == name || contains({child}, name)) return true;
    }
  }
  return false;
}

json node_json(const Node& node, const std::string& file) {
  json children = json::array();
  for (const Node& child : node.children) children.push_back(node_json(child, file));
  return {{"definition", node.definition}, {"name", node.name}, {"kind", kind_name(node.kind)},
          {"quantity", node.quantity},     {"file", file},      {"children", children}};
}

void collect(const Node& node, std::vector<const Node*>& out) {
  out.push_back(&node);
  for (const Node& child : node.children) collect(child, out);
}

}  // namespace

std::string part_file_name(const std::string& definition) {
  std::string name = definition;
  std::replace(name.begin(), name.end(), ':', '_');
  return name + ".step";
}

Built build_report(const std::vector<std::pair<std::string, std::string>>& files, const std::function<void()>& checkpoint) {
  struct Read {
    std::string name;
    Assembly assembly;
  };
  std::vector<Read> reads;
  json inputs = json::array();
  for (size_t i = 0; i < files.size(); ++i) {
    checkpoint();
    try {
      reads.push_back({files[i].first, read_assembly(files[i].second, std::to_string(i) + ":")});
      inputs.push_back({{"file", files[i].first}, {"status", "ok"}, {"inside", nullptr}});
    } catch (const StepError&) {
      inputs.push_back({{"file", files[i].first}, {"status", "unreadable"}, {"inside", nullptr}});
    } catch (const Standard_Failure&) {
      inputs.push_back({{"file", files[i].first}, {"status", "unreadable"}, {"inside", nullptr}});
    }
  }

  // An assembly exported together with its parts lists those parts as separate files too: a root that already sits inside
  // another file's assembly is that assembly's component, not a second product line.
  std::vector<std::pair<const Read*, const Node*>> kept;
  for (const Read& read : reads) {
    for (const Node& root : read.assembly.roots) {
      const Read* owner = nullptr;
      for (const Read& other : reads) {
        if (&other != &read && contains(other.assembly.roots, root.name)) {
          owner = &other;
          break;
        }
      }
      if (owner != nullptr) {
        for (json& input : inputs) {
          if (input["file"] == read.name) input["inside"] = owner->name;
        }
      } else {
        kept.emplace_back(&read, &root);
      }
    }
  }

  std::vector<Node> kept_roots;
  for (const auto& pair : kept) kept_roots.push_back(*pair.second);
  const auto totals = part_totals(kept_roots);

  Built built;
  built.any_readable = !reads.empty();
  std::map<std::string, std::string> file_of, name_of;
  for (const Read& read : reads) {
    for (const auto& [id, shape] : read.assembly.shapes) {
      built.shapes.emplace(id, shape);
      file_of.emplace(id, read.name);
    }
  }
  for (const Node& root : kept_roots) {
    std::vector<const Node*> all;
    collect(root, all);
    for (const Node* node : all) {
      if (node->kind == Kind::Part) name_of.emplace(node->definition, node->name);
    }
  }

  json parts = json::array(), problems = json::array();
  for (const auto& [definition, quantity] : totals) {
    checkpoint();
    json part = {{"id", definition},       {"name", name_of[definition]}, {"file", file_of[definition]},
                 {"quantity_total", quantity}, {"volume_mm3", nullptr},   {"surface_area_mm2", nullptr},
                 {"bounding_box", nullptr}};
    const TopoDS_Shape& shape = built.shapes.at(definition);
    try {
      if (!BRepCheck_Analyzer(shape).IsValid()) problems.push_back({{"part", definition}, {"code", "invalid_geometry"}});  // still measured
      const Measures m = measure_solid(shape);
      part["volume_mm3"] = round4(m.volume);
      part["surface_area_mm2"] = round4(m.surface_area);
      part["bounding_box"] = {{"length", m.length}, {"width", m.width}, {"height", m.height}, {"diagonal", m.diagonal}};
    } catch (const Standard_Failure&) {
      part["volume_mm3"] = nullptr;
      part["surface_area_mm2"] = nullptr;
      part["bounding_box"] = nullptr;
      problems.push_back({{"part", definition}, {"code", "failed:measure"}});
    }
    parts.push_back(part);
    built.part_ids.push_back(definition);
  }
  for (const Node& root : kept_roots) {
    std::vector<const Node*> all;
    collect(root, all);
    for (const Node* node : all) {
      if (node->kind == Kind::EmptyAssembly) problems.push_back({{"part", node->definition}, {"code", "empty_assembly"}});
    }
  }

  const bool all_ok = std::all_of(inputs.begin(), inputs.end(), [](const json& i) { return i["status"] == "ok"; });
  json assembly = json::array();
  for (const auto& [read, root] : kept) assembly.push_back(node_json(*root, read->name));
  built.report = {{"schema_version", 1}, {"units", "mm"}, {"status", all_ok && !kept.empty() ? "complete" : "partial"},
                  {"inputs", inputs},     {"assembly", assembly}, {"parts", parts}, {"problems", problems}};
  return built;
}

void export_parts(const Built& built, const std::string& dir, const std::function<void()>& checkpoint) {
  for (const std::string& id : built.part_ids) {
    checkpoint();
    write_step(built.shapes.at(id), dir + "/" + part_file_name(id));
  }
}

}  // namespace gw
