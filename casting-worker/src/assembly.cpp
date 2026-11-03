// Assembly tree from XDE: each assembly's components are references to part or sub-assembly definitions.
// Components that refer to the same definition under one parent become one node with a quantity.

#include "model.hpp"

#include <TCollection_AsciiString.hxx>
#include <TDF_Tool.hxx>
#include <TDataStd_Name.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>

namespace {

std::string entry(const TDF_Label& label) {
  TCollection_AsciiString text;
  TDF_Tool::Entry(label, text);
  return text.ToCString();
}

Node build(const TDF_Label& definition, std::map<std::string, TDF_Label>& parts) {
  Node node;
  node.id = entry(definition);
  node.name = name_of(definition);
  node.assembly = XCAFDoc_ShapeTool::IsAssembly(definition);
  if (!node.assembly) {
    parts.emplace(node.id, definition);
    return node;
  }
  NCollection_Sequence<TDF_Label> components;
  XCAFDoc_ShapeTool::GetComponents(definition, components);
  std::map<std::string, size_t> position;  // definition id -> index in node.children, keeps file order
  for (const TDF_Label& component : components) {
    TDF_Label referred;
    if (!XCAFDoc_ShapeTool::GetReferredShape(component, referred)) continue;
    const auto [it, added] = position.emplace(entry(referred), node.children.size());
    if (added) {
      node.children.push_back(build(referred, parts));
    } else {
      ++node.children[it->second].quantity;
    }
    node.children[it->second].instance_ids.push_back(entry(component));
  }
  return node;
}

void add_totals(const Node& node, int multiplier, std::map<std::string, int>& totals) {
  const int here = multiplier * node.quantity;
  if (!node.assembly) totals[node.id] += here;
  for (const Node& child : node.children) add_totals(child, here, totals);
}

}  // namespace

std::string name_of(const TDF_Label& label) {
  occ::handle<TDataStd_Name> name;
  if (!label.FindAttribute(TDataStd_Name::GetID(), name)) return "";
  return TCollection_AsciiString(name->Get()).ToCString();
}

std::vector<Node> read_tree(const occ::handle<TDocStd_Document>& doc, std::map<std::string, TDF_Label>& parts) {
  NCollection_Sequence<TDF_Label> roots;
  XCAFDoc_DocumentTool::ShapeTool(doc->Main())->GetFreeShapes(roots);
  std::vector<Node> tree;
  for (const TDF_Label& root : roots) {
    tree.push_back(build(root, parts));
    tree.back().instance_ids.push_back(tree.back().id);  // a top-level shape is its own (only) instance
  }
  return tree;
}

std::map<std::string, int> part_totals(const std::vector<Node>& roots) {
  std::map<std::string, int> totals;
  for (const Node& root : roots) add_totals(root, 1, totals);
  return totals;
}
