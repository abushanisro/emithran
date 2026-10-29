#include "assembly.hpp"

#include <TCollection_AsciiString.hxx>
#include <TCollection_ExtendedString.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDF_Tool.hxx>
#include <TDataStd_Name.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

#include "step_io.hpp"

namespace gw {

namespace {

// OCCT stores names as UTF-16; the report is UTF-8.
std::string to_utf8(const TCollection_ExtendedString& text) {
  std::string out;
  const Standard_ExtString units = text.ToExtString();
  const int n = text.Length();
  for (int i = 0; i < n; ++i) {
    unsigned code = units[i];
    if (code >= 0xD800 && code < 0xDC00 && i + 1 < n && units[i + 1] >= 0xDC00 && units[i + 1] < 0xE000) {
      code = 0x10000 + ((code - 0xD800) << 10) + (units[++i] - 0xDC00);
    }
    if (code < 0x80) {
      out += static_cast<char>(code);
    } else if (code < 0x800) {
      out += static_cast<char>(0xC0 | (code >> 6));
      out += static_cast<char>(0x80 | (code & 0x3F));
    } else if (code < 0x10000) {
      out += static_cast<char>(0xE0 | (code >> 12));
      out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (code & 0x3F));
    } else {
      out += static_cast<char>(0xF0 | (code >> 18));
      out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
      out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
      out += static_cast<char>(0x80 | (code & 0x3F));
    }
  }
  return out;
}

std::string label_name(const TDF_Label& label) {
  Handle(TDataStd_Name) name;
  if (label.FindAttribute(TDataStd_Name::GetID(), name)) return to_utf8(name->Get());
  return {};
}

std::string entry_of(const TDF_Label& label, const std::string& prefix) {
  TCollection_AsciiString text;
  TDF_Tool::Entry(label, text);
  return prefix + text.ToCString();
}

}  // namespace

const char* kind_name(Kind kind) {
  switch (kind) {
    case Kind::Part: return "part";
    case Kind::Assembly: return "assembly";
    case Kind::EmptyAssembly: return "empty_assembly";
  }
  return "part";
}

Assembly read_assembly(const std::string& step_path, const std::string& prefix) {
  Handle(TDocStd_Document) doc = read_document(step_path);
  Handle(XCAFDoc_ShapeTool) tool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  Assembly assembly;

  struct Builder {
    const Handle(XCAFDoc_ShapeTool)& tool;
    const std::string& prefix;
    Assembly& out;

    Node build(const TDF_Label& label, int depth) {
      if (depth > kMaxDepth) throw StepError("Assembly nested deeper than " + std::to_string(kMaxDepth) + " levels");
      TDF_Label definition;
      if (tool->IsReference(label)) {
        tool->GetReferredShape(label, definition);
      } else {
        definition = label;
      }
      const std::string key = entry_of(definition, prefix);
      std::string name = label_name(definition);
      if (name.empty()) name = key;

      Node node;
      node.definition = key;
      node.name = name;
      if (!tool->IsAssembly(definition)) {
        TopoDS_Shape shape = tool->GetShape(definition);
        if (shape.IsNull()) throw StepError("Part '" + name + "' has no geometry");
        if (out.shapes.emplace(key, shape).second) out.order.push_back(key);
        node.kind = Kind::Part;
        return node;
      }

      TDF_LabelSequence components;
      tool->GetComponents(definition, components);
      if (components.Length() == 0) {
        node.kind = Kind::EmptyAssembly;
        return node;
      }
      node.kind = Kind::Assembly;
      std::map<std::string, size_t> by_definition;  // definition id -> index in node.children (file order is kept)
      for (int i = 1; i <= components.Length(); ++i) {
        Node child = build(components.Value(i), depth + 1);
        auto found = by_definition.find(child.definition);
        if (found != by_definition.end()) {
          node.children[found->second].quantity += 1;
        } else {
          by_definition.emplace(child.definition, node.children.size());
          node.children.push_back(std::move(child));
        }
      }
      return node;
    }
  } builder{tool, prefix, assembly};

  TDF_LabelSequence free_shapes;
  tool->GetFreeShapes(free_shapes);
  if (free_shapes.Length() == 0) throw StepError("STEP file contains no shapes");
  for (int i = 1; i <= free_shapes.Length(); ++i) assembly.roots.push_back(builder.build(free_shapes.Value(i), 0));
  return assembly;
}

std::vector<std::pair<std::string, long>> part_totals(const std::vector<Node>& roots) {
  std::vector<std::pair<std::string, long>> totals;
  std::map<std::string, size_t> index;
  struct Walk {
    std::vector<std::pair<std::string, long>>& totals;
    std::map<std::string, size_t>& index;
    void operator()(const Node& node, long factor) {
      factor *= node.quantity;
      if (node.kind == Kind::Part) {
        auto found = index.find(node.definition);
        if (found == index.end()) {
          index.emplace(node.definition, totals.size());
          totals.emplace_back(node.definition, factor);
        } else {
          totals[found->second].second += factor;
        }
      }
      for (const Node& child : node.children) (*this)(child, factor);
    }
  } walk{totals, index};
  for (const Node& root : roots) walk(root, 1);
  return totals;
}

}  // namespace gw
