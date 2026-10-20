#!/usr/bin/env node
'use strict';

/**
 * Creates (once, idempotently) the second e2e account in a DIFFERENT organization, for the
 * cross-organization RLS tests: one Supabase auth user, one organization it owns, one active
 * owner membership. Writes E2E_EMAIL_B / E2E_PASSWORD_B to the gitignored ../.env.local.
 *
 * This is a live write to the Supabase project in backend/.env. Run from backend/:
 *   node scripts/create-e2e-org-b.js
 */

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { parseEnv } = require('util');
const { createClient } = require('@supabase/supabase-js');

const EMAIL_B = 'e2e-org-b@emithran.com';
const ORG_NAME = 'E2E Org B';

const backendEnv = parseEnv(fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf8'));
const localEnvPath = path.resolve(__dirname, '../../.env.local');
const localEnv = parseEnv(fs.readFileSync(localEnvPath, 'utf8'));

const admin = createClient(backendEnv.SUPABASE_URL, backendEnv.SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function canSignIn(email, password) {
  const anon = createClient(backendEnv.SUPABASE_URL, backendEnv.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await anon.auth.signInWithPassword({ email, password });
  return !error;
}

async function main() {
  let password = localEnv.E2E_PASSWORD_B;
  let user = await findUserByEmail(EMAIL_B);

  if (!user) {
    password = randomBytes(18).toString('base64url');
    const { data, error } = await admin.auth.admin.createUser({ email: EMAIL_B, password, email_confirm: true });
    if (error) throw new Error(`createUser failed: ${error.message}`);
    user = data.user;
    console.log(`created auth user ${EMAIL_B}`);
  } else if (!password || !(await canSignIn(EMAIL_B, password))) {
    password = randomBytes(18).toString('base64url');
    const { error } = await admin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
    if (error) throw new Error(`updateUser failed: ${error.message}`);
    console.log(`reset password for existing ${EMAIL_B}`);
  }

  // A signup trigger may already have given the user an organization; use that if so.
  const { data: memberships, error: memberError } = await admin
    .from('organization_members')
    .select('organization_id, role, status')
    .eq('user_id', user.id);
  if (memberError) throw new Error(`organization_members read failed: ${memberError.message}`);

  let organizationId = memberships.find((m) => m.status === 'active')?.organization_id;
  if (!organizationId) {
    const { data: existing } = await admin.from('organizations').select('id').eq('owner_id', user.id).eq('name', ORG_NAME).maybeSingle();
    organizationId = existing?.id;
    if (!organizationId) {
      const { data: org, error } = await admin.from('organizations').insert({ name: ORG_NAME, owner_id: user.id }).select('id').single();
      if (error) throw new Error(`organizations insert failed: ${error.message}`);
      organizationId = org.id;
      console.log(`created organization ${ORG_NAME}`);
    }
    const { error } = await admin
      .from('organization_members')
      .upsert({ organization_id: organizationId, user_id: user.id, role: 'owner', status: 'active' }, { onConflict: 'organization_id,user_id' });
    if (error) throw new Error(`organization_members upsert failed: ${error.message}`);
  }

  // Never share an organization with account A: that would make the isolation tests vacuous.
  const { data: aMembers } = await admin
    .from('organization_members')
    .select('organization_id, user_id')
    .eq('organization_id', organizationId);
  if (aMembers.some((m) => m.user_id !== user.id)) {
    throw new Error(`organization ${organizationId} has other members; account B must be alone in its organization`);
  }

  const lines = [];
  if (localEnv.E2E_EMAIL_B !== EMAIL_B) lines.push(`E2E_EMAIL_B=${EMAIL_B}`);
  if (localEnv.E2E_PASSWORD_B !== password) lines.push(`E2E_PASSWORD_B=${password}`);
  if (lines.length > 0) {
    let text = fs.readFileSync(localEnvPath, 'utf8').split(/\r?\n/).filter((l) => !/^E2E_(EMAIL|PASSWORD)_B=/.test(l)).join('\n');
    if (!text.endsWith('\n')) text += '\n';
    fs.writeFileSync(localEnvPath, `${text}E2E_EMAIL_B=${EMAIL_B}\nE2E_PASSWORD_B=${password}\n`);
    console.log('wrote E2E_EMAIL_B / E2E_PASSWORD_B to .env.local');
  }
  console.log(`account B ready: user ${user.id}, organization ${organizationId}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
