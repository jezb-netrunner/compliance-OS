-- 0002_add_branches_and_tax_history.sql
--
-- Originally this migration also re-declared tax_status_changes and
-- recreated its RLS policy against `practitioners.auth_id` — both
-- broken: 0001 had already created the table (so CREATE TABLE IF NOT
-- EXISTS no-op'd) and 0001 named the FK column `user_id` (so the
-- policy referenced a non-existent column at apply time). The
-- redundant blocks have been removed; 0006 adds the missing columns
-- and 0006/0009 own the canonical RLS for tax_status_changes.

-- Branch support columns on clients
alter table clients
  add column if not exists parent_client_id uuid references clients(id) on delete set null,
  add column if not exists branch_name      text;

create index if not exists idx_clients_parent
  on clients (parent_client_id);

-- Useful chronological index on tax_status_changes (table itself is
-- created by 0001; columns extended by 0006).
create index if not exists tsc_client_idx
  on tax_status_changes (client_id, effective_date desc);
