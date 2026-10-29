begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table public.cssmora_drive_connections (
  singleton boolean primary key default true check (singleton),
  account_email text not null,
  drive_root_folder_id text not null,
  drive_uploads_folder_id text not null,
  drive_backups_folder_id text not null,
  refresh_token_ciphertext text not null,
  connected_by_email text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cssmora_drive_oauth_states (
  state_hash text primary key,
  requested_by_email text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.cssmora_drive_mirrors (
  bucket_id text not null,
  object_path text not null,
  drive_file_id text not null unique,
  content_type text not null,
  size_bytes bigint not null default 0,
  sha256_checksum text not null,
  synced_at timestamptz not null default now(),
  primary key (bucket_id, object_path)
);

create table public.cssmora_drive_sync_queue (
  id bigint generated always as identity primary key,
  bucket_id text not null check (bucket_id in (
    'attendance-proofs',
    'cssmora-achievement-certificates',
    'cssmora-agenda-programs',
    'cssmora-letter-pdfs',
    'cssmora-prestasi-proofs',
    'cssmora-signer-assets',
    'posters'
  )),
  object_path text not null,
  operation text not null check (operation in ('upsert', 'delete')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  generation bigint not null default 1,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

create index cssmora_drive_sync_queue_ready_idx
  on public.cssmora_drive_sync_queue (status, next_attempt_at, created_at);

create table public.cssmora_drive_backup_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  drive_file_id text,
  encrypted_size_bytes bigint,
  record_counts jsonb not null default '{}'::jsonb,
  error_message text
);

alter table public.cssmora_drive_connections enable row level security;
alter table public.cssmora_drive_oauth_states enable row level security;
alter table public.cssmora_drive_mirrors enable row level security;
alter table public.cssmora_drive_sync_queue enable row level security;
alter table public.cssmora_drive_backup_runs enable row level security;

revoke all on public.cssmora_drive_connections,
  public.cssmora_drive_oauth_states,
  public.cssmora_drive_mirrors,
  public.cssmora_drive_sync_queue,
  public.cssmora_drive_backup_runs
from public, anon, authenticated;

grant all on public.cssmora_drive_connections,
  public.cssmora_drive_oauth_states,
  public.cssmora_drive_mirrors,
  public.cssmora_drive_sync_queue,
  public.cssmora_drive_backup_runs
to service_role;

grant usage, select on sequence public.cssmora_drive_sync_queue_id_seq to service_role;

create or replace function public.enqueue_cssmora_drive_object()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_bucket text;
  v_path text;
  v_operation text;
begin
  if tg_op = 'DELETE' then
    v_bucket := old.bucket_id;
    v_path := old.name;
    v_operation := 'delete';
  else
    v_bucket := new.bucket_id;
    v_path := new.name;
    v_operation := 'upsert';
  end if;

  if v_bucket not in (
    'attendance-proofs',
    'cssmora-achievement-certificates',
    'cssmora-agenda-programs',
    'cssmora-letter-pdfs',
    'cssmora-prestasi-proofs',
    'cssmora-signer-assets',
    'posters'
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  insert into public.cssmora_drive_sync_queue as existing (
    bucket_id, object_path, operation, status, attempts, next_attempt_at, last_error, updated_at
  ) values (
    v_bucket, v_path, v_operation, 'pending', 0, pg_catalog.now(), null, pg_catalog.now()
  )
  on conflict (bucket_id, object_path) do update
  set operation = excluded.operation,
      status = 'pending',
      attempts = 0,
      generation = existing.generation + 1,
      next_attempt_at = pg_catalog.now(),
      last_error = null,
      updated_at = pg_catalog.now();

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.enqueue_cssmora_drive_object() from public, anon, authenticated;

drop trigger if exists cssmora_drive_enqueue_storage_insert on storage.objects;
create trigger cssmora_drive_enqueue_storage_insert
after insert or update on storage.objects
for each row execute function public.enqueue_cssmora_drive_object();

drop trigger if exists cssmora_drive_enqueue_storage_delete on storage.objects;
create trigger cssmora_drive_enqueue_storage_delete
after delete on storage.objects
for each row execute function public.enqueue_cssmora_drive_object();

-- Mirror current objects without removing or rewriting their Supabase originals.
insert into public.cssmora_drive_sync_queue (bucket_id, object_path, operation)
select o.bucket_id, o.name, 'upsert'
from storage.objects o
where o.bucket_id in (
  'attendance-proofs',
  'cssmora-achievement-certificates',
  'cssmora-agenda-programs',
  'cssmora-letter-pdfs',
  'cssmora-prestasi-proofs',
  'cssmora-signer-assets',
  'posters'
)
on conflict (bucket_id, object_path) do nothing;

create or replace function public.claim_cssmora_drive_sync_jobs(p_limit integer default 10)
returns table(id bigint, bucket_id text, object_path text, operation text, attempts integer, generation bigint)
language sql
security definer
set search_path = ''
as $function$
  with candidates as (
    select q.id as job_id
    from public.cssmora_drive_sync_queue q
    where (q.status = 'pending' and q.next_attempt_at <= pg_catalog.now())
       or (q.status = 'processing' and q.updated_at < pg_catalog.now() - interval '15 minutes')
    order by q.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ),
  claimed as (
    update public.cssmora_drive_sync_queue q
    set status = 'processing',
        updated_at = pg_catalog.now()
    from candidates c
    where q.id = c.job_id
    returning q.id, q.bucket_id, q.object_path, q.operation, q.attempts, q.generation
  )
  select claimed.id, claimed.bucket_id, claimed.object_path, claimed.operation, claimed.attempts, claimed.generation
  from claimed;
$function$;

revoke all on function public.claim_cssmora_drive_sync_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_cssmora_drive_sync_jobs(integer) to service_role;

create or replace function public.export_cssmora_drive_backup()
returns jsonb
language sql
security definer
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'format', 'cssmora-data-backup-v1',
    'generated_at', pg_catalog.clock_timestamp(),
    'tables', pg_catalog.jsonb_build_object(
      'agenda', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.agenda as t), '[]'::jsonb),
      'agenda_programs', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.agenda_programs as t), '[]'::jsonb),
      'competition_admins', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.competition_admins as t), '[]'::jsonb),
      'competitions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.competitions as t), '[]'::jsonb),
      'cssmora_achievement_application_members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_application_members as t), '[]'::jsonb),
      'cssmora_achievement_applications', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_applications as t), '[]'::jsonb),
      'cssmora_achievement_record_members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_record_members as t), '[]'::jsonb),
      'cssmora_achievement_records', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_records as t), '[]'::jsonb),
      'cssmora_achievement_reviewers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_reviewers as t), '[]'::jsonb),
      'cssmora_finance_budgets', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_finance_budgets as t), '[]'::jsonb),
      'cssmora_finance_transactions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_finance_transactions as t), '[]'::jsonb),
      'cssmora_letter_signature_requests', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_letter_signature_requests as t), '[]'::jsonb),
      'cssmora_program_cycle_history', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_cycle_history as t), '[]'::jsonb),
      'cssmora_program_cycles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_cycles as t), '[]'::jsonb),
      'cssmora_program_details', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_details as t), '[]'::jsonb),
      'cssmora_program_milestones', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_milestones as t), '[]'::jsonb),
      'cssmora_user_roles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_user_roles as t), '[]'::jsonb),
      'secretariat_admins', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_admins as t), '[]'::jsonb),
      'secretariat_attendance_events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_attendance_events as t), '[]'::jsonb),
      'secretariat_attendance_records', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_attendance_records as t), '[]'::jsonb),
      'secretariat_letter_counters', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_letter_counters as t), '[]'::jsonb),
      'secretariat_letters', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_letters as t), '[]'::jsonb),
      'secretariat_members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_members as t), '[]'::jsonb)
    )
  );
