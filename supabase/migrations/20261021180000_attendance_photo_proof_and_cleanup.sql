create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.secretariat_attendance_records
  add column if not exists proof_path text,
  add column if not exists proof_uploaded_at timestamptz,
  add column if not exists proof_expires_at timestamptz,
  add column if not exists proof_deleted_at timestamptz;

create unique index if not exists secretariat_attendance_records_proof_path_key
  on public.secretariat_attendance_records (proof_path)
  where proof_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-proofs', 'attendance-proofs', false, 512000, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = 512000,
    allowed_mime_types = array['image/jpeg'];

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'attendance_photo_cleanup') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', '') ||
      replace(gen_random_uuid()::text, '-', ''),
      'attendance_photo_cleanup',
      'Secret used by the scheduled CSSMoRA attendance photo cleanup job'
    );
  end if;
end;
$$;

create or replace function public.verify_attendance_photo_cleanup_secret(p_candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select p_candidate is not null
     and exists (
       select 1
       from vault.decrypted_secrets
       where name = 'attendance_photo_cleanup'
         and decrypted_secret = p_candidate
     );
$$;

revoke all on function public.verify_attendance_photo_cleanup_secret(text) from public, anon, authenticated;
grant execute on function public.verify_attendance_photo_cleanup_secret(text) to service_role;

do $$
declare
  old_job record;
begin
  for old_job in
    select jobid from cron.job where jobname = 'cssmora-attendance-photo-cleanup'
  loop
    perform cron.unschedule(old_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'cssmora-attendance-photo-cleanup',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := 'https://xciouilzpxxfqvxsuyqg.supabase.co/functions/v1/attendance-checkin?mode=cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', 'sb_publishable_CCg_NYhlI6ER8H0eJvGzpQ_-4kcb5gf',
        'x-attendance-cleanup-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'attendance_photo_cleanup')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  $job$
);
