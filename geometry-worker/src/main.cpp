// geometry-worker: reads STEP files, writes the assembly report and one STEP file per distinct part. See docs/ASSEMBLY_CORE.md.
//   geometry-worker --deadline-ms <ms> <out_dir> <file.step> [file.step ...]
// Exit codes: 0 ok, 2 no file readable, 3 no solids, 4 deadline, 6 analysis failed, 64 bad arguments.
#include <fcntl.h>
#include <unistd.h>

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>

#include <Standard_Failure.hxx>

#include "report.hpp"

namespace {

constexpr int kOk = 0, kUnreadable = 2, kNoSolids = 3, kDeadline = 4, kAnalysisFailed = 6, kUsage = 64;

// Writes result.json so a reader sees either the old file or the whole new one, never half of it: temp file, fsync, rename.
bool write_atomically(const std::filesystem::path& target, const std::string& text) {
  const std::filesystem::path temp = target.string() + ".tmp";
  const int fd = ::open(temp.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (fd < 0) return false;
  size_t written = 0;
  while (written < text.size()) {
    const ssize_t n = ::write(fd, text.data() + written, text.size() - written);
    if (n <= 0) {
      ::close(fd);
      return false;
    }
    written += static_cast<size_t>(n);
  }
  const bool synced = ::fsync(fd) == 0;
  ::close(fd);
  if (!synced) return false;
  std::error_code ec;
  std::filesystem::rename(temp, target, ec);
  return !ec;
}

}  // namespace

int main(int argc, char** argv) {
  // Strict arguments: anything else is a usage error, never guessed.
  if (argc < 5 || std::string(argv[1]) != "--deadline-ms") {
    std::cerr << "usage: geometry-worker --deadline-ms <ms> <out_dir> <file.step> [file.step ...]\n";
    return kUsage;
  }
  char* end = nullptr;
  const long deadline_ms = std::strtol(argv[2], &end, 10);
  if (end == argv[2] || *end != '\0' || deadline_ms <= 0) {
    std::cerr << "--deadline-ms must be a positive integer\n";
    return kUsage;
  }
  const std::filesystem::path out_dir = argv[3];
  if (!std::filesystem::is_directory(out_dir)) {
    std::cerr << "the output folder does not exist: " << out_dir << "\n";
    return kUsage;
  }
  std::vector<std::pair<std::string, std::string>> files;
  for (int i = 4; i < argc; ++i) files.emplace_back(std::filesystem::path(argv[i]).filename().string(), argv[i]);

  const auto started = std::chrono::steady_clock::now();
  const auto checkpoint = [&] {
    if (std::chrono::steady_clock::now() - started > std::chrono::milliseconds(deadline_ms)) throw gw::DeadlineExceeded{};
  };

  try {
    gw::Built built = gw::build_report(files, checkpoint);
    if (!write_atomically(out_dir / "result.json", built.report.dump())) {
      std::cerr << "cannot write result.json\n";
      return kAnalysisFailed;
    }
    if (!built.any_readable) {
      std::cerr << "none of the STEP files could be read\n";
      return kUnreadable;
    }
    if (built.part_ids.empty()) {
      std::cerr << "the STEP files hold no solids\n";
      return kNoSolids;
    }
    std::filesystem::create_directories(out_dir / "parts");
    gw::export_parts(built, (out_dir / "parts").string(), checkpoint);
    return kOk;
  } catch (const gw::DeadlineExceeded&) {
    std::cerr << "deadline of " << deadline_ms << " ms exceeded\n";
    return kDeadline;
  } catch (const Standard_Failure& failure) {
    std::cerr << "analysis failed: " << failure.GetMessageString() << "\n";
    return kAnalysisFailed;
  } catch (const std::exception& failure) {
    std::cerr << "analysis failed: " << failure.what() << "\n";
    return kAnalysisFailed;
  }
}
