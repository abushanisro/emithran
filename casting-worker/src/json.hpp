// Minimal JSON writer for result.json: objects, arrays, strings (escaped), numbers, booleans. No parsing.
#pragma once

#include <cmath>
#include <cstdio>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

class JsonWriter {
 public:
  JsonWriter& begin_object() { return open('{'); }
  JsonWriter& end_object() { return close('}'); }
  JsonWriter& begin_array() { return open('['); }
  JsonWriter& end_array() { return close(']'); }

  JsonWriter& key(std::string_view name) {
    separate();
    quote(name);
    out_ += ':';
    after_key_ = true;
    return *this;
  }

  JsonWriter& value(std::string_view text) {
    separate();
    quote(text);
    return *this;
  }
  JsonWriter& value(const char* text) { return value(std::string_view(text)); }
  JsonWriter& value(bool flag) {
    separate();
    out_ += flag ? "true" : "false";
    return *this;
  }
  JsonWriter& value(int number) {
    separate();
    out_ += std::to_string(number);
    return *this;
  }
  // Ten significant digits: enough for millimetre geometry; non-finite values become null.
  JsonWriter& value(double number) {
    separate();
    if (!std::isfinite(number)) {
      out_ += "null";
      return *this;
    }
    char buffer[32];
    std::snprintf(buffer, sizeof buffer, "%.10g", number);
    out_ += buffer;
    return *this;
  }

  JsonWriter& null() {
    separate();
    out_ += "null";
    return *this;
  }
  JsonWriter& value(const std::optional<double>& number) { return number ? value(*number) : null(); }

  const std::string& str() const { return out_; }

 private:
  JsonWriter& open(char bracket) {
    separate();
    out_ += bracket;
    first_.push_back(1);
    return *this;
  }
  JsonWriter& close(char bracket) {
    out_ += bracket;
    first_.pop_back();
    return *this;
  }
  // A comma before every element except the first of its container, and none right after a key.
  void separate() {
    if (after_key_) {
      after_key_ = false;
      return;
    }
    if (!first_.empty()) {
      if (!first_.back()) out_ += ',';
      first_.back() = 0;
    }
  }
  void quote(std::string_view text) {
    out_ += '"';
    for (unsigned char c : text) {
      switch (c) {
        case '"': out_ += "\\\""; break;
        case '\\': out_ += "\\\\"; break;
        case '\n': out_ += "\\n"; break;
        case '\r': out_ += "\\r"; break;
        case '\t': out_ += "\\t"; break;
        default:
          if (c < 0x20) {
            char buffer[8];
            std::snprintf(buffer, sizeof buffer, "\\u%04x", c);
            out_ += buffer;
          } else {
            out_ += static_cast<char>(c);
          }
      }
    }
    out_ += '"';
  }

  std::string out_;
  std::vector<char> first_;  // per open container: 1 until its first element (not vector<bool>: packed bits)
  bool after_key_ = false;
};
