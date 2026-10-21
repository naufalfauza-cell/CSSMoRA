create table if not exists public.secretariat_attendance_code_attempts (
  event_id uuid not null references public.secretariat_attendance_events(id) on delete cascade,
  limiter_key text not null,
  attempt_window timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (event_id, limiter_key)
);

alter table public.secretariat_attendance_code_attempts enable row level security;
revoke all on table public.secretariat_attendance_code_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.secretariat_attendance_code_attempts to service_role;

create or replace function public.increment_secretariat_attendance_code_attempt(
  p_event_id uuid,
  p_limiter_key text,
  p_attempt_window timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_attempt_count integer;
begin
  if p_limiter_key is null or pg_catalog.char_length(p_limiter_key) < 3 or pg_catalog.char_length(p_limiter_key) > 100 then
    raise exception 'Invalid limiter key';
  end if;
  if p_attempt_window is null then
    raise exception 'Invalid attempt window';
  end if;

  delete from public.secretariat_attendance_code_attempts
  where event_id = p_event_id
    and attempt_window < p_attempt_window - interval '1 day';

  insert into public.secretariat_attendance_code_attempts (
    event_id, limiter_key, attempt_window, attempt_count, updated_at
  )
  values (p_event_id, p_limiter_key, p_attempt_window, 1, pg_catalog.now())
  on conflict (event_id, limiter_key) do update
  set attempt_count = case
        when public.secretariat_attendance_code_attempts.attempt_window = excluded.attempt_window
          then public.secretariat_attendance_code_attempts.attempt_count + 1
        else 1
      end,
      attempt_window = excluded.attempt_window,
      updated_at = pg_catalog.now()
  returning attempt_count into v_attempt_count;

  return v_attempt_count;
end;
$function$;

revoke all on function public.increment_secretariat_attendance_code_attempt(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.increment_secretariat_attendance_code_attempt(uuid, text, timestamptz) to service_role;
