cmake_minimum_required(VERSION 3.20)
project(geometry_worker LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()
add_compile_options(-Wall -Wextra -Wpedantic -Werror)

# Open CASCADE is linked dynamically (LGPL-2.1): the runtime image ships its shared libraries. Same major version as the
# pythonocc-core the Python engine uses (7.7.2), so both read and measure STEP the same way (the parity test depends on it).
find_package(OpenCASCADE REQUIRED)
find_package(nlohmann_json REQUIRED)

set(OCCT_LIBS
  TKernel TKMath TKG2d TKG3d TKGeomBase TKBRep TKGeomAlgo TKTopAlgo TKPrim TKBO TKShHealing
  TKXSBase TKLCAF TKCDF TKCAF TKXCAF TKSTEPBase TKSTEPAttr TKSTEP209 TKSTEP TKXDESTEP)

add_library(core STATIC src/assembly.cpp src/measure.cpp src/report.cpp src/step_io.cpp)
target_include_directories(core PUBLIC src ${OpenCASCADE_INCLUDE_DIR})
target_link_directories(core PUBLIC ${OpenCASCADE_LIBRARY_DIR})
target_link_libraries(core PUBLIC ${OCCT_LIBS} nlohmann_json::nlohmann_json)

add_executable(geometry-worker src/main.cpp)
target_link_libraries(geometry-worker PRIVATE core)

enable_testing()
add_executable(unit_tests tests/unit_tests.cpp)
target_link_libraries(unit_tests PRIVATE core)
add_test(NAME unit_tests COMMAND unit_tests)
