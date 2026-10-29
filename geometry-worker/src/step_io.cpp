#include "step_io.hpp"

#include <filesystem>

#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Writer.hxx>
#include <TDocStd_Application.hxx>
#include <XCAFApp_Application.hxx>

namespace gw {

Handle(TDocStd_Document) read_document(const std::string& path) {
  if (!std::filesystem::exists(path)) throw StepError("STEP file does not exist: " + path);
  Handle(TDocStd_Document) doc;
  XCAFApp_Application::GetApplication()->NewDocument("MDTV-XCAF", doc);
  STEPCAFControl_Reader reader;
  reader.SetNameMode(true);
  if (reader.ReadFile(path.c_str()) != IFSelect_RetDone) throw StepError("Failed to read STEP file");
  if (!reader.Transfer(doc)) throw StepError("Failed to transfer STEP file to the assembly document");
  return doc;
}

void write_step(const TopoDS_Shape& shape, const std::string& path) {
  if (shape.IsNull()) throw StepError("Cannot write a null shape");
  STEPControl_Writer writer;
  if (writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone) throw StepError("Failed to transfer the shape to the STEP model");
  if (writer.Write(path.c_str()) != IFSelect_RetDone) throw StepError("Failed to write STEP file: " + path);
  std::error_code ec;
  if (!std::filesystem::exists(path, ec) || std::filesystem::file_size(path, ec) == 0) throw StepError("STEP file was not created: " + path);
}

}  // namespace gw
