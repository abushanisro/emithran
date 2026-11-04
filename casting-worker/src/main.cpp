// geometry-worker: reads a STEP file through Open CASCADE's XDE and writes what it contains to result.json:
// the assembly tree (names, quantities) and the properties of each distinct part (roadmap B1.2, ADR 0005), plus
// model.glb and parts/<id>.glb for the 3D viewer and thumbnails (S2).
//   geometry-worker [--deadline-ms N] [--draw-axis x|y|z] <input.step>... <out-dir>
// Several STEP files are one product (D136): each file's top-level shapes are the tree's roots, tagged with the file;
// a root already inside another file's assembly (an assembly exported with its parts) is not repeated; a file that
// cannot be read makes the result partial ("inputs" says which), all of them unreadable_step.
// stdout: one line of JSON, a summary or {"error": code}. Exit codes: 0 ok, 2 unreadable_step, 3 no_solids,
// 4 deadline_exceeded, 5 cannot_write_result, 6 analysis_failed (assembly structure), 64 usage. Units: millimetres (files in other units are converted).
// A measurement that is not meaningful or failed is null, with the reason in the part's "problems" (D108).

#include "json.hpp"
#include "model.hpp"

#include <IFSelect_ReturnStatus.hxx>
#include <Message.hxx>
#include <Message_Messenger.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <Standard_Version.hxx>
#include <Standard_Failure.hxx>
#include <UnitsMethods_LengthUnit.hxx>
#include <XCAFApp_Application.hxx>
#include <XCAFDoc_DocumentTool.hxx>

#include <XCAFDoc_ShapeTool.hxx>
#include <TCollection_AsciiString.hxx>
#include <TDF_Tool.hxx>

#include <fcntl.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cerrno>
#include <csignal>
#include <cstdlib>
#include <iostream>
#include <string>
#include <set>

