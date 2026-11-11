# cad-core: two small non-root images from one file (docs/ASSEMBLY_CORE.md "Isolation"):
#   worker  the C++ geometry-worker and `cad-worker-host`: parses customer CAD, holds no credential, runs with no network (UID 10005)
#   runner  `cad-runner` (the default target): holds the database and bucket credentials, never parses CAD (UID 10003)
# They talk only through a Unix socket on a volume the two share. Build both:
#   docker build --build-context geometry=geometry-worker --build-context fixtures=backend/test/fixtures/cad --target worker -t cad-worker:dev core
#   docker build -t cad-core:dev core
# (docker-compose.prod.yml passes the same named contexts and targets.) Base images are pinned by digest; Dependabot proposes bumps.

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
# /run/cad-worker is where the shared volume is mounted. Both images create it owned by the worker (10005, group 10005, mode
# 0750), so the volume gets that ownership whichever container mounts it first; the runner joins group 10005 to reach the socket.
FROM debian:trixie-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS base
RUN apt-get update && apt-get upgrade -y --no-install-recommends && rm -rf /var/lib/apt/lists/* \
 && install -d -o 10005 -g 10005 -m 0750 /run/cad-worker

# util-linux provides prlimit (the host refuses to run the worker without it). Nothing else: no certificates, no network tools.
FROM base AS worker
RUN apt-get update && apt-get install -y --no-install-recommends util-linux && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 10005 geometry && useradd --system --uid 10005 --gid 10005 --no-create-home geometry
COPY --from=gw /deps /opt/occt/lib
COPY --from=gw /src/build/geometry-worker /usr/local/bin/geometry-worker
COPY --from=rust /src/target/release/cad-worker-host /usr/local/bin/cad-worker-host
ENV LD_LIBRARY_PATH=/opt/occt/lib WORKER_BIN=/usr/local/bin/geometry-worker TMPDIR=/tmp WORKER_SOCKET=/run/cad-worker/worker.sock
USER 10005:10005
CMD ["cad-worker-host"]

# ca-certificates lets the runner verify the data API's and bucket's TLS certificates. No CAD code, no OCCT libraries.
FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10003 --no-create-home core
COPY --from=rust /src/target/release/cad-runner /usr/local/bin/cad-runner
ENV TMPDIR=/tmp WORKER_SOCKET=/run/cad-worker/worker.sock
USER 10003
CMD ["cad-runner"]
