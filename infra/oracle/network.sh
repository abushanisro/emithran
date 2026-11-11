#!/usr/bin/env bash
# The production network on Oracle Cloud, Always Free: one VCN, one public subnet, an internet gateway, SSH as the only inbound port.
#
#   OCI_CLI_PROFILE=<profile> OCI_CLI_AUTH=security_token infra/oracle/network.sh
#
# Why only SSH inbound: the Cloudflare tunnel connects OUT from the VM, so the website needs no open port. Why a public subnet at all: so the VM
# has an address to deploy to over SSH. Idempotent: an existing VCN with the same name is reused, nothing is created twice. Prints the subnet id.
set -Eeuo pipefail
trap 'echo "network.sh failed at line $LINENO" >&2' ERR
: "${COMPARTMENT_ID:?set COMPARTMENT_ID (the tenancy OCID for the root compartment)}"
export PYTHONWARNINGS=ignore
q() { oci "$@" 2>&1 | grep -v -E 'SyntaxWarning|INSTANCE_CONSOLE|Interactive mode'; }

vcn="$(q network vcn list -c "$COMPARTMENT_ID" --display-name emithran-vcn --lifecycle-state AVAILABLE --query 'data[0].id' --raw-output || true)"
case "$vcn" in ocid1.*) echo "vcn exists: $vcn" >&2 ;; *)
  vcn="$(q network vcn create -c "$COMPARTMENT_ID" --cidr-block 10.0.0.0/16 --display-name emithran-vcn --dns-label emithran --wait-for-state AVAILABLE --query 'data.id' --raw-output)" ;;
esac
rt="$(q network vcn get --vcn-id "$vcn" --query 'data."default-route-table-id"' --raw-output)"
sl="$(q network vcn get --vcn-id "$vcn" --query 'data."default-security-list-id"' --raw-output)"

igw="$(q network internet-gateway list -c "$COMPARTMENT_ID" --vcn-id "$vcn" --query 'data[0].id' --raw-output || true)"
case "$igw" in ocid1.*) ;; *)
  igw="$(q network internet-gateway create -c "$COMPARTMENT_ID" --vcn-id "$vcn" --is-enabled true --display-name emithran-igw --wait-for-state AVAILABLE --query 'data.id' --raw-output)" ;;
esac
q network route-table update --rt-id "$rt" --route-rules "[{\"destination\":\"0.0.0.0/0\",\"destinationType\":\"CIDR_BLOCK\",\"networkEntityId\":\"$igw\"}]" --force >/dev/null

# SSH in (key login only, enforced on the host); path-MTU discovery; everything out.
q network security-list update --security-list-id "$sl" --force \
  --ingress-security-rules '[{"protocol":"6","source":"0.0.0.0/0","isStateless":false,"tcpOptions":{"destinationPortRange":{"min":22,"max":22}}},{"protocol":"1","source":"0.0.0.0/0","isStateless":false,"icmpOptions":{"type":3,"code":4}}]' \
  --egress-security-rules '[{"protocol":"all","destination":"0.0.0.0/0","isStateless":false}]' >/dev/null

subnet="$(q network subnet list -c "$COMPARTMENT_ID" --vcn-id "$vcn" --display-name emithran-public-subnet --query 'data[0].id' --raw-output || true)"
case "$subnet" in ocid1.*) ;; *)
  subnet="$(q network subnet create -c "$COMPARTMENT_ID" --vcn-id "$vcn" --cidr-block 10.0.0.0/24 --display-name emithran-public-subnet --dns-label pub \
    --prohibit-public-ip-on-vnic false --route-table-id "$rt" --security-list-ids "[\"$sl\"]" --wait-for-state AVAILABLE --query 'data.id' --raw-output)" ;;
esac
echo "$subnet"
