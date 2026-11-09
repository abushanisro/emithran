# One-off job: load the baseline into an EMPTY database, then exit. It runs backend/scripts/baseline-load.sh UNMODIFIED (the script's every
# database command goes through one `docker run <this same image>` call; the stand-in `docker` below runs the command in place), so the
# loader that CI and local development already exercise is the one that runs here. Built by seed-environment.sh into a temporary folder
# that holds the baseline (never committed: it carries reference data and the user directory).
FROM postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
RUN apk add --no-cache bash coreutils
COPY shims/docker shims/shasum /usr/local/bin/
COPY app /app
COPY baseline /baseline
ENTRYPOINT []
CMD ["bash", "-c", "/app/scripts/baseline-load.sh /baseline \"$TARGET_URL\""]
