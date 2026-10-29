#!/bin/sh
# Builds the worker and runs its hand-worked checks; the build fails if the checks do. Run inside the `gw` conda environment.
# conda ships its toolchain under an architecture prefix (x86_64-conda-linux-gnu-ar, aarch64-...), so CMake is told where `ar` is.
set -eu
export PATH=/opt/conda/envs/gw/bin:$PATH CMAKE_PREFIX_PATH=/opt/conda/envs/gw
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_AR="$(ls /opt/conda/envs/gw/bin/*-conda-linux-gnu-ar | head -1)"
cmake --build build -j"$(nproc)"
GW_FIXTURES=/fixtures ./build/unit_tests
