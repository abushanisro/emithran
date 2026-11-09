#!/bin/sh
# The build environment for the worker: Open CASCADE pinned to the version pythonocc-core 7.8.1 uses (the parity test depends on it).
set -eu
conda create -n gw -y -c conda-forge occt=7.8.1 cmake cxx-compiler make nlohmann_json libgl-devel
conda clean -afy
