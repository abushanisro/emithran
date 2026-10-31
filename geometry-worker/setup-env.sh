#!/bin/sh
# The build environment for the worker: Open CASCADE pinned to the version pythonocc-core 7.7.2 uses (the parity test depends on it).
set -eu
conda create -n gw -y -c conda-forge occt=7.7.2 cmake cxx-compiler make nlohmann_json libgl-devel
conda clean -afy
