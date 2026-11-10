#!/usr/bin/env bash
# The production VM: Always Free Ampere A1 (4 OCPU, 24 GB), Ubuntu 24.04 Minimal aarch64, 150 GB boot volume, key-only login.
#
#   OCI_CLI_PROFILE=<p> OCI_CLI_AUTH=security_token COMPARTMENT_ID=<tenancy ocid> SUBNET_ID=<ocid> IMAGE_ID=<ocid> SSH_PUBLIC_KEY_FILE=<file.pub> infra/oracle/vm.sh
#
# 4 OCPU / 24 GB / 200 GB is the whole Always Free allowance, so it costs nothing and is not reclaimed when the trial ends (a quota in the tenancy
# refuses anything larger). IMDSv2 is required: the CAD engine opens untrusted files, and the metadata service must not be reachable by a
# server-side request. Free ARM capacity is often exhausted: "Out of host capacity" tries the next size of SIZES ("ocpu:gb" list, default
# 4:24 then 2:12; an A1 VM can be resized in place later) and, when none fits, waits and retries; "Too many requests" backs off. Up to TRIES rounds. Idempotent by name.
# Prints the public IP.
set -Eeuo pipefail
trap 'echo "vm.sh failed at line $LINENO" >&2' ERR
: "${COMPARTMENT_ID:?}" "${SUBNET_ID:?}" "${IMAGE_ID:?}" "${SSH_PUBLIC_KEY_FILE:?}"
export PYTHONWARNINGS=ignore
q() { oci "$@" 2>&1 | grep -v -E 'SyntaxWarning|INSTANCE_CONSOLE|Interactive mode'; }
name=emithran-prod
ad="$(q iam availability-domain list -c "$COMPARTMENT_ID" --query 'data[0].name' --raw-output)"

id="$(q compute instance list -c "$COMPARTMENT_ID" --display-name "$name" --query 'data[?"lifecycle-state"!=`TERMINATED`]|[0].id' --raw-output || true)"
case "$id" in ocid1.*) echo "instance exists: $id" >&2 ;; *)
  for try in $(seq 1 "${TRIES:-60}"); do
    for size in ${SIZES:-4:24 2:12}; do
      out="$(q compute instance launch -c "$COMPARTMENT_ID" --availability-domain "$ad" --display-name "$name" --shape VM.Standard.A1.Flex \
        --shape-config "{\"ocpus\":${size%%:*},\"memoryInGBs\":${size##*:}}" --subnet-id "$SUBNET_ID" --assign-public-ip true \
        --source-details "{\"sourceType\":\"image\",\"imageId\":\"$IMAGE_ID\",\"bootVolumeSizeInGBs\":150,\"bootVolumeVpusPerGB\":10}" \
        --ssh-authorized-keys-file "$SSH_PUBLIC_KEY_FILE" \
        --is-pv-encryption-in-transit-enabled true --instance-options '{"areLegacyImdsEndpointsDisabled":true}' --wait-for-state RUNNING \
        --query 'data.id' --raw-output || true)"
      case "$out" in ocid1.*) id="$out"; echo "launched with $size (OCPU:GB)" >&2; break 2 ;; esac
      if printf '%s' "$out" | grep -q -i -E 'capacity|too many requests'; then echo "size $size not available now (try $try)" >&2; sleep 20; else echo "$out" | head -12 >&2; exit 1; fi
    done
    sleep 90
  done
  case "$id" in ocid1.*) ;; *) echo "no capacity after ${TRIES:-60} tries" >&2; exit 1 ;; esac ;;
esac
q compute instance list-vnics --instance-id "$id" --query 'data[0]."public-ip"' --raw-output