$function$;

revoke all on function public.export_cssmora_drive_backup() from public, anon, authenticated;
grant execute on function public.export_cssmora_drive_backup() to service_role;

do $block$
begin
  if not exists (select 1 from vault.secrets where name = 'cssmora_drive_worker') then
    perform vault.create_secret(
      replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
      replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
      replace(pg_catalog.gen_random_uuid()::text, '-', '') ||
      replace(pg_catalog.gen_random_uuid()::text, '-', ''),
      'cssmora_drive_worker',
      'Private token used only by scheduled CSSMoRA Google Drive tasks'
    );
  end if;
end;
$block$;

create or replace function public.verify_cssmora_drive_job_secret(p_candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $function$
  select p_candidate is not null
     and exists (
       select 1
       from vault.decrypted_secrets
       where name = 'cssmora_drive_worker'
         and decrypted_secret = p_candidate
     );
$function$;

revoke all on function public.verify_cssmora_drive_job_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cssmora_drive_job_secret(text) to service_role;

create or replace function public.invoke_cssmora_drive_worker(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_secret text;
begin
  if p_action not in ('sync', 'backup') then return; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'cssmora_drive_worker';

  if coalesce(v_secret, '') = '' then return; end if;

  perform net.http_post(
    url := 'https://xciouilzpxxfqvxsuyqg.supabase.co/functions/v1/drive-integration',
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cssmora-drive-job', v_secret
    ),
    body := pg_catalog.jsonb_build_object('action', p_action),
    timeout_milliseconds := 120000
  );
end;
$function$;

revoke all on function public.invoke_cssmora_drive_worker(text) from public, anon, authenticated;

do $block$
declare
  v_job record;
begin
  for v_job in
    select jobid from cron.job
    where jobname in ('cssmora-drive-file-sync', 'cssmora-drive-daily-backup')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'cssmora-drive-file-sync',
    '* * * * *',
    $$select public.invoke_cssmora_drive_worker('sync');$$
  );

  perform cron.schedule(
    'cssmora-drive-daily-backup',
    '0 19 * * *',
    $$select public.invoke_cssmora_drive_worker('backup');$$
  );
end;
$block$;

commit;
