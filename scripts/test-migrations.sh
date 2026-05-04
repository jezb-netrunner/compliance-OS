#!/usr/bin/env bash
# scripts/test-migrations.sh
#
# Apply every supabase/migrations/*.sql file in order against a
# Postgres database, after seeding the minimal `auth` schema stubs.
# Used by CI; can also be run locally if you have psql + a running
# Postgres.
#
# Usage:
#   PG_URL=postgres://user:pass@host:5432/db ./scripts/test-migrations.sh
#
# Exits non-zero on the first migration that fails.

set -euo pipefail

: "${PG_URL:?PG_URL is required (e.g. postgres://postgres:postgres@localhost:5432/postgres)}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ seeding auth schema stubs"
psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$ROOT/scripts/auth_stubs.sql"

echo "→ applying migrations in order"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "  · $(basename "$f")"
  psql "$PG_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done

echo "→ basic schema sanity checks"
psql "$PG_URL" -v ON_ERROR_STOP=1 <<'SQL'
\set QUIET on
do $$
declare missing text[] := array[]::text[];
begin
  -- columns the application reads/writes that must exist
  if not exists (select 1 from information_schema.columns
                  where table_name = 'practitioners' and column_name = 'auth_id')
  then missing := missing || 'practitioners.auth_id'; end if;

  if not exists (select 1 from information_schema.columns
                  where table_name = 'clients' and column_name = 'needs_review')
  then missing := missing || 'clients.needs_review'; end if;

  if not exists (select 1 from information_schema.columns
                  where table_name = 'compliance_records' and column_name = 'payment_date')
  then missing := missing || 'compliance_records.payment_date'; end if;

  if not exists (select 1 from information_schema.columns
                  where table_name = 'compliance_records' and column_name = 'eafs_2307_submitted')
  then missing := missing || 'compliance_records.eafs_2307_submitted'; end if;

  if not exists (select 1 from information_schema.columns
                  where table_name = 'tax_status_changes' and column_name = 'change_type')
  then missing := missing || 'tax_status_changes.change_type'; end if;

  -- helper function
  if not exists (select 1 from pg_proc where proname = 'auth_practitioner_id')
  then missing := missing || 'auth_practitioner_id()'; end if;

  -- views from chunks 2 + 3
  if not exists (select 1 from information_schema.views
                  where table_name = 'compliance_records_status')
  then missing := missing || 'compliance_records_status (view)'; end if;

  if not exists (select 1 from information_schema.views
                  where table_name = 'tax_status_changes_with_snapshots')
  then missing := missing || 'tax_status_changes_with_snapshots (view)'; end if;

  -- chunk-3 audit table + trigger
  if not exists (select 1 from information_schema.tables
                  where table_name = 'clients_history')
  then missing := missing || 'clients_history (table)'; end if;

  if not exists (select 1 from pg_trigger where tgname = 'clients_history_capture')
  then missing := missing || 'clients_history_capture (trigger)'; end if;

  -- chunk-2 RPCs
  if not exists (select 1 from pg_proc where proname = 'roster_card_stats')
  then missing := missing || 'roster_card_stats() RPC'; end if;

  if not exists (select 1 from pg_proc where proname = 'roster_summary_totals')
  then missing := missing || 'roster_summary_totals() RPC'; end if;

  -- chunk-1 unique index against duplicate compliance rows
  if not exists (select 1 from pg_indexes
                  where indexname = 'compliance_records_client_obl_uq')
  then missing := missing || 'compliance_records_client_obl_uq (unique index)'; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'Schema sanity check failed; missing: %', missing;
  end if;
end $$;
SQL

echo "✓ migrations applied cleanly and schema sanity passes"
