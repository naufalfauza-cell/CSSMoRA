create table public.cssmora_achievement_ip_submission_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now()
);
create index cssmora_achievement_ip_submission_limits_updated_idx
  on public.cssmora_achievement_ip_submission_limits (updated_at);

alter table public.cssmora_achievement_ip_submission_limits enable row level security;
revoke all on public.cssmora_achievement_ip_submission_limits from public, anon, authenticated;
grant select, insert, update, delete on public.cssmora_achievement_ip_submission_limits to service_role;

create or replace function public.consume_cssmora_achievement_ip_limit(p_ip_hash text)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_now timestamptz := pg_catalog.now();
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid submission rate-limit key.';
  end if;

  delete from public.cssmora_achievement_ip_submission_limits
  where updated_at < v_now - interval '7 days';

  insert into public.cssmora_achievement_ip_submission_limits
    (ip_hash, window_started_at, request_count, updated_at)
  values (p_ip_hash, v_now, 1, v_now)
  on conflict (ip_hash) do update
  set window_started_at = case
        when public.cssmora_achievement_ip_submission_limits.window_started_at < v_now - interval '1 hour'
          then v_now
        else public.cssmora_achievement_ip_submission_limits.window_started_at
      end,
      request_count = case
        when public.cssmora_achievement_ip_submission_limits.window_started_at < v_now - interval '1 hour'
          then 1
        else public.cssmora_achievement_ip_submission_limits.request_count + 1
      end,
      updated_at = v_now
  returning request_count into v_count;

  return v_count <= 5;
end;
$$;

revoke all on function public.consume_cssmora_achievement_ip_limit(text) from public, anon, authenticated;
grant execute on function public.consume_cssmora_achievement_ip_limit(text) to service_role;
