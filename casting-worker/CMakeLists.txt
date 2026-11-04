# Geometry worker (roadmap B1, ADR 0005): reads STEP with Open CASCADE 8.0.1, linked dynamically (LGPL-2.1).
cmake_minimum_required(VERSION 3.25)
project(geometry_worker LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenCASCADE 8.0.1 EXACT REQUIRED CONFIG)

add_compile_options(-Wall -Wextra -Werror)

add_executable(geometry-worker src/main.cpp src/assembly.cpp src/properties.cpp src/mesh.cpp src/casting.cpp src/draft.cpp src/features.cpp src/parting.cpp src/cores.cpp)
target_include_directories(geometry-worker PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_libraries(geometry-worker PRIVATE TKDESTEP TKDEGLTF TKRWMesh TKMesh TKXCAF TKLCAF TKCAF TKShHealing TKBO TKOffset TKFillet TKBool
    TKTopAlgo TKGeomBase TKG3d TKBRep TKXSBase TKernel TKMath)

# Writes the synthetic STEP samples the checks use (never customer files).
add_executable(make-samples tools/make_samples.cpp)
target_include_directories(make-samples PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_libraries(make-samples PRIVATE TKDESTEP TKXCAF TKLCAF TKCAF TKBO TKFillet TKPrim TKTopAlgo TKBRep TKXSBase
    TKernel TKMath)

# Validity and healing on in-memory shapes; run by ci/check-geometry-worker.sh.
add_executable(unit-tests tests/unit_tests.cpp src/assembly.cpp src/properties.cpp)
target_include_directories(unit-tests PRIVATE ${OpenCASCADE_INCLUDE_DIR})
target_link_libraries(unit-tests PRIVATE TKXCAF TKLCAF TKCAF TKShHealing TKPrim TKTopAlgo TKGeomBase TKG3d TKBRep
    TKernel TKMath)

install(TARGETS geometry-worker make-samples unit-tests RUNTIME DESTINATION bin)