namespace {

constexpr int kSchemaVersion = 1;
constexpr const char* kWorkerVersion = "0.14.0";

int fail(const char* code, int exit_code) {
  std::cout << "{\"error\":\"" << code << "\"}\n";
  return exit_code;
}

// Runs inside the signal handler: only async-signal-safe calls.
void on_deadline(int) {
  const char message[] = "{\"error\":\"deadline_exceeded\"}\n";
  (void)!write(STDOUT_FILENO, message, sizeof message - 1);
  _exit(4);
}

// A safeguard inside the worker; the hard limit is the parent killing the container (roadmap C2).
void arm_deadline(long milliseconds) {
  struct sigaction action{};
  action.sa_handler = on_deadline;
  sigemptyset(&action.sa_mask);
  sigaction(SIGALRM, &action, nullptr);
  itimerval timer{};
  timer.it_value.tv_sec = milliseconds / 1000;
  timer.it_value.tv_usec = (milliseconds % 1000) * 1000;
  setitimer(ITIMER_REAL, &timer, nullptr);
}

void write_xyz(JsonWriter& json, const char* key, const std::optional<Xyz>& v) {
  json.key(key);
  if (!v) {
    json.null();
    return;
  }
  json.begin_array().value((*v)[0]).value((*v)[1]).value((*v)[2]).end_array();
}

void write_node(JsonWriter& json, const Node& node) {
  json.begin_object()
      .key("id").value(node.id)
      .key("name").value(node.name)
      .key("kind").value(node.assembly ? "assembly" : "part")
      .key("quantity").value(node.quantity);
  if (!node.file.empty()) json.key("file").value(node.file);
  json.key("instance_ids").begin_array();
  for (const std::string& instance : node.instance_ids) json.value(instance);
  json.end_array().key("children").begin_array();
  for (const Node& child : node.children) write_node(json, child);
  json.end_array().end_object();
}

// Casting measurements (D126); null when the part has none (no valid solid, or the measurement failed).
void write_casting(JsonWriter& json, const std::optional<CastingProperties>& c) {
  json.key("casting");
  if (!c) {
    json.null();
    return;
  }
  const char axis[2] = {c->draw_axis, '\0'};
  json.begin_object()
      .key("draw_axis").value(axis)
      .key("draw_axis_source").value(c->axis_requested ? "requested" : "auto")
      .key("draw_depth_mm").value(c->draw_depth)
      .key("projected_area_mm2").value(c->projected_area)
      .key("parting_line_mm").value(c->parting_line)
      .key("parting");
  if (c->parting) {
    json.begin_object()
        .key("height_mm").value(c->parting->height)
        .key("length_mm").value(c->parting->length)
        .key("area_mm2").value(c->parting->area)
        .key("outside_fraction").value(c->parting->outside)
        .key("planar").value(c->parting->planar)
        .key("points").begin_array();
    for (const Xyz& pt : c->parting->points) json.begin_array().value(pt[0]).value(pt[1]).value(pt[2]).end_array();
    json.end_array().end_object();
  } else {
    json.null();
  }
  json.key("footprint_mm").begin_array().value(c->footprint[0]).value(c->footprint[1]).end_array()
      .key("hidden_fraction").value(c->hidden_fraction)
      .key("wall_mm");
  if (c->wall) {
    json.begin_object()
        .key("min").value(c->wall->min)
        .key("nominal").value(c->wall->nominal)
        .key("max").value(c->wall->max)
        .key("samples").value(c->wall->samples)
        .end_object();
  } else {
    json.null();
  }
  json.key("cores").begin_array();
  for (const CoreProperties& core : c->cores) {
    json.begin_object()
        .key("volume_mm3").value(core.volume)
        .key("size_mm").begin_array().value(core.size[0]).value(core.size[1]).value(core.size[2]).end_array()
        .key("centre_mm").begin_array().value(core.centre[0]).value(core.centre[1]).value(core.centre[2]).end_array()
        .key("body").value(core.body)
        .key("faces").begin_array();
    for (const int f : core.faces) json.value(f);
    json.end_array().key("problem");
    if (core.problem.empty()) {
      json.null();
    } else {
      json.value(core.problem);
    }
    json.end_object();
  }
  json.end_array().key("cores_glb");
  if (c->cores_glb) {
    json.value(*c->cores_glb);
  } else {
    json.null();
  }
  json.key("draft");
  if (c->draft) {
    json.begin_object()
        .key("parting_planar").value(c->draft->parting_planar)
        .key("at_parting_plane").value(c->draft->at_parting_plane)
        .key("unmeasured").value(c->draft->unmeasured)
        .key("faces").begin_array();
    for (const FaceDraft& f : c->draft->faces) {
      const char side[2] = {f.side, '\0'};
      json.begin_object().key("face").value(f.face).key("side").value(side).key("min_deg").value(f.min_deg).key("max_deg").value(f.max_deg).end_object();
    }
    json.end_array().end_object();
  } else {
    json.null();
  }
  json.end_object();
}

void write_part(JsonWriter& json, const PartProperties& p) {
  std::optional<Xyz> size;
  if (p.box_min && p.box_max) {
    size = Xyz{(*p.box_max)[0] - (*p.box_min)[0], (*p.box_max)[1] - (*p.box_min)[1], (*p.box_max)[2] - (*p.box_min)[2]};
  }
  json.begin_object()
      .key("id").value(p.id)
      .key("name").value(p.name)
      .key("total_quantity").value(p.total_quantity)
      .key("valid_as_read").value(p.valid_as_read)
      .key("healed").value(p.healed)
      .key("valid").value(p.valid)
      .key("volume_mm3").value(p.volume)
      .key("area_mm2").value(p.area);
  write_xyz(json, "centre_mm", p.centre);
  json.key("box_mm").begin_object();
  write_xyz(json, "min", p.box_min);
  write_xyz(json, "max", p.box_max);
  write_xyz(json, "size", size);
  json.end_object();
  write_xyz(json, "oriented_box_size_mm", p.oriented_size);
  json.key("solids").value(p.solids).key("faces").value(p.faces).key("edges").value(p.edges);
  json.key("face_types").begin_object();
  for (const auto& [type, n] : p.face_types) json.key(type).value(n);
  json.end_object().key("triangles").value(p.triangles).key("glb");
  if (p.glb) {
    json.value(*p.glb);
  } else {
    json.null();
  }
  write_casting(json, p.casting);
  json.key("glb_faces").begin_array();
  for (const int f : p.glb_faces) json.value(f);
  json.end_array().key("features").begin_array();
  for (const Feature& f : p.features) {
    json.begin_object().key("id").value(f.id).key("type").value(f.type).key("parent");
    if (f.parent.empty()) {
      json.null();
    } else {
      json.value(f.parent);
    }
    json.key("faces").begin_array();
    for (const int i : f.faces) json.value(i);
    json.end_array().key("edges").begin_array();
    for (const std::vector<Xyz>& line : f.edges) {
      json.begin_array();
      for (const Xyz& pt : line) json.begin_array().value(pt[0]).value(pt[1]).value(pt[2]).end_array();
      json.end_array();
    }
    json.end_array().key("parameters").begin_object();
    for (const auto& [name, value] : f.parameters) json.key(name).value(value);
    json.end_object().end_object();
  }
  json.end_array();
  json.key("problems").begin_array();
  for (const std::string& problem : p.problems) json.value(problem);
  json.end_array().end_object();
}

// 3D output (D117): one GLB per part (thumbnails, part viewer) and model.glb for the whole product. Written before
// result.json, so a published result.json always has its files. Returns whether model.glb was written.
bool write_3d(const occ::handle<TDocStd_Document>& doc, const NCollection_Sequence<TDF_Label>& roots,
              const std::map<std::string, TDF_Label>& labels, std::vector<PartProperties>& parts,
              const std::string& out_dir, int& triangles) {
  for (PartProperties& p : parts) {
    if (p.faces == 0) continue;  // nothing to show; the part already lists why
    try {
      const TDF_Label& label = labels.at(p.id);
      p.triangles = mesh_part(label, p);
      p.glb_faces = glb_faces(label);
      std::string file = "parts/" + p.id + ".glb";
      std::replace(file.begin(), file.end(), ':', '-');
      NCollection_Sequence<TDF_Label> one;
      one.Append(label);
      if (p.triangles > 0 && write_glb(doc, one, out_dir + "/" + file)) {
        p.glb = file;
      } else {
        p.problems.push_back("failed:glb");
      }
    } catch (const Standard_Failure&) {
      p.problems.push_back("failed:mesh");
    }
    triangles += p.triangles;
  }
  try {
    return write_glb(doc, roots, out_dir + "/model.glb");
  } catch (const Standard_Failure&) {
    return false;
  }
}

// Milliseconds from 1 to one hour; anything else (text, trailing characters, overflow) gives 0 = invalid.
long parse_deadline(const char* text) {
  errno = 0;
  char* end = nullptr;
  const long value = std::strtol(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || value < 1 || value > 3600000) return 0;
  return value;
}

// result.json appears complete or not at all: written to a temporary file, flushed, then renamed over the name.
bool publish(const std::string& out_dir, const std::string& text) {
  const std::string final_path = out_dir + "/result.json";
  const std::string temp_path = final_path + ".tmp";
  const int fd = open(temp_path.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return false;
  size_t done = 0;
  while (done < text.size()) {
    const ssize_t n = write(fd, text.data() + done, text.size() - done);
    if (n <= 0) break;
    done += static_cast<size_t>(n);
  }
  const bool written = done == text.size() && fsync(fd) == 0;
  if (close(fd) != 0 || !written || rename(temp_path.c_str(), final_path.c_str()) != 0) {
    unlink(temp_path.c_str());
    return false;
  }
  return true;
}

double seconds_since(std::chrono::steady_clock::time_point start) {
  return std::chrono::duration<double>(std::chrono::steady_clock::now() - start).count();
}

// One input file: whether it was read, and the file whose assembly already holds its content.
struct Input {
  std::string file;
  bool read = false;
  std::string inside;
};

std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

void names_below(const Node& node, std::set<std::string>& out) {
  for (const Node& child : node.children) {
    if (!child.name.empty()) out.insert(lower(child.name));
    names_below(child, out);
  }
}

void part_ids(const Node& node, std::set<std::string>& out) {
  if (!node.assembly) out.insert(node.id);
  for (const Node& child : node.children) part_ids(child, out);
}

}  // namespace

int main(int argc, char** argv) {
  int arg = 1;
  long deadline_ms = 0;
  int forced_axis = -1;  // --draw-axis x|y|z: measure along that axis only
  bool bad_option = false;
  while (arg + 1 < argc && std::string(argv[arg]).rfind("--", 0) == 0) {  // options come first, each with its value
    const std::string option = argv[arg], value = argv[arg + 1];
    if (option == "--deadline-ms") {
      deadline_ms = parse_deadline(value.c_str());
      bad_option = bad_option || deadline_ms == 0;
    } else if (option == "--draw-axis") {
      forced_axis = value == "x" ? 0 : value == "y" ? 1 : value == "z" ? 2 : -1;
      bad_option = bad_option || forced_axis < 0;
    } else {
      bad_option = true;
    }
    arg += 2;
  }
  if (bad_option || argc - arg < 2) {
    std::cerr << "usage: geometry-worker [--deadline-ms 1..3600000] [--draw-axis x|y|z] <input.step>... <out-dir>\n";
    return 64;
  }
  const std::string out_dir = argv[argc - 1];
  // Before any work: an output folder we cannot write to is a setup error, not a geometry result.
  if (access(out_dir.c_str(), W_OK) != 0) return fail("cannot_write_result", 5);
  if (deadline_ms > 0) arm_deadline(deadline_ms);

  // OCCT's own trace messages would mix with our output on stdout.
  Message::DefaultMessenger()->RemovePrinters(STANDARD_TYPE(Message_Printer));

  const auto started = std::chrono::steady_clock::now();
  occ::handle<TDocStd_Document> doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  if (doc.IsNull()) return fail("analysis_failed", 6);
  // Everything is converted to millimetres on import, whatever unit the file was written in.
  XCAFDoc_DocumentTool::SetLengthUnit(doc, 1.0, UnitsMethods_LengthUnit_Millimeter);
  const occ::handle<XCAFDoc_ShapeTool> shape_tool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  std::vector<Input> inputs;
  std::map<std::string, std::string> file_of;  // top-level shape (label entry) -> the file it was read from
  for (int i = arg; i < argc - 1; ++i) {
    Input in;
    const std::string path = argv[i];
    in.file = path.substr(path.find_last_of('/') + 1);
    try {
      STEPCAFControl_Reader reader;
      reader.SetNameMode(true);
      in.read = reader.ReadFile(path.c_str()) == IFSelect_RetDone && reader.Transfer(doc);
    } catch (const Standard_Failure&) {
      in.read = false;
    }
    NCollection_Sequence<TDF_Label> free;
    shape_tool->GetFreeShapes(free);
    for (const TDF_Label& root : free) {
      TCollection_AsciiString entry;
      TDF_Tool::Entry(root, entry);
      file_of.emplace(entry.ToCString(), in.file);
    }
    inputs.push_back(in);
  }
  if (std::none_of(inputs.begin(), inputs.end(), [](const Input& in) { return in.read; })) {
    return fail("unreadable_step", 2);
  }
  const double read_seconds = seconds_since(started);

  const auto analysed = std::chrono::steady_clock::now();
  std::map<std::string, TDF_Label> labels;
  std::vector<Node> tree;
  NCollection_Sequence<TDF_Label> roots;  // the kept top-level shapes, as `tree`
  try {
    const std::vector<Node> all = read_tree(doc, labels);
    NCollection_Sequence<TDF_Label> free;
    shape_tool->GetFreeShapes(free);  // in the order read_tree returns them
    std::map<std::string, std::set<std::string>> names_in;  // names inside each file's assemblies
    for (const Node& root : all) names_below(root, names_in[file_of[root.id]]);
    for (std::size_t i = 0; i < all.size(); ++i) {
      Node root = all[i];
      root.file = file_of[root.id];
      std::string holder;
      for (const auto& [file, names] : names_in) {
        if (file != root.file && !root.name.empty() && names.count(lower(root.name))) holder = file;
      }
      if (!holder.empty()) {
        for (Input& in : inputs)
          if (in.file == root.file) in.inside = holder;
        continue;
      }
      tree.push_back(root);
      roots.Append(free(static_cast<int>(i) + 1));
    }
    // Parts only under a root that was not kept are not measured.
    std::set<std::string> kept;
    for (const Node& root : tree) part_ids(root, kept);
    for (auto it = labels.begin(); it != labels.end();) it = kept.count(it->first) ? std::next(it) : labels.erase(it);
  } catch (const Standard_Failure&) {
    return fail("analysis_failed", 6);
  }
  const std::map<std::string, int> totals = part_totals(tree);
  std::vector<PartProperties> parts;
  // Three different counts (D109): distinct part definitions; their uses in the product; solids in the product.
  int solids = 0, part_instances = 0, solid_instances = 0;
  bool complete = true;  // recomputed after the 3D output
  for (const auto& [id, label] : labels) {
    PartProperties p = measure(label);
    p.id = id;
    const auto total = totals.find(id);
    p.total_quantity = total == totals.end() ? 0 : total->second;
    solids += p.solids;
    part_instances += p.total_quantity;
    solid_instances += p.solids * p.total_quantity;
    parts.push_back(std::move(p));
  }
  if (solids == 0) return fail("no_solids", 3);
  const double analyse_seconds = seconds_since(analysed);

  const auto meshed = std::chrono::steady_clock::now();
  if (mkdir((out_dir + "/parts").c_str(), 0755) != 0 && errno != EEXIST) return fail("cannot_write_result", 5);
  int triangles = 0;
  const bool model_written = write_3d(doc, roots, labels, parts, out_dir, triangles);
  complete = model_written;
  const double mesh_seconds = seconds_since(meshed);

  // Casting measurements need the display mesh (wall thickness starts from its triangles).
  const auto cast = std::chrono::steady_clock::now();
  for (PartProperties& p : parts) {
    if (!p.valid || !p.volume || !p.box_min || !p.box_max) continue;
    try {
      p.casting = measure_casting(labels.at(p.id), p, forced_axis);
    } catch (const Standard_Failure&) {
      p.problems.push_back("failed:casting");
    }
    if (p.casting) {
      try {
        find_parting_line(labels.at(p.id), p, *p.casting);
      } catch (const Standard_Failure&) {
        p.problems.push_back("failed:parting");
      }
    }
    if (p.casting) {
      try {
        find_draft(labels.at(p.id), p, *p.casting);
      } catch (const Standard_Failure&) {
        p.problems.push_back("failed:draft");
      }
    }
    try {
      p.features = recognise_features(labels.at(p.id), p.casting);
    } catch (const Standard_Failure&) {
      p.problems.push_back("failed:features");
    }
    if (p.casting && !p.casting->cores.empty()) {
      try {
        build_cores(labels.at(p.id), p, out_dir);
      } catch (const Standard_Failure&) {
        p.problems.push_back("failed:cores");
      }
    }
  }
  const double casting_seconds = seconds_since(cast);
  for (const PartProperties& p : parts) complete = complete && p.problems.empty();
  for (const Input& in : inputs) complete = complete && in.read;

  JsonWriter json;
  json.begin_object()
      .key("schema_version").value(kSchemaVersion)
      .key("units").value("mm")
      .key("status").value(complete ? "complete" : "partial")
      .key("model_glb");
  if (model_written) {
    json.value("model.glb");
  } else {
    json.null();
  }
  json.key("inputs").begin_array();
  for (const Input& in : inputs) {
    json.begin_object().key("file").value(in.file).key("read").value(in.read).key("inside");
    if (in.inside.empty()) {
      json.null();
    } else {
      json.value(in.inside);
    }
    json.end_object();
  }
  json.end_array().key("assembly").begin_array();
  for (const Node& root : tree) write_node(json, root);
  json.end_array().key("parts").begin_array();
  for (const PartProperties& p : parts) write_part(json, p);
  json.end_array()
      .key("diagnostics").begin_object()
      .key("read_seconds").value(read_seconds)
      .key("analyse_seconds").value(analyse_seconds)
      .key("mesh_seconds").value(mesh_seconds)
      .key("casting_seconds").value(casting_seconds)
      .key("triangles").value(triangles)
      .key("distinct_parts").value(static_cast<int>(parts.size()))
      .key("part_instances").value(part_instances)
      .key("solid_instances").value(solid_instances)
      .key("worker_version").value(kWorkerVersion)
      .key("occt_version").value(OCC_VERSION_COMPLETE)
      .end_object()
      .end_object();

  if (!publish(out_dir, json.str() + "\n")) return fail("cannot_write_result", 5);
  std::cout << "{\"distinct_parts\":" << parts.size() << ",\"solid_instances\":" << solid_instances << ",\"seconds\":"
            << seconds_since(started) << "}\n";
  return 0;
}
