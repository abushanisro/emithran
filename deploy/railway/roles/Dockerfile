# One-off job: give the `authenticator` role its password (see set-authenticator-password.sh). Same pinned image as the other jobs.
FROM postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
COPY set-authenticator-password.sh /set-authenticator-password.sh
USER postgres
ENTRYPOINT []
CMD ["sh", "/set-authenticator-password.sh"]
