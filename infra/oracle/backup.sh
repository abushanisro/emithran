#!/usr/bin/env bash
# Nightly database backup: pg_dump of the production database, gzipped, uploaded to the R2 bucket under backups/ (kept 14 days locally for a
# quick restore; R2 keeps what you configure there). Runs on the VM from /opt/emithran as the deploy user; reads the same env/prd.env the stack uses.
# Restore: gunzip -c <file> | docker compose ... exec -T postgres psql -U postgres -d postgres (into an EMPTY database).
set -Eeuo pipefail
trap 'echo "backup.sh failed at line $LINENO" >&2' ERR
cd /opt/emithran
set -a; . env/prd.env; set +a
dir=/opt/emithran/backups; mkdir -p "$dir"
file="$dir/emithran-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file env/prd.env exec -T postgres pg_dump -U postgres -d postgres | gzip -9 > "$file"
[ "$(stat -c %s "$file")" -gt 1024 ] || { echo "backup is suspiciously small: $file" >&2; exit 1; }
docker run --rm -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" -e AWS_DEFAULT_REGION=auto \
  -v "$dir:/b:ro" amazon/aws-cli --endpoint-url "$S3_ENDPOINT" s3 cp "/b/$(basename "$file")" "s3://$S3_BUCKET/backups/$(basename "$file")" --only-show-errors
find "$dir" -name 'emithran-*.sql.gz' -mtime +14 -delete
echo "backup ok: $(basename "$file") ($(stat -c %s "$file") bytes)"
