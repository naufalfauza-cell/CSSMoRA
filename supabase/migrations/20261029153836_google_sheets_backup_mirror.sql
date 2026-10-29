begin;

alter table public.cssmora_drive_connections
  add column if not exists backup_spreadsheet_id text;

alter table public.cssmora_drive_backup_runs
  add column if not exists sheet_status text not null default 'not_started',
  add column if not exists sheet_updated_at timestamptz,
  add column if not exists sheet_error_message text;

commit;
