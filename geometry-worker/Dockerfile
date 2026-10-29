# geometry-worker: the only process that parses CAD. Open CASCADE comes from conda-forge, pinned to the version pythonocc-core 7.7.2
# uses, so this worker and the Python engine read and measure STEP identically (the parity test depends on it).
FROM continuumio/miniconda3:26.7.1-1@sha256:eca594d684f495c1a02beff33a9fab53aec8c5830eaf431bb149912dc6c9e4c1 AS build
RUN conda create -n gw -y -c conda-forge occt=7.7.2 cmake cxx-compiler make nlohmann_json libgl-devel && conda clean -afy
WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src
COPY tests ./tests
ENV PATH=/opt/conda/envs/gw/bin:$PATH CMAKE_PREFIX_PATH=/opt/conda/envs/gw
# conda ships its toolchain under an architecture prefix (x86_64-conda-linux-gnu-ar, aarch64-...), so CMake is told where it is
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_AR="$(ls /opt/conda/envs/gw/bin/*-conda-linux-gnu-ar | head -1)" \
 && cmake --build build -j"$(nproc)"
# the hand-worked checks run at build time: an image that does not read STEP correctly is never produced
COPY --from=fixtures . /fixtures
RUN GW_FIXTURES=/fixtures ./build/unit_tests
