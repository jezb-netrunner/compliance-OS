-- AFS eSubmission workflow expansion:
-- clients: flags driving which AFS eSubmission upload boxes are required
alter table clients
  add column if not exists requires_audited_fs   boolean not null default false,
  add column if not exists has_related_party_txn boolean not null default false;

-- compliance_records: per-upload-box completion tracking
alter table compliance_records
  add column if not exists afs_itr_uploaded    boolean not null default false,
  add column if not exists afs_afs_uploaded    boolean not null default false,
  add column if not exists afs_1709_uploaded   boolean not null default false,
  add column if not exists afs_others_uploaded boolean not null default false;
