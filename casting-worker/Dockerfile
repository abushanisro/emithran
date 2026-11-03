# Geometry worker image (roadmap B1, ADR 0005, D105). Open CASCADE 8.0.1 is not packaged by any distribution yet,
# so it is built from the release source (tag V8_0_1, checksum below) with only what the worker needs: no Draw,
# no OpenGL, X11, Freetype or Tk. Linked dynamically (LGPL-2.1 + OCCT exception); licence texts are in the image.
# OCCT's own checks stay on in the release build (BUILD_RELEASE_DISABLE_EXCEPTIONS=OFF), so bad geometry from an
# untrusted file raises an exception the worker reports, instead of undefined behaviour (D108).
# Build:  docker build -t casting-worker casting-worker
# Run sandboxed: --network none --read-only --memory ... (see check.sh).

FROM docker.io/library/debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad AS occt
RUN apt-get update && apt-get install -y --no-install-recommends \
        g++=4:14.2.0-1 cmake=3.31.6-2 ninja-build=1.12.1-1+b1 rapidjson-dev=1.1.0+dfsg2-7.4 \
    && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:dba62b81078dd43cec23feba89432be301582341001edad1b93342ad8bda35ea \
    https://github.com/Open-Cascade-SAS/OCCT/archive/b8f597c677811d1f9f4d8a97f5ae2825c0353a42.tar.gz /tmp/occt.tar.gz
RUN mkdir /tmp/occt && tar -xzf /tmp/occt.tar.gz -C /tmp/occt --strip-components=1 \
    && cmake -S /tmp/occt -B /tmp/occt-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DINSTALL_DIR=/opt/occt \
        -DBUILD_LIBRARY_TYPE=Shared -DBUILD_MODULE_Draw=OFF -DUSE_TK=OFF -DUSE_FREETYPE=OFF -DUSE_OPENGL=OFF \
        -DUSE_XLIB=OFF -DUSE_RAPIDJSON=ON -DBUILD_DOC_Overview=OFF \
        -DBUILD_RELEASE_DISABLE_EXCEPTIONS=OFF \
    && cmake --build /tmp/occt-build \
    && cmake --install /tmp/occt-build \
    && cp /tmp/occt/LICENSE_LGPL_21.txt /tmp/occt/OCCT_LGPL_EXCEPTION.txt /opt/occt/ \
    && rm -rf /tmp/occt /tmp/occt-build /tmp/occt.tar.gz

FROM occt AS build
COPY CMakeLists.txt /src/
COPY src /src/src
COPY tools /src/tools
COPY tests/unit_tests.cpp /src/tests/
RUN cmake -S /src -B /build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH=/opt/occt \
        -DCMAKE_INSTALL_PREFIX=/opt/worker \
    && cmake --build /build && cmake --install /build

FROM docker.io/library/debian:trixie-slim@sha256:62bd423aeee912639ca8ee681c2b762cb3e25137e0a92b20be455898a9f034ad
COPY --from=occt /opt/occt/lib /opt/occt/lib
COPY --from=occt /opt/occt/LICENSE_LGPL_21.txt /opt/occt/OCCT_LGPL_EXCEPTION.txt /usr/share/licenses/occt/
COPY --from=build /opt/worker/bin /usr/local/bin
COPY result.schema.json /usr/share/casting-worker/result.schema.json
# Non-root user id 65532, as the other containers of this repository.
RUN echo /opt/occt/lib > /etc/ld.so.conf.d/occt.conf && ldconfig \
    && useradd --uid 65532 --no-create-home --shell /usr/sbin/nologin worker \
    && install -d -o 65532 -g 65532 /cad && command -v prlimit
USER 65532
ENTRYPOINT ["/usr/local/bin/geometry-worker"]
