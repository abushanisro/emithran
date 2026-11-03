#!/bin/sh
# Copies Open CASCADE's headers out of the worker's build image into geometry-worker/.occt/include, so the
# editor (VS Code C/C++, .vscode/c_cpp_properties.json) can resolve the #includes. The worker itself is only ever
# built in the container; the copy is for the editor, git-ignored, never committed. CONTAINER=podman for Podman.
set -eu
cd "$(dirname "$0")/.."
CONTAINER="${CONTAINER:-docker}"
$CONTAINER build -q --target occt -t petrus-occt-build:8.0.1 . >/dev/null   # cached after the first build
container="$($CONTAINER create petrus-occt-build:8.0.1)"
trap '$CONTAINER rm "$container" >/dev/null' EXIT
rm -rf .occt && mkdir -p .occt
$CONTAINER cp "$container:/opt/occt/include" .occt/include
echo "OCCT headers in geometry-worker/.occt/include ($(ls .occt/include/opencascade | wc -l | tr -d ' ') files)"
