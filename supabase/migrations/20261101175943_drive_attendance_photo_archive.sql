begin;

create table public.cssmora_drive_archives (
  bucket_id text not null check (bucket_id = 'attendance-proofs'),
  object_path text not null,
  event_id uuid not null,
  drive_folder_id text not null,
  drive_file_id text not null unique,
  content_type text not null check (content_type = 'image/jpeg'),
  size_bytes bigint not null check (size_bytes >= 0),
  sha256_checksum text not null check (sha256_checksum ~ '^[0-9a-f]{64}$'),
  archived_at timestamptz not null default now(),
  primary key (bucket_id, object_path)
);

create index cssmora_drive_archives_event_idx
  on public.cssmora_drive_archives (event_id, archived_at desc);

alter table public.cssmora_drive_archives enable row level security;
revoke all on public.cssmora_drive_archives from public, anon, authenticated;
grant all on public.cssmora_drive_archives to service_role;

comment on table public.cssmora_drive_archives is
  'Permanent private Drive archive pointers for attendance photos retained after Supabase source deletion.';

commit;
