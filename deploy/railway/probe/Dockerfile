# One-off job: call each service of an environment from inside its private network (see probe.sh). Same pinned image as the other jobs.
FROM postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
RUN apk add --no-cache curl
COPY probe.sh /probe.sh
ENTRYPOINT []
CMD ["sh", "/probe.sh"]
