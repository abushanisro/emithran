#!/usr/bin/env bash
# Nightly database backup: pg_dump | gzip | age -> the private R2 bucket under backups/ (kept 14 days locally for a quick restore; the bucket's own
# lifecycle rule expires objects after 30 days). Runs from APP_DIR (default /opt/emithran, the VM's path; set APP_DIR for another copy of the stack)
# and reads the same env/prd.env the stack uses.
#
# The dump is encrypted BEFORE it leaves this machine with the age PUBLIC key BACKUP_AGE_RECIPIENT. The private key is never on the server: it lives
# with the operator (offline copy, password manager) and is needed only to restore. The script refuses to run without the recipient, so an
# unencrypted backup cannot be written by accident. After the upload the object's size in R2 is compared with the local file; when
# BACKUP_HEARTBEAT_URL is set (a free uptime-monitor heartbeat), it is called only after everything succeeded, so a missing call means a missing backup.
#
# Restore (into an EMPTY database, never over the live one; see ROLLBACK.md):
#   age -d -i <private-key-file> <file>.sql.gz.age | gunzip | docker exec -i <postgres container> psql -U postgres -d <new database>
set -Eeuo pipefail
trap 'echo "backup.sh failed at line $LINENO" >&2' ERR
APP_DIR="${APP_DIR:-/opt/emithran}"
cd "$APP_DIR"
set -a; . env/prd.env; set +a
: "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (the age PUBLIC key) in env/prd.env: backups are never written unencrypted}"
command -v age >/dev/null || { echo "age is not installed (apt-get install age)" >&2; exit 2; }
pg="${PG_CONTAINER:-$(docker compose -p emithran-prd -f docker-compose.prod.yml -f docker-compose.data.yml --env-file env/prd.env ps -q postgres)}"
[ -n "$pg" ] || { echo "no postgres container" >&2; exit 2; }
dir="$APP_DIR/backups"; mkdir -p "$dir"
name="emithran-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.age"
file="$dir/$name"
docker exec -i "$pg" pg_dump -U postgres -d postgres | gzip -9 | age -r "$BACKUP_AGE_RECIPIENT" > "$file"
local_size="$(wc -c < "$file" | tr -d ' ')"
[ "$local_size" -gt 1024 ] || { echo "backup is suspiciously small: $file ($local_size bytes)" >&2; rm -f "$file"; exit 1; }
aws_() { docker run --rm -e AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" -e AWS_DEFAULT_REGION=auto "$@"; }
aws_ -v "$dir:/b:ro" amazon/aws-cli --endpoint-url "$S3_ENDPOINT" s3 cp "/b/$name" "s3://$S3_BUCKET/backups/$name" --only-show-errors
remote_size="$(aws_ amazon/aws-cli --endpoint-url "$S3_ENDPOINT" s3api head-object --bucket "$S3_BUCKET" --key "backups/$name" --query ContentLength --output text)"
[ "$remote_size" = "$local_size" ] || { echo "uploaded size $remote_size differs from local $local_size: $name" >&2; exit 1; }
find "$dir" -name 'emithran-*.sql.gz.age' -mtime +14 -delete
[ -z "${BACKUP_HEARTBEAT_URL:-}" ] || curl -fsS -m 15 "$BACKUP_HEARTBEAT_URL" >/dev/null
echo "backup ok: $name ($local_size bytes, encrypted, verified in R2)"
