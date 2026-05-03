-- 0010_roster_pagination.sql
--
-- HI-11: loadRoster() previously did `select * from clients` with no
-- limit and a follow-up `select … in (allClientIds)` from
-- compliance_records — fine at 50 clients, breaks at 10,000 (PostgREST
-- URL length, render time, summary-strip recompute on every keystroke).
--
-- This migration introduces:
--
--   • compliance_records_status: a SQL view that pre-computes the same
--     booleans recordStatus() returns in JS (is_overdue, is_urgent,
--     needs_trrc, payment_pending). One source of truth across SQL +
--     JS — when the rules change, both sides update together.
--
--   • roster_card_stats(p_query, p_offset, p_limit): a SECURITY
--     INVOKER RPC that returns one row per client with all the
--     summary counts pre-aggregated. The current practitioner is
--     resolved through the existing auth_practitioner_id() helper, so
--     no client ID is sent over the wire. Pagination + ILIKE search
--     happen in Postgres.
--
--   • roster_summary_totals(): a tiny RPC for the four summary-chip
--     totals across the entire (filtered) roster, so they don't
--     accumulate from a paginated subset.
--
-- The view re-derives the date math on every read; for very large
-- tenants (>100k records) wrap it in a materialized view and refresh
-- on a schedule.

-- ── compliance_records_status view ─────────────────────────────────
create or replace view compliance_records_status as
select
  cr.*,
  cr.filed_date is not null                                          as is_filed,
  cr.payment_status = 'paid'                                          as is_paid,
  (cr.filed_date is null
    and cr.due_date is not null
    and cr.due_date < current_date)                                   as is_overdue,
  (cr.filed_date is null
    and cr.due_date is not null
    and cr.due_date >= current_date
    and cr.due_date <= (current_date + interval '7 days'))            as is_urgent,
  (cr.filed_date is not null and not cr.trrc_saved)                   as needs_trrc,
  (cr.filed_date is not null
    and cr.has_tax_due
    and cr.payment_status not in ('paid', 'n/a'))                     as payment_pending,
  greatest(0, current_date - cr.due_date)                             as days_late
from compliance_records cr;

-- View inherits compliance_records' RLS automatically (Postgres applies
-- the underlying table's policies to view reads). Mark it security
-- invoker so future Postgres versions don't change semantics.
alter view compliance_records_status set (security_invoker = true);

grant select on compliance_records_status to authenticated;

-- ── roster_card_stats RPC ──────────────────────────────────────────
create or replace function roster_card_stats(
  p_query  text default '',
  p_filter text default 'all',     -- 'all' | 'overdue' | 'urgent' | 'trrc' | 'payment'
  p_offset int  default 0,
  p_limit  int  default 50
) returns table (
  id                 uuid,
  display_name       text,
  tin                text,
  rdo_code           text,
  taxpayer_type      text,
  vat_status         text,
  parent_client_id   uuid,
  branch_name        text,
  needs_review       boolean,
  total_records      int,
  overdue_count      int,
  urgent_count       int,
  trrc_count         int,
  payment_count      int
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with my as (select auth_practitioner_id() as pid)
  select
    c.id, c.display_name, c.tin, c.rdo_code, c.taxpayer_type, c.vat_status,
    c.parent_client_id, c.branch_name, c.needs_review,
    coalesce(s.total_records, 0)::int as total_records,
    coalesce(s.overdue_count, 0)::int as overdue_count,
    coalesce(s.urgent_count,  0)::int as urgent_count,
    coalesce(s.trrc_count,    0)::int as trrc_count,
    coalesce(s.payment_count, 0)::int as payment_count
  from clients c
  left join lateral (
    select
      count(*)                                       as total_records,
      count(*) filter (where is_overdue)             as overdue_count,
      count(*) filter (where is_urgent)              as urgent_count,
      count(*) filter (where needs_trrc)             as trrc_count,
      count(*) filter (where payment_pending)        as payment_count
    from compliance_records_status crs
    where crs.client_id = c.id
  ) s on true
  cross join my
  where c.practitioner_id = my.pid
    and c.is_active
    and (
      p_query = '' or
      c.display_name ilike '%' || p_query || '%' or
      c.tin           ilike '%' || p_query || '%' or
      c.branch_name   ilike '%' || p_query || '%'
    )
    and (
      p_filter = 'all'     or p_filter = 'active' or
      (p_filter = 'overdue' and coalesce(s.overdue_count, 0) > 0) or
      (p_filter = 'urgent'  and coalesce(s.urgent_count,  0) > 0) or
      (p_filter = 'trrc'    and coalesce(s.trrc_count,    0) > 0) or
      (p_filter = 'payment' and coalesce(s.payment_count, 0) > 0)
    )
  -- needs_review floats to top, then by name
  order by c.needs_review desc, c.display_name
  offset p_offset
  limit greatest(1, least(p_limit, 200));
$$;

grant execute on function roster_card_stats(text, text, int, int) to authenticated;

-- ── roster_summary_totals RPC ──────────────────────────────────────
-- Sums across the entire (active, owned) roster — independent of
-- pagination so the chips remain correct as the user pages.
create or replace function roster_summary_totals(
  p_query text default ''
) returns table (
  total_clients  int,
  overdue_count  int,
  urgent_count   int,
  trrc_count     int,
  payment_count  int
)
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with my as (select auth_practitioner_id() as pid),
  scoped_clients as (
    select c.id from clients c, my
    where c.practitioner_id = my.pid
      and c.is_active
      and (
        p_query = '' or
        c.display_name ilike '%' || p_query || '%' or
        c.tin           ilike '%' || p_query || '%' or
        c.branch_name   ilike '%' || p_query || '%'
      )
  )
  select
    (select count(*)::int from scoped_clients)                    as total_clients,
    count(*) filter (where crs.is_overdue)::int                   as overdue_count,
    count(*) filter (where crs.is_urgent)::int                    as urgent_count,
    count(*) filter (where crs.needs_trrc)::int                   as trrc_count,
    count(*) filter (where crs.payment_pending)::int              as payment_count
  from compliance_records_status crs
  where crs.client_id in (select id from scoped_clients);
$$;

grant execute on function roster_summary_totals(text) to authenticated;

-- ── indexes to support the predicates ──────────────────────────────
create index if not exists idx_compliance_filed_due
  on compliance_records (client_id, filed_date, due_date);

create index if not exists idx_clients_practitioner_active
  on clients (practitioner_id, is_active);
