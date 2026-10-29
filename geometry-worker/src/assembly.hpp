// The assembly structure of a STEP file, read through XDE. A STEP assembly is part *definitions* plus *instances* that reference
// them; reading it as one merged shape loses that. Here instances of one definition under one parent collapse into a node with a
// quantity, and each distinct part definition is returned once, so it is measured and exported once however often it is used.
// Port of cad-engine/shared/assembly.py.
#pragma once

#include <map>
#include <string>
#include <vector>

#include <TopoDS_Shape.hxx>

namespace gw {

constexpr int kMaxDepth = 64;  // real product trees are a few levels deep; this stops a hostile file exhausting the stack

enum class Kind { Part, Assembly, EmptyAssembly };

struct Node {
  std::string definition;  // document-unique id (label entry, with the file prefix) of the definition this node instances
  std::string name;
  Kind kind = Kind::Part;
  long quantity = 1;
  std::vector<Node> children;  // empty unless kind == Assembly
};

struct Assembly {
  std::vector<Node> roots;
  // part definition id -> its shape (kind == Part only, one per definition), in first-seen order via `order`
  std::map<std::string, TopoDS_Shape> shapes;
  std::vector<std::string> order;
};

// `prefix` keeps definition ids unique when several files are read together ("0:", "1:", ...). Throws StepError.
Assembly read_assembly(const std::string& step_path, const std::string& prefix);

// Total quantity of every part definition: quantities multiply down each path. Keys come back in first-seen (depth-first) order.
std::vector<std::pair<std::string, long>> part_totals(const std::vector<Node>& roots);

const char* kind_name(Kind kind);

}  // namespace gw
