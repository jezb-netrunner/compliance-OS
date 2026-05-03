-- 0011_clients_history_audit.sql
--
-- ME-1: tax_status_changes.old_profile / new_profile are JSONB blobs.
-- They render fine on the timeline but you cannot query "every client
-- that switched VAT → 8% in 2025" without parsing the blob — and a new
-- column added to `clients` is silently absent from old snapshots.
--
-- This migration adds a row-versioned audit log for `clients`,
-- maintained by trigger. Every UPDATE writes a fresh snapshot keyed by
-- (client_id, version, changed_at). The JSONB blobs in
-- tax_status_changes remain (human-readable, what we told the user
-- changed); structured queries route through clients_history.
--
-- A view `tax_status_changes_with_snapshots` joins tax_status_changes
-- to the clients_history rows immediately before and after each
-- effective_date, so practitioners (and reports) get structured
-- access to "what was the VAT status before this change?" without
-- reaching into JSONB.

create table if not exists clients_history (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients(id) on delete cascade,
  version         int  not null,
  changed_at      timestamptz not null default now(),
  changed_by      uuid references auth.users(id),

  -- Mirror of the columns we actually want structured access to. New
  -- profile-relevant columns added to `clients` should also be added
  -- here in a follow-up migration. (The trigger below explicitly
  -- enumerates fields, so silent drift is impossible.)
  practitioner_id       uuid,
  display_name          text,
  tin                   text,
  rdo_code              text,
  industry              text,
  taxpayer_type         text,
  vat_status            text,
  regime                text,
  tax_classification    text,
  deduction_method      text,
  fiscal_start_month    int,
  has_employees         boolean,
  withholds_expanded    boolean,
  withholds_final       boolean,
  owner_pays_sss        boolean,
  owner_pays_philhealth boolean,
  owner_pays_pagibig    boolean,
  is_rbe                boolean,
  receives_2307         boolean,
  requires_audited_fs   boolean,
  has_related_party_txn boolean,
  parent_client_id      uuid,
  branch_name           text,
  is_active             boolean,
  needs_review          boolean
);

create unique index if not exists clients_history_version_uq
  on clients_history (client_id, version);

create index if not exists idx_clients_history_client_changed
  on clients_history (client_id, changed_at desc);

alter table clients_history enable row level security;

create policy "clients_history: own clients" on clients_history for select
  using (
    client_id in (
      select id from clients where practitioner_id = auth_practitioner_id()
    )
  );

-- ── Trigger: capture every clients INSERT/UPDATE ────────────────────
create or replace function _capture_clients_history() returns trigger
  language plpgsql security definer
  set search_path = public, pg_temp
as $$
declare
  next_version int;
begin
  select coalesce(max(version), 0) + 1
    into next_version
    from clients_history
   where client_id = new.id;

  insert into clients_history (
    client_id, version, changed_by,
    practitioner_id, display_name, tin, rdo_code, industry,
    taxpayer_type, vat_status, regime, tax_classification,
    deduction_method, fiscal_start_month, has_employees,
    withholds_expanded, withholds_final,
    owner_pays_sss, owner_pays_philhealth, owner_pays_pagibig,
    is_rbe, receives_2307, requires_audited_fs, has_related_party_txn,
    parent_client_id, branch_name, is_active, needs_review
  ) values (
    new.id, next_version, auth.uid(),
    new.practitioner_id, new.display_name, new.tin, new.rdo_code, new.industry,
    new.taxpayer_type, new.vat_status, new.regime, new.tax_classification,
    new.deduction_method, new.fiscal_start_month, new.has_employees,
    new.withholds_expanded, new.withholds_final,
    new.owner_pays_sss, new.owner_pays_philhealth, new.owner_pays_pagibig,
    new.is_rbe, new.receives_2307, new.requires_audited_fs, new.has_related_party_txn,
    new.parent_client_id, new.branch_name, new.is_active, new.needs_review
  );
  return new;
end $$;

drop trigger if exists clients_history_capture on clients;
create trigger clients_history_capture
  after insert or update on clients
  for each row execute function _capture_clients_history();

-- ── Backfill: snapshot every existing client at version 1 ───────────
insert into clients_history (
  client_id, version, changed_at,
  practitioner_id, display_name, tin, rdo_code, industry,
  taxpayer_type, vat_status, regime, tax_classification,
  deduction_method, fiscal_start_month, has_employees,
  withholds_expanded, withholds_final,
  owner_pays_sss, owner_pays_philhealth, owner_pays_pagibig,
  is_rbe, receives_2307, requires_audited_fs, has_related_party_txn,
  parent_client_id, branch_name, is_active, needs_review
)
select
  c.id, 1, c.created_at,
  c.practitioner_id, c.display_name, c.tin, c.rdo_code, c.industry,
  c.taxpayer_type, c.vat_status, c.regime, c.tax_classification,
  c.deduction_method, c.fiscal_start_month, c.has_employees,
  c.withholds_expanded, c.withholds_final,
  c.owner_pays_sss, c.owner_pays_philhealth, c.owner_pays_pagibig,
  c.is_rbe, c.receives_2307, c.requires_audited_fs, c.has_related_party_txn,
  c.parent_client_id, c.branch_name, c.is_active, c.needs_review
from clients c
where not exists (
  select 1 from clients_history h where h.client_id = c.id
);

-- ── tax_status_changes_with_snapshots view ─────────────────────────
-- For each tax_status_changes row, attaches the clients_history rows
-- captured immediately before and after the effective_date — giving
-- structured columns (vat_status_before, vat_status_after, etc.)
-- without parsing JSONB.
create or replace view tax_status_changes_with_snapshots as
with snapshot_at as (
  select
    tsc.id           as tsc_id,
    tsc.client_id,
    tsc.effective_date,
    -- Latest history row at or before effective_date — what the client
    -- looked like just before the change took effect.
    (select h.id from clients_history h
       where h.client_id = tsc.client_id
         and h.changed_at <= tsc.effective_date::timestamptz
       order by h.changed_at desc limit 1) as before_history_id,
    -- Earliest history row strictly after effective_date — what the
    -- client looked like once the change took effect.
    (select h.id from clients_history h
       where h.client_id = tsc.client_id
         and h.changed_at > tsc.effective_date::timestamptz
       order by h.changed_at asc limit 1)  as after_history_id
  from tax_status_changes tsc
)
select
  tsc.*,
  hb.vat_status         as vat_status_before,
  ha.vat_status         as vat_status_after,
  hb.deduction_method   as deduction_method_before,
  ha.deduction_method   as deduction_method_after,
  hb.tax_classification as tax_classification_before,
  ha.tax_classification as tax_classification_after,
  hb.taxpayer_type      as taxpayer_type_before,
  ha.taxpayer_type      as taxpayer_type_after,
  hb.has_employees      as has_employees_before,
  ha.has_employees      as has_employees_after,
  hb.withholds_expanded as withholds_expanded_before,
  ha.withholds_expanded as withholds_expanded_after,
  hb.withholds_final    as withholds_final_before,
  ha.withholds_final    as withholds_final_after
from tax_status_changes tsc
left join snapshot_at sa     on sa.tsc_id = tsc.id
left join clients_history hb on hb.id = sa.before_history_id
left join clients_history ha on ha.id = sa.after_history_id;

alter view tax_status_changes_with_snapshots set (security_invoker = true);

grant select on tax_status_changes_with_snapshots to authenticated;
