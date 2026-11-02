# Disable AI globally

Use when AI spend runs away, a provider key may be abused, or an AI feature misbehaves (for example a prompt-injection finding) and
must stop now for every organization.

## The switch: AI_DISABLED

`AI_DISABLED=true` is the global kill switch of the AI budget work (design section 7.2, decision D6). **It is added by the AI-budget
workstream, not by the change that added this runbook:** check that the running version has it (`grep -rn AI_DISABLED backend/src
lib/server` on the deployed commit) before relying on it. When set, every AI route refuses before calling the provider.

1. Backend: add `AI_DISABLED=true` to `env/<env>.env` and recreate the backend:
   `docker compose -p emithran-<env> -f docker-compose.prod.yml --env-file env/<env>.env up -d --force-recreate backend`.
2. Web app (its own Claude calls go through `lib/server/anthropic.ts`): set `AI_DISABLED=true` in the Vercel project for the
   environment and redeploy (Vercel reads server environment variables at deploy).
3. Verify: an AI action (Copilot message, VAVE analysis) answers with the "AI is disabled" error, and the provider's usage page
   stops growing.
4. To re-enable, remove the variable (or set `false`) and repeat steps 1 and 2.

## If the switch is not deployed yet, or does not hold

Revoke the provider key: Anthropic Console → API keys → disable the key in use. Every AI call then fails at the provider within
seconds, wherever it comes from. Create a new key only when it is safe to resume ([rotate-secrets.md](rotate-secrets.md#provider-api-keys)).
Also set a monthly spend limit in the Anthropic Console so a runaway is bounded even when nobody is watching.

Record what was disabled, when and why in the incident timeline.
