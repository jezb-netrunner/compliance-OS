alter table clients
  add column if not exists owner_pays_sss        boolean not null default false,
  add column if not exists owner_pays_philhealth  boolean not null default false,
  add column if not exists owner_pays_pagibig     boolean not null default false;
