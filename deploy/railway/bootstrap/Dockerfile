# One-off job: load the baseline into an EMPTY database, then exit. It runs backend/scripts/baseline-load.sh UNMODIFIED (the script's every
# database command goes through one `docker run <this same image>` call; the stand-in `docker` below runs the command in place), so the
# loader that CI and local development already exercise is the one that runs here. Built by seed-environment.sh into a temporary folder
# that holds the baseline (never committed: it carries reference data and the user directory).
#
# It runs as the unprivileged `postgres` user. The loader names /baseline, /migrations, /work and /baseline.dangling at the filesystem root, so
# each exists at build time and is writable by that user: /migrations and /baseline are copied there, /work is a link to /tmp/work, and
# /baseline.dangling is an empty folder. The `mktemp` stand-in hands the loader that work folder. Nothing at run time needs root.
FROM postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
RUN apk add --no-cache bash coreutils
# explicit mode: it must not depend on the file modes of whatever checkout the build folder was assembled from
COPY --chmod=0755 shims/docker shims/shasum shims/mktemp /usr/local/bin/
COPY --chown=postgres:postgres scripts /scripts
COPY --chown=postgres:postgres migrations /migrations
COPY --chown=postgres:postgres baseline /baseline
RUN mkdir /baseline.dangling /tmp/work && chown postgres:postgres /baseline.dangling /tmp/work && ln -s /tmp/work /work
USER postgres
ENTRYPOINT []
CMD ["bash", "-c", "/scripts/baseline-load.sh /baseline \"$TARGET_URL\""]
