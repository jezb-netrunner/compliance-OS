-- 0006_align_app_schema.sql
--
-- Aligns the persisted schema with the columns and constraints the
-- application actually reads and writes. Three things had drifted:
--
--   1. practitioners' user-link column is named user_id in 0001 but
--      auth_id in 0002's RLS policy and throughout the app code. This
--      migration renames to auth_id when only user_id exists, and
--      rewrites the practitioners RLS to match.
--
--   2. Several columns referenced by the app were never added by any
--      migration: clients.is_rbe / receives_2307 / notes / updated_at;
--      compliance_records.payment_date / payment_mode /
--      payment_reference / filing_reference / eafs_2307_submitted;
--      tax_status_changes.practitioner_id / change_type /
--      obligation_code (0002 declared them in a CREATE TABLE IF NOT
--      EXISTS that no-ops because 0001 already created the table).
--
--   3. compliance_records had no UNIQUE on (client_id, obligation_id),
--      so race-spam clicks of "Generate {YEAR} Obligations" produced
--      duplicate rows.
--
-- This migration is idempotent and safe to re-run against any baseline.

-- ── practitioners.user_id → auth_id (rename only when needed) ────────
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_name = 'practitioners' and column_name = 'user_id')
     and not exists (select 1 from information_schema.columns
              where table_name = 'practitioners' and column_name = 'auth_id') then
    alter table practitioners rename column user_id to auth_id;
  end if;
end $$;

-- Make sure the column exists (covers fresh DBs that came up under 0006-only)
alter table practitioners
  add column if not exists auth_id uuid references auth.users(id) on delete cascade;

create unique index if not exists practitioners_auth_id_uq on practitioners(auth_id);

-- Practitioners RLS — drop legacy names if present, recreate against auth_id
drop policy if exists "practitioners: own row" on practitioners;
create policy "practitioners: own row" on practitioners
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());

-- Other tables' RLS in 0001 join practitioners on user_id. After the
-- rename, those policies still parse but reference a column that no
-- longer exists. Drop and rebuild against auth_id.
drop policy if exists "clients: own practitioner" on clients;
create policy "clients: own practitioner" on clients
  using (
    practitioner_id in (
      select id from practitioners where auth_id = auth.uid()
    )
  )
  with check (
    practitioner_id in (
      select id from practitioners where auth_id = auth.uid()
    )
  );

drop policy if exists "compliance_records: own clients" on compliance_records;
create policy "compliance_records: own clients" on compliance_records
  using (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.auth_id = auth.uid()
    )
  )
  with check (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.auth_id = auth.uid()
    )
  );

drop policy if exists "enrollment_tokens: own practitioner" on enrollment_tokens;
create policy "enrollment_tokens: own practitioner" on enrollment_tokens
  using (
    practitioner_id in (
      select id from practitioners where auth_id = auth.uid()
    )
  )
  with check (
    practitioner_id in (
      select id from practitioners where auth_id = auth.uid()
    )
  );

-- ── practitioners: timestamps + display fields ──────────────────────
alter table practitioners
  add column if not exists updated_at timestamptz not null default now();

-- ── clients: missing app-tracked columns ────────────────────────────
-- needs_review = client was created via the public enrollment link and
-- has not yet been confirmed by the practitioner. The roster surfaces
-- these clients in a separate group; obligations are not seeded until
-- the practitioner reviews and clears the flag.
alter table clients
  add column if not exists is_rbe              boolean not null default false,
  add column if not exists receives_2307       boolean not null default false,
  add column if not exists needs_review        boolean not null default false,
  add column if not exists updated_at          timestamptz not null default now();

-- regime is a deprecated alias for vat_status (HI-7). Already nullable
-- in 0001, so no constraint change is needed; the column can be
-- dropped in a future migration once all readers are removed.

-- ── compliance_records: payment-flow + e-AFS columns ────────────────
alter table compliance_records
  add column if not exists payment_date         date,
  add column if not exists payment_mode         text,
  add column if not exists payment_reference    text,
  add column if not exists filing_reference     text,
  add column if not exists eafs_2307_submitted  boolean not null default false,
  add column if not exists updated_at           timestamptz not null default now();

-- Race-safe upsert key for seedComplianceRecords / generateYearObligations
create unique index if not exists compliance_records_client_obl_uq
  on compliance_records (client_id, obligation_id);

create index if not exists idx_compliance_filed
  on compliance_records (client_id, filed_date);

-- ── tax_status_changes: 0002 columns the app actually writes ────────
-- 0002's CREATE TABLE IF NOT EXISTS no-ops against the 0001 table; add
-- the missing columns explicitly here.
alter table tax_status_changes
  add column if not exists practitioner_id uuid references practitioners(id),
  add column if not exists change_type     text,
  add column if not exists obligation_code text,
  add column if not exists updated_at      timestamptz not null default now();

-- Set practitioner_id where it is recoverable (existing rows back-fill)
update tax_status_changes tsc
   set practitioner_id = c.practitioner_id
  from clients c
 where tsc.client_id = c.id
   and tsc.practitioner_id is null;

-- ── tax_status_changes: rebuild RLS against auth_id (was auth_id in
--    0002, against a column that didn't exist; now real)
drop policy if exists "tax_status_changes: own clients" on tax_status_changes;
create policy "tax_status_changes: own clients"
  on tax_status_changes for all
  using (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.auth_id = auth.uid()
    )
  )
  with check (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.auth_id = auth.uid()
    )
  );

-- Fast practitioner lookup helper used by RLS in 0007 and elsewhere.
create or replace function auth_practitioner_id() returns uuid
  language sql stable security definer
  set search_path = public, pg_temp
as $$
  select id from practitioners where auth_id = auth.uid()
$$;

revoke all on function auth_practitioner_id() from public;
grant execute on function auth_practitioner_id() to authenticated;

-- ── updated_at touch trigger (used by all three principal tables) ───
create or replace function _touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists practitioners_touch_updated_at on practitioners;
create trigger practitioners_touch_updated_at
  before update on practitioners
  for each row execute function _touch_updated_at();

drop trigger if exists clients_touch_updated_at on clients;
create trigger clients_touch_updated_at
  before update on clients
  for each row execute function _touch_updated_at();

drop trigger if exists compliance_records_touch_updated_at on compliance_records;
create trigger compliance_records_touch_updated_at
  before update on compliance_records
  for each row execute function _touch_updated_at();

drop trigger if exists tax_status_changes_touch_updated_at on tax_status_changes;
create trigger tax_status_changes_touch_updated_at
  before update on tax_status_changes
  for each row execute function _touch_updated_at();
