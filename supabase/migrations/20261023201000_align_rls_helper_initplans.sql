-- Keep nested authentication helpers consistent with the optimized RLS policies.
create or replace function public.is_secretariat_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.secretariat_admins s
    where s.email = lower(btrim((select auth.jwt()) ->> 'email'))
  );
$$;
revoke all on function public.is_secretariat_admin() from public, anon;
grant execute on function public.is_secretariat_admin() to authenticated;

create or replace function public.cssmora_achievement_is_reviewer(p_role text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.cssmora_achievement_reviewers r
    where r.email = lower(btrim((select auth.jwt()) ->> 'email'))
      and r.is_active
      and (p_role is null or r.role = p_role)
  );
$$;
revoke all on function public.cssmora_achievement_is_reviewer(text) from public, anon;
grant execute on function public.cssmora_achievement_is_reviewer(text) to authenticated;
