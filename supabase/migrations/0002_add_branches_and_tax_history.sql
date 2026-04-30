-- Add branch support columns to clients
alter table clients
  add column if not exists parent_client_id uuid references clients(id) on delete set null,
  add column if not exists branch_name text;

create index if not exists idx_clients_parent on clients(parent_client_id);

-- Create tax_status_changes table
create table if not exists tax_status_changes (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references clients(id) on delete cascade,
  practitioner_id      uuid not null references practitioners(id),
  effective_date       date not null,
  change_type          text not null,
  obligation_code      text,
  old_profile          jsonb not null,
  new_profile          jsonb not null,
  cor_amendment_needed boolean not null default true,
  cor_uploaded         boolean not null default false,
  cor_reference        text,
  form_1905_needed     boolean not null default true,
  form_1905_filed      boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now()
);

create index if not exists tsc_client_idx on tax_status_changes(client_id, effective_date desc);

alter table tax_status_changes enable row level security;

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
