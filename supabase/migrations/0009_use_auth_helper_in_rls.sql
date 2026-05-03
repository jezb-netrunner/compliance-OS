-- 0009_use_auth_helper_in_rls.sql
--
-- HI-9: Every RLS policy in 0001 inlined the same join, e.g.
--
--     where practitioner_id in (
--       select id from practitioners where auth_id = auth.uid()
--     )
--
-- The subquery is re-evaluated for every row in every read/write,
-- adds maintenance burden (5 places to patch when ownership rules
-- evolve), and is not indexed by the join key. Migration 0006
-- introduced the SECURITY DEFINER helper auth_practitioner_id() and
-- the unique index on practitioners(auth_id); this migration migrates
-- every existing policy onto the helper.
--
-- Idempotent: each policy is dropped and recreated, no-op on a fresh DB.

-- ── clients ────────────────────────────────────────────────────────
drop policy if exists "clients: own practitioner" on clients;
create policy "clients: own practitioner" on clients
  using       (practitioner_id = auth_practitioner_id())
  with check  (practitioner_id = auth_practitioner_id());

-- ── compliance_records ─────────────────────────────────────────────
drop policy if exists "compliance_records: own clients" on compliance_records;
create policy "compliance_records: own clients" on compliance_records
  using (
    client_id in (
      select id from clients where practitioner_id = auth_practitioner_id()
    )
  )
  with check (
    client_id in (
      select id from clients where practitioner_id = auth_practitioner_id()
    )
  );

-- ── tax_status_changes ─────────────────────────────────────────────
drop policy if exists "tax_status_changes: own clients" on tax_status_changes;
create policy "tax_status_changes: own clients"
  on tax_status_changes for all
  using (
    client_id in (
      select id from clients where practitioner_id = auth_practitioner_id()
    )
  )
  with check (
    client_id in (
      select id from clients where practitioner_id = auth_practitioner_id()
    )
  );

-- ── enrollment_tokens ──────────────────────────────────────────────
drop policy if exists "enrollment_tokens: own practitioner" on enrollment_tokens;
create policy "enrollment_tokens: own practitioner" on enrollment_tokens
  using       (practitioner_id = auth_practitioner_id())
  with check  (practitioner_id = auth_practitioner_id());
