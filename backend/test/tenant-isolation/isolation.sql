-- Tenant isolation against the REAL schema and policies (the baseline plus every migration), not stubs.
-- Two organizations, each with an owner, a project, a BOM, an item, an upload, an RFQ and results. Then Bob (organization B) attacks Alice's (organization A)
-- rows through the same two doors a customer has: the tables (PostgREST runs as the `authenticated` role with the caller's id in the JWT claims) and the
-- security-definer functions. Every attack must read nothing, change nothing and create nothing; every positive check proves Alice can still do her own work, so a
-- broken seed cannot pass the attacks vacuously. Everything runs in ONE transaction that is rolled back: no data is left behind.
--
--   backend/test/tenant-isolation/run.sh        (builds a throwaway database like production, runs this, removes it)
\set ON_ERROR_STOP on
begin;
create schema iso;
create table iso.results (n serial, name text, ok boolean, detail text);

-- ---- who is calling: the same settings PostgREST applies for a signed-in user
create function iso.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function iso.as_admin() returns void language plpgsql as $$
begin perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true); end $$;
grant usage on schema iso to authenticated;

create function iso.record(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql security definer as $$
begin
  insert into iso.results (name, ok, detail) values (p_name, p_ok, p_detail);   -- runs as the owner (security definer): no role switch needed
end $$;

grant execute on function iso.as_admin(), iso.record(text, boolean, text) to authenticated;

-- ---- seed (as the database owner, which bypasses RLS)
\set alice '''11111111-1111-4111-8111-111111111111'''
\set bob   '''22222222-2222-4222-8222-222222222222'''
insert into auth.users (id, email) values (:alice, 'alice@org-a.test'), (:bob, 'bob@org-b.test') on conflict (id) do nothing;
insert into public.authorized_users (email) values ('alice@org-a.test'), ('bob@org-b.test');
insert into public.organizations (id, name, owner_id) values ('aaaaaaaa-0000-4000-8000-000000000001', 'Org A', :alice), ('bbbbbbbb-0000-4000-8000-000000000002', 'Org B', :bob);
insert into public.organization_members (id, organization_id, user_id, role, status) values
  ('a1000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', :alice, 'owner', 'active'),
  ('b1000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002', :bob,   'owner', 'active');
insert into public.projects (id, name, user_id, organization_id) values
  ('a2000000-0000-4000-8000-000000000001', 'A project', :alice, 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', 'B project', :bob,   'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.boms (id, name, project_id, user_id, organization_id) values
  ('a3000000-0000-4000-8000-000000000001', 'A bom', 'a2000000-0000-4000-8000-000000000001', :alice, 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('b3000000-0000-4000-8000-000000000002', 'B bom', 'b2000000-0000-4000-8000-000000000002', :bob,   'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.bom_items (id, bom_id, name, item_type, user_id, organization_id) values
  ('a4000000-0000-4000-8000-0000000000a2', 'a3000000-0000-4000-8000-000000000001', 'A part 2', 'child_part', :alice, 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'A part', 'child_part', :alice, 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('b4000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002', 'B part', 'child_part', :bob,   'bbbbbbbb-0000-4000-8000-000000000002');
insert into public.cad_uploads (id, organization_id, created_by, bom_id, file_name, sha256, size_bytes, storage_path) values
  ('a5000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', :alice, 'a3000000-0000-4000-8000-000000000001', 'a.step', repeat('a', 64), 10, 'org-a/a.step');
insert into public.rfq_records (id, user_id, rfq_name, rfq_number, bom_item_ids, vendor_ids) values
  ('a6000000-0000-4000-8000-000000000001', :alice, 'A rfq', 'RFQ-A', array['a4000000-0000-4000-8000-000000000001']::uuid[], '{}'::uuid[]);
insert into public.rfq_email_logs (id, rfq_id, status) values ('a7000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001', 'sent');
insert into public.machining_rule_results (id, bom_item_id, operation) values ('a8000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'turning');
insert into public.process_planning_specifications (id, bom_item_id, project_id, created_by) values
  ('a9000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-0000000000a2', 'a2000000-0000-4000-8000-000000000001', :alice);

-- ---- assertions
-- read: the caller must see exactly `want` rows of the query
create function iso.sees(p_name text, p_user uuid, p_query text, p_want bigint) returns void language plpgsql as $$
declare n bigint;
begin
  perform iso.as_user(p_user);
  begin execute 'select count(*) from (' || p_query || ') s' into n; exception when others then n := -1; end;
  perform iso.record(p_name, n = p_want, 'saw ' || n || ', wanted ' || p_want);
  perform iso.as_admin();
end $$;
-- write: a statement run as the caller must change NOTHING (0 rows, or refused by a policy/privilege)
create function iso.cannot(p_name text, p_user uuid, p_stmt text, p_check text, p_strict boolean default true) returns void language plpgsql as $$
declare affected bigint := 0; still bigint;
begin
  perform iso.as_user(p_user);
  begin execute p_stmt; get diagnostics affected = row_count; exception when others then affected := 0; end;
  perform iso.as_admin();
  execute p_check into still;     -- p_check returns the number of rows in the "tampered" state: must be 0
  perform iso.record(p_name, (affected = 0 or not p_strict) and still = 0, 'changed ' || affected || ' row(s), tampered rows left: ' || still);
end $$;
-- positive: the statement must succeed for its legitimate owner
create function iso.can(p_name text, p_user uuid, p_stmt text) returns void language plpgsql as $$
declare affected bigint := 0; err text := '';
begin
  perform iso.as_user(p_user);
  begin execute p_stmt; get diagnostics affected = row_count; exception when others then err := sqlstate || ' ' || sqlerrm; end;
  perform iso.record(p_name, err = '' and affected >= 1, coalesce(nullif(err, ''), 'changed ' || affected || ' row(s)'));
  perform iso.as_admin();
end $$;

do $$
declare
  alice constant uuid := '11111111-1111-4111-8111-111111111111'; bob constant uuid := '22222222-2222-4222-8222-222222222222';
  orgA constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; itemA constant uuid := 'a4000000-0000-4000-8000-000000000001';
  bomA constant uuid := 'a3000000-0000-4000-8000-000000000001'; projA constant uuid := 'a2000000-0000-4000-8000-000000000001';
  rfqA constant uuid := 'a6000000-0000-4000-8000-000000000001';
  t text; n int;
begin
  -- POSITIVE: Alice sees her own rows (so the attacks below cannot pass because the seed was empty)
  foreach t in array array['projects','boms','bom_items','cad_uploads','organizations','organization_members','rfq_records','rfq_email_logs','machining_rule_results','process_planning_specifications'] loop
    perform iso.sees('Alice sees her own rows in ' || t, alice, format('select 1 from public.%I where id::text like %L', t, '%0000-4000-8000-000000000001'), 1);
  end loop;

  -- READ: Bob must see none of organization A's rows, and he must still see his own organization
  foreach t in array array['projects','boms','bom_items','cad_uploads','organization_members','rfq_records','rfq_email_logs','machining_rule_results','process_planning_specifications'] loop
    perform iso.sees('Bob cannot read org A rows in ' || t, bob, format('select 1 from public.%I where id::text like %L', t, 'a%'), 0);
  end loop;
  perform iso.sees('Bob cannot read org A in organizations', bob, 'select 1 from public.organizations where id = ''aaaaaaaa-0000-4000-8000-000000000001''', 0);
  perform iso.sees('Bob still sees his own project', bob, 'select 1 from public.projects where id = ''b2000000-0000-4000-8000-000000000002''', 1);
  -- tampered filters: swapping the organization id in the query must not widen what is visible
  perform iso.sees('Bob filtering by organization_id = A sees nothing (bom_items)', bob, 'select 1 from public.bom_items where organization_id = ''aaaaaaaa-0000-4000-8000-000000000001''', 0);
  perform iso.sees('Bob with OR-widened filter sees only his own item', bob, 'select 1 from public.bom_items where organization_id = ''aaaaaaaa-0000-4000-8000-000000000001'' or true', 1);

  -- WRITE on rows Bob can see or not: UPDATE / DELETE of org A rows
  perform iso.cannot('Bob cannot UPDATE org A project', bob, 'update public.projects set name = ''pwned'' where id = ''a2000000-0000-4000-8000-000000000001''', 'select count(*) from public.projects where name = ''pwned''');
  perform iso.cannot('Bob cannot UPDATE org A bom', bob, 'update public.boms set name = ''pwned''', 'select count(*) from public.boms where name = ''pwned'' and organization_id = ''aaaaaaaa-0000-4000-8000-000000000001''', false);
  perform iso.cannot('Bob cannot UPDATE org A bom_items (unfiltered)', bob, 'update public.bom_items set name = ''pwned''', 'select count(*) from public.bom_items where name = ''pwned'' and organization_id = ''aaaaaaaa-0000-4000-8000-000000000001''', false);
  perform iso.cannot('Bob cannot DELETE org A project', bob, 'delete from public.projects where id = ''a2000000-0000-4000-8000-000000000001''', 'select (select count(*) = 0 from public.projects where id = ''a2000000-0000-4000-8000-000000000001'')::int');
  perform iso.cannot('Bob cannot DELETE org A bom_items', bob, 'delete from public.bom_items', 'select (select count(*) = 0 from public.bom_items where id = ''a4000000-0000-4000-8000-000000000001'')::int', false);
  perform iso.cannot('Bob cannot DELETE org A upload', bob, 'delete from public.cad_uploads', 'select (select count(*) = 0 from public.cad_uploads)::int');
  perform iso.cannot('Bob cannot UPDATE org A rfq_email_logs (unfiltered)', bob, 'update public.rfq_email_logs set status = ''bounced''', 'select count(*) from public.rfq_email_logs where status = ''bounced''');
  perform iso.cannot('Bob cannot UPDATE org A process_planning_specifications', bob, 'update public.process_planning_specifications set special_instructions = ''pwned''', 'select count(*) from public.process_planning_specifications where special_instructions = ''pwned''');

  -- INSERT tampering: creating rows that point INTO organization A
  perform iso.cannot('Bob cannot add an item to org A bom', bob, format('insert into public.bom_items (bom_id, name, item_type, user_id, organization_id) values (%L, ''x'', ''child_part'', %L, %L)', bomA, bob, orgA), 'select count(*) from public.bom_items where name = ''x''');
  perform iso.cannot('Bob cannot add an item to HIS org but under A''s bom', bob, format('insert into public.bom_items (bom_id, name, item_type, user_id, organization_id) values (%L, ''x2'', ''child_part'', %L, ''bbbbbbbb-0000-4000-8000-000000000002'')', bomA, bob), 'select count(*) from public.bom_items where name = ''x2''');
  perform iso.cannot('Bob cannot create a project inside org A', bob, format('insert into public.projects (name, user_id, organization_id) values (''x'', %L, %L)', bob, orgA), 'select count(*) from public.projects where name = ''x'' and organization_id = ''aaaaaaaa-0000-4000-8000-000000000001''');
  perform iso.cannot('Bob cannot create a BOM inside org A', bob, format('insert into public.boms (name, project_id, user_id, organization_id) values (''xb'', %L, %L, %L)', projA, bob, orgA), 'select count(*) from public.boms where name = ''xb''');
  perform iso.cannot('Bob cannot hang a BOM of his own under org A project', bob, format('insert into public.boms (name, project_id, user_id, organization_id) values (''xb2'', %L, %L, ''bbbbbbbb-0000-4000-8000-000000000002'')', projA, bob), 'select count(*) from public.boms where name = ''xb2''');
  perform iso.cannot('Bob cannot move his own project into org A', bob, format('update public.projects set organization_id = %L where id = ''b2000000-0000-4000-8000-000000000002''', orgA), 'select count(*) from public.projects where id = ''b2000000-0000-4000-8000-000000000002'' and organization_id = ''aaaaaaaa-0000-4000-8000-000000000001''');
  perform iso.cannot('Bob cannot move his own BOM under org A project', bob, format('update public.boms set project_id = %L where id = ''b3000000-0000-4000-8000-000000000002''', projA), 'select count(*) from public.boms where id = ''b3000000-0000-4000-8000-000000000002'' and project_id = ''a2000000-0000-4000-8000-000000000001''');
  perform iso.cannot('Bob cannot inject a machining result into org A item', bob, format('insert into public.machining_rule_results (bom_item_id, operation) values (%L, ''injected'')', itemA), 'select count(*) from public.machining_rule_results where operation = ''injected''');
  perform iso.cannot('Bob cannot inject a process-plan spec into org A item (owner NULL)', bob, format('insert into public.process_planning_specifications (bom_item_id, project_id, special_instructions) values (%L, %L, ''injected'')', itemA, projA), 'select count(*) from public.process_planning_specifications where special_instructions = ''injected''');
  perform iso.cannot('Bob cannot inject a process-plan spec as Alice', bob, format('insert into public.process_planning_specifications (bom_item_id, project_id, created_by, special_instructions) values (%L, %L, %L, ''injected2'')', itemA, projA, alice), 'select count(*) from public.process_planning_specifications where special_instructions = ''injected2''');
  perform iso.cannot('Bob cannot add an email log to org A rfq', bob, format('insert into public.rfq_email_logs (rfq_id, status) values (%L, ''clicked'')', rfqA), 'select count(*) from public.rfq_email_logs where status = ''clicked''');

  -- SECURITY-DEFINER FUNCTIONS: the same attacks through the functions
  perform iso.cannot('Bob cannot delete an org A item through delete_bom_item_cascade', bob, format('select public.delete_bom_item_cascade(%L)', itemA), format('select (select count(*) = 0 from public.bom_items where id = %L)::int', itemA));
  perform iso.cannot('Bob cannot remove Alice from org A', bob, 'select public.remove_organization_member(''aaaaaaaa-0000-4000-8000-000000000001'', ''a1000000-0000-4000-8000-000000000001'')', 'select (select count(*) = 0 from public.organization_members where id = ''a1000000-0000-4000-8000-000000000001'')::int');
  perform iso.cannot('Bob cannot invite someone into org A', bob, 'select public.invite_organization_member(''aaaaaaaa-0000-4000-8000-000000000001'', ''mallory@example.test'', ''member'')', 'select count(*) from public.organization_members m join auth.users u on u.id = m.user_id where u.email = ''mallory@example.test'' union all select count(*) from public.authorized_users where email = ''mallory@example.test'' limit 1');
  perform iso.cannot('Bob cannot make himself a member of org A', bob, 'select public.add_organization_owner_membership(''aaaaaaaa-0000-4000-8000-000000000001'')', 'select count(*) from public.organization_members where organization_id = ''aaaaaaaa-0000-4000-8000-000000000001'' and user_id = ''22222222-2222-4222-8222-222222222222''');
  perform iso.cannot('Bob cannot record AI usage against org A', bob, 'select public.ai_usage_record(''aaaaaaaa-0000-4000-8000-000000000001'', 1000, 1000)', 'select count(*) from public.ai_usage_daily where organization_id = ''aaaaaaaa-0000-4000-8000-000000000001''');

  -- POSITIVE after the attacks: Alice can still do her own work (a fix must not break the product)
  perform iso.can('Alice can create a project in her own org', alice, format('insert into public.projects (name, user_id, organization_id) values (''A2'', %L, %L)', alice, orgA));
  perform iso.can('Alice can create a project with no organization (legacy owner rows)', alice, format('insert into public.projects (name, user_id) values (''A3'', %L)', alice));
  perform iso.can('Alice can create a BOM in her own project', alice, format('insert into public.boms (name, project_id, user_id, organization_id) values (''A2 bom'', %L, %L, %L)', projA, alice, orgA));
  perform iso.can('Alice can update her own project', alice, 'update public.projects set name = ''A project v2'' where id = ''a2000000-0000-4000-8000-000000000001''');
  perform iso.can('Alice can log an email for her own rfq', alice, format('insert into public.rfq_email_logs (rfq_id, status) values (%L, ''opened'')', rfqA));
  perform iso.can('Alice can update her own email logs', alice, 'update public.rfq_email_logs set status = ''failed'' where rfq_id = ''a6000000-0000-4000-8000-000000000001''');
  perform iso.can('Alice can store a machining result for her own item', alice, format('insert into public.machining_rule_results (bom_item_id, operation) values (%L, ''milling'')', itemA));
  perform iso.can('Alice can store a process-plan spec for her own item', alice, format('insert into public.process_planning_specifications (bom_item_id, project_id, created_by, tolerance_grade) values (%L, %L, %L, ''IT7'')', itemA, projA, alice));
  perform iso.can('Alice can update her own process-plan spec', alice, 'update public.process_planning_specifications set tolerance_grade = ''IT6'' where bom_item_id = ''a4000000-0000-4000-8000-0000000000a2''');
end $$;

select set_config('role', 'postgres', true);
select format('%-3s %-4s %s%s', n, case when ok then 'ok' else 'FAIL' end, name, case when ok then '' else '   -> ' || detail end) as result from iso.results order by n;
select format('%s checks, %s failed', count(*), count(*) filter (where not ok)) as summary from iso.results;
do $$ begin if exists (select 1 from iso.results where not ok) then raise exception 'TENANT ISOLATION FAILED: % check(s)', (select count(*) from iso.results where not ok); end if; end $$;
rollback;
