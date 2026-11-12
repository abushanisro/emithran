#!/usr/bin/env bash
# Auth0 sends its emails (password reset) through the company Google Workspace mailbox, with the EMITHRAN template (docs/ops/sso.md).
# Without this Auth0 uses its built-in test sender: no-reply@auth0user.net, Auth0's look, rate-limited, often filed as spam.
#
#   DRY_RUN=1 infra/auth0/setup-email.sh   shows what it would set
#   infra/auth0/setup-email.sh             asks for the Google app password of the sender (hidden), then applies; safe to rerun
#
# Needs: `auth0 login`, and a Google app password for the sender (myaccount.google.com/apppasswords, signed in as that mailbox).
set -Eeuo pipefail
trap 'echo "setup-email.sh failed at line $LINENO" >&2' ERR
cd "$(git rev-parse --show-toplevel)"
sender="${EMAIL_SENDER:-contact@emithran.com}"
tmp="$(mktemp -d)"; chmod 700 "$tmp"; trap 'rm -rf "$tmp"' EXIT
a0() { auth0 api "$@" --no-input; }
# Whether Auth0 returned an object with that field. "Not found" arrives as an empty answer (and a failing exit): that is a no.
has() { python3 -c "import json,sys; s=sys.stdin.read().strip(); d=json.loads(s) if s else {}; sys.exit(0 if isinstance(d, dict) and d.get('$1') else 1)"; }

echo "sender  : EMITHRAN <$sender> through smtp.gmail.com:587 (Google Workspace)"
echo "template: reset_email from infra/auth0/email/reset_email.html (subject: Reset your EMITHRAN password)"
if [ "${DRY_RUN:-0}" = 1 ]; then echo "DRY_RUN: nothing changed."; exit 0; fi
read -r -s -p "Google app password for $sender (hidden): " pass; echo
[ -n "$pass" ] || { echo "the app password is required" >&2; exit 2; }

echo "[1/2] email provider: Google Workspace SMTP"
SENDER="$sender" PASS="$pass" python3 -c "
import json,os
s=os.environ['SENDER']
print(json.dumps({'name':'smtp','enabled':True,'default_from_address':s,
  'credentials':{'smtp_host':'smtp.gmail.com','smtp_port':587,'smtp_user':s,'smtp_pass':os.environ['PASS'].replace(' ','')}}))" > "$tmp/provider.json"
if a0 get emails/provider 2>/dev/null | has name; then a0 patch emails/provider --data "@$tmp/provider.json" >/dev/null
else a0 post emails/provider --data "@$tmp/provider.json" >/dev/null; fi

echo "[2/2] reset_email template"
SENDER="$sender" python3 -c "
import json,os
print(json.dumps({'template':'reset_email','enabled':True,'syntax':'liquid','from':'EMITHRAN <%s>' % os.environ['SENDER'],
  'subject':'Reset your EMITHRAN password','urlLifetimeInSeconds':3600,'body':open('infra/auth0/email/reset_email.html').read()}))" > "$tmp/template.json"
if a0 get email-templates/reset_email 2>/dev/null | has template; then a0 patch email-templates/reset_email --data "@$tmp/template.json" >/dev/null
else a0 post email-templates --data "@$tmp/template.json" >/dev/null; fi
echo "done. Test: Auth0 sign-in page -> Forgot password."
