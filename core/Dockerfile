# cad-core: the Rust cad-runner plus the C++ geometry-worker it supervises, in one small non-root image. One command builds it all:
#   docker build --platform linux/amd64 --build-context geometry=geometry-worker --build-context fixtures=backend/test/fixtures/cad -t cad-core:dev core
# (docker-compose.prod.yml passes the same two named contexts.) Base images are pinned by digest; Dependabot proposes bumps.

FROM rust:1.99-slim-bookworm@sha256:24707e70a4f1e23d9a7b25202ec43126d28a52294b96aad5c670df1fd1f1d400 AS rust
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
RUN cargo build --release --locked -p runner

# The worker: built and checked by the same scripts CI uses (geometry-worker/build.sh runs the hand-worked checks).
FROM continuumio/miniconda3:26.7.1-1@sha256:eca594d684f495c1a02beff33a9fab53aec8c5830eaf431bb149912dc6c9e4c1 AS gw
COPY --from=geometry setup-env.sh /setup-env.sh
RUN /setup-env.sh
WORKDIR /src
COPY --from=geometry build.sh CMakeLists.txt ./
COPY --from=geometry src ./src
COPY --from=geometry tests ./tests
COPY --from=fixtures . /fixtures
RUN ./build.sh
# Ship only the shared libraries the worker really links (found with ldd, transitively), not the whole conda environment: the
# environment carries VTK, LLVM, ffmpeg and Python, about 1 GB the worker never loads.
RUN mkdir /deps && ldd build/geometry-worker | awk '/=> \/opt\/conda/ {print $3}' | xargs -I{} cp -L {} /deps/

# Same Debian release as the conda image the worker is compiled in (glibc must not be older than the build's).
FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
# util-linux provides prlimit; ca-certificates lets the runner verify the data API's and bucket's TLS certificates. Nothing else.
RUN apt-get update && apt-get upgrade -y --no-install-recommends && apt-get install -y --no-install-recommends util-linux ca-certificates \
 && rm -rf /var/lib/apt/lists/* && useradd --system --uid 10003 --no-create-home core
COPY --from=gw /deps /opt/occt/lib
COPY --from=gw /src/build/geometry-worker /usr/local/bin/geometry-worker
COPY --from=rust /src/target/release/cad-runner /usr/local/bin/cad-runner
ENV LD_LIBRARY_PATH=/opt/occt/lib WORKER_BIN=/usr/local/bin/geometry-worker TMPDIR=/tmp
USER 10003
CMD ["cad-runner"]
