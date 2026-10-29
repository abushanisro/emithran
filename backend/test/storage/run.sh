#!/usr/bin/env bash
# Runs the real S3ObjectStore against a real S3-compatible server (SeaweedFS) in Docker. Needs Docker.
#   npm run test:s3        (from backend/)
set -euo pipefail
cd "$(dirname "$0")"
IMAGE="chrislusf/seaweedfs@sha256:c2658820e763294a9e9de7b36c81e59b879e3459148351aee4e31a126ca64860"
ID="s3-smoke-$$"
trap 'docker rm -f "$ID" >/dev/null 2>&1 || true' EXIT
# With identities configured the server VERIFIES every signature, so a wrong SigV4 (TypeScript or Rust) is rejected, not ignored.
docker run -d --rm --name "$ID" -p 127.0.0.1::8333 -v "$PWD/s3.json":/s3.json:ro "$IMAGE" server -s3 -s3.config=/s3.json -dir=/data >/dev/null
PORT=""
for _ in $(seq 1 60); do
  PORT="$(docker port "$ID" 8333/tcp 2>/dev/null | head -1 | sed 's/.*://')"
  [ -n "$PORT" ] && curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
  sleep 1
done
[ -n "$PORT" ] || { echo "S3 server did not start"; docker logs "$ID" | tail -20; exit 1; }
cd ../..
export S3_TEST_ENDPOINT="http://127.0.0.1:$PORT"
npx ts-node -r tsconfig-paths/register test/storage/smoke.ts
# The Rust runner's own S3 client against the same server (skipped when cargo is not installed).
if command -v cargo >/dev/null 2>&1; then (cd ../core && cargo test -p runner --test s3_live -- --nocapture); else echo "skip rust s3 client (no cargo)"; fi
