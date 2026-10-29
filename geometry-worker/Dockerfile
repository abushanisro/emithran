# geometry-worker: the only process that parses CAD (see docs/ASSEMBLY_CORE.md). This image is the build and test stage used by CI
# and the parity test; the deployed image is core/Dockerfile, which builds the same sources with the same two scripts.
#   docker build --platform linux/amd64 --build-context fixtures=backend/test/fixtures/cad -t gw-build:dev geometry-worker
FROM continuumio/miniconda3:26.7.1-1@sha256:eca594d684f495c1a02beff33a9fab53aec8c5830eaf431bb149912dc6c9e4c1 AS build
COPY setup-env.sh /setup-env.sh
RUN /setup-env.sh
WORKDIR /src
COPY build.sh CMakeLists.txt ./
COPY src ./src
COPY tests ./tests
COPY --from=fixtures . /fixtures
RUN ./build.sh
