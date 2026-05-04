-- scripts/auth_stubs.sql
--
-- Minimal stubs for the Supabase `auth` schema used by RLS policies
-- and helper functions in supabase/migrations. Lets a vanilla
-- Postgres container (e.g. CI) apply the migrations cleanly without
-- spinning up the full Supabase stack.
--
-- These stubs are NEVER deployed to a real Supabase project — Supabase
-- already provides `auth` natively. The CI step that loads this file
-- runs only against the test Postgres container.

create schema if not exists auth;

-- Roles that Supabase normally creates. Migration policies don't grant
-- to these directly, but `grant ... to authenticated` shows up in
-- chunk-2's RPC migration and CREATE ROLE is required.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;

-- auth.users — only the columns referenced by FKs.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- auth.uid() — Supabase normally pulls this from the request's JWT.
-- In the CI test environment it just returns a session GUC, defaulting
-- to NULL so RLS policies behave like an unauthenticated request.
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.role() returns text
  language sql stable
as $$
  select coalesce(current_setting('request.jwt.claim.role', true), 'anon')
$$;

create or replace function auth.jwt() returns jsonb
  language sql stable
as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb, '{}'::jsonb)
$$;
