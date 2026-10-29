// Reading and writing STEP through Open CASCADE XDE. The only file that talks to the STEP readers and writers.
#pragma once

#include <stdexcept>
#include <string>

#include <STEPCAFControl_Reader.hxx>
#include <TDocStd_Document.hxx>
#include <TopoDS_Shape.hxx>

namespace gw {

// A file that cannot be read as STEP, or whose structure is outside what the worker accepts. The message is for a human;
// the runner only ever sees the exit code and the last bytes of stderr.
struct StepError : std::runtime_error {
  using std::runtime_error::runtime_error;
};

// Reads a STEP file (names on) into a fresh XDE document.
Handle(TDocStd_Document) read_document(const std::string& path);

// Writes one shape as a STEP file; throws StepError when OCCT fails or the file is empty.
void write_step(const TopoDS_Shape& shape, const std::string& path);

}  // namespace gw
