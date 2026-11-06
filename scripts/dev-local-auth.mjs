#!/usr/bin/env node
// Turns the local development sign-in bypass on or off in your own .env, so the app runs without Auth0 on this machine.
//   node scripts/dev-local-auth.mjs on <email-of-an-existing-account>   (the API then acts as that account)
//   node scripts/dev-local-auth.mjs off
//   node scripts/dev-local-auth.mjs status
// It touches only these three keys and prints nothing else from the file. Restart the backend and the frontend afterwards.
// Same on Windows and macOS (Node only). Refuses when the file says NODE_ENV=production: the bypass is never for a deployed environment.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
const KEYS = ['ALLOW_DEV_AUTH_BYPASS', 'ADMIN_FALLBACK_EMAIL', 'NEXT_PUBLIC_DEV_AUTH_BYPASS']

const [mode, email] = process.argv.slice(2)
if (!['on', 'off', 'status'].includes(mode ?? '')) {
  console.error('usage: node scripts/dev-local-auth.mjs on <email> | off | status')
  process.exit(2)
}
const text = existsSync(file) ? readFileSync(file, 'utf8') : ''
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const lines = text.split(/\r?\n/)
while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
const valueOf = (key) => {
  const found = lines.find((l) => l.startsWith(`${key}=`))
  return found === undefined ? undefined : found.slice(key.length + 1).trim()
}

if (mode === 'status') {
  for (const key of KEYS) console.log(`${key}=${valueOf(key) ?? '(not set)'}`)
  process.exit(0)
}
if (lines.some((l) => /^NODE_ENV=production\s*$/.test(l))) {
  console.error('Refusing: this .env sets NODE_ENV=production. The sign-in bypass is only for local development.')
  process.exit(1)
}
if (mode === 'on' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')) {
  console.error('Give the email of an existing account: node scripts/dev-local-auth.mjs on you@example.com')
  process.exit(2)
}

const wanted = mode === 'on'
  ? { ALLOW_DEV_AUTH_BYPASS: 'true', ADMIN_FALLBACK_EMAIL: email, NEXT_PUBLIC_DEV_AUTH_BYPASS: 'true' }
  : { ALLOW_DEV_AUTH_BYPASS: 'false', NEXT_PUBLIC_DEV_AUTH_BYPASS: 'false' }
for (const [key, value] of Object.entries(wanted)) {
  const i = lines.findIndex((l) => l.startsWith(`${key}=`))
  if (i >= 0) lines[i] = `${key}=${value}`
  else lines.push(`${key}=${value}`)
}
const out = lines.join(eol) + eol
writeFileSync(file, out)
for (const key of KEYS) console.log(`${key}=${valueOf(key) ?? '(not set)'}`)
console.log(mode === 'on' ? 'Bypass ON. Restart the backend and the frontend.' : 'Bypass OFF. Restart the backend and the frontend.')
