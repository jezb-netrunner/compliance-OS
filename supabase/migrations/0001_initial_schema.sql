-- 0001_initial_schema.sql
-- Full schema for The Present Value Compliance OS.
-- Apply once against a fresh Supabase project.
-- Row-Level Security is enabled on every user-facing table.

-- ── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── practitioners ────────────────────────────────────────────────────────────
create table if not exists practitioners (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text,
  firm_name        text,
  email            text,
  email_reminders  boolean not null default true,
  dashboard_days   integer not null default 7,
  created_at       timestamptz not null default now()
);

alter table practitioners enable row level security;

create policy "practitioners: own row" on practitioners
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── clients ──────────────────────────────────────────────────────────────────
create table if not exists clients (
  id                    uuid primary key default gen_random_uuid(),
  practitioner_id       uuid not null references practitioners(id) on delete cascade,
  display_name          text not null,
  tin                   text,
  rdo_code              text,
  industry              text,
  taxpayer_type         text,
  vat_status            text,
  regime                text,
  tax_classification    text,
  deduction_method      text,
  fiscal_start_month    integer not null default 1,
  has_employees         boolean not null default false,
  withholds_expanded    boolean not null default false,
  withholds_final       boolean not null default false,
  owner_pays_sss        boolean not null default false,
  owner_pays_philhealth boolean not null default false,
  owner_pays_pagibig    boolean not null default false,
  parent_client_id      uuid references clients(id) on delete set null,
  branch_name           text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now()
);

alter table clients enable row level security;

create policy "clients: own practitioner" on clients
  using (
    practitioner_id in (
      select id from practitioners where user_id = auth.uid()
    )
  )
  with check (
    practitioner_id in (
      select id from practitioners where user_id = auth.uid()
    )
  );

-- ── compliance_records ───────────────────────────────────────────────────────
create table if not exists compliance_records (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  obligation_id         text,           -- e.g. "2025-2550Q-Q1"
  form                  text,
  period                text,
  due_date              date,
  filed_date            date,
  trrc_saved            boolean not null default false,
  trrc_date             date,
  trrc_reference        text,
  has_tax_due           boolean not null default false,
  tax_due               numeric(18,2),
  payment_status        text not null default 'n/a',   -- 'n/a' | 'unpaid' | 'paid'
  amount_paid           numeric(18,2),
  transaction_fee       numeric(18,2),
  claims_cwt            boolean not null default false,
  dat_files_saved       boolean not null default false,
  validation_email      boolean not null default false,
  validation_email_date date,
  eafs_submitted        boolean not null default false,
  eafs_submission_date  date,
  eafs_reference        text,
  notes                 text,
  created_at            timestamptz not null default now()
);

alter table compliance_records enable row level security;

create policy "compliance_records: own clients" on compliance_records
  using (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.user_id = auth.uid()
    )
  );

-- ── tax_status_changes ───────────────────────────────────────────────────────
create table if not exists tax_status_changes (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references clients(id) on delete cascade,
  effective_date        date not null,
  old_profile           jsonb,
  new_profile           jsonb,
  cor_amendment_needed  boolean not null default false,
  cor_uploaded          boolean not null default false,
  cor_reference         text,
  form_1905_needed      boolean not null default false,
  form_1905_filed       boolean not null default false,
  notes                 text,
  created_at            timestamptz not null default now()
);

alter table tax_status_changes enable row level security;

create policy "tax_status_changes: own clients" on tax_status_changes
  using (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.user_id = auth.uid()
    )
  )
  with check (
    client_id in (
      select c.id from clients c
      join practitioners p on p.id = c.practitioner_id
      where p.user_id = auth.uid()
    )
  );

-- ── enrollment_tokens ────────────────────────────────────────────────────────
create table if not exists enrollment_tokens (
  id                uuid primary key default gen_random_uuid(),
  practitioner_id   uuid not null references practitioners(id) on delete cascade,
  token             text not null unique default encode(gen_random_bytes(24), 'base64url'),
  client_name_hint  text,
  used              boolean not null default false,
  expires_at        timestamptz not null default (now() + interval '7 days'),
  created_at        timestamptz not null default now()
);

alter table enrollment_tokens enable row level security;

-- Practitioners manage their own tokens
create policy "enrollment_tokens: own practitioner" on enrollment_tokens
  using (
    practitioner_id in (
      select id from practitioners where user_id = auth.uid()
    )
  )
  with check (
    practitioner_id in (
      select id from practitioners where user_id = auth.uid()
    )
  );

-- Public (unauthenticated) read for the enrollment form (validates the token)
create policy "enrollment_tokens: public read by token" on enrollment_tokens
  for select using (true);

-- Public insert into clients for the enrollment form
create policy "clients: public enrollment insert" on clients
  for insert with check (true);

-- Public update on enrollment_tokens to mark used=true
create policy "enrollment_tokens: public mark used" on enrollment_tokens
  for update using (true) with check (true);

-- ── Indexes ──────────────────────────────────────────────────────────────────
create index if not exists idx_clients_practitioner       on clients(practitioner_id);
create index if not exists idx_compliance_client          on compliance_records(client_id);
create index if not exists idx_compliance_due             on compliance_records(due_date);
create index if not exists idx_compliance_obligation_id   on compliance_records(obligation_id);
create index if not exists idx_tsc_client                 on tax_status_changes(client_id);
create index if not exists idx_enrollment_token           on enrollment_tokens(token);
