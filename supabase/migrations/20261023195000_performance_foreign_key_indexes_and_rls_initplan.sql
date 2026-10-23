-- Add missing FK indexes found by the Supabase performance advisor.
create index if not exists cssmora_finance_budgets_created_by_idx
  on public.cssmora_finance_budgets (created_by);
create index if not exists cssmora_finance_transactions_created_by_idx
  on public.cssmora_finance_transactions (created_by);
create index if not exists cssmora_program_cycle_history_actor_id_idx
  on public.cssmora_program_cycle_history (actor_id);
create index if not exists cssmora_program_cycles_created_by_idx
  on public.cssmora_program_cycles (created_by);
create index if not exists cssmora_program_cycles_updated_by_idx
  on public.cssmora_program_cycles (updated_by);
create index if not exists cssmora_program_details_updated_by_idx
  on public.cssmora_program_details (updated_by);
create index if not exists cssmora_program_milestones_created_by_idx
  on public.cssmora_program_milestones (created_by);
create index if not exists cssmora_program_milestones_updated_by_idx
  on public.cssmora_program_milestones (updated_by);
create index if not exists cssmora_user_roles_created_by_idx
  on public.cssmora_user_roles (created_by);

-- Keep auth claims as init-plans so RLS helper calls are evaluated once per query.
create or replace function public.cssmora_user_has_role(p_role text)
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and p_role in ('ketua','wakil','bendahara','sekretaris','bph_departemen')
    and exists (
      select 1
      from public.cssmora_user_roles r
      where r.email = lower(btrim((select auth.jwt()->>'email')))
        and r.role = p_role
        and r.is_active
    );
$$;
revoke all on function public.cssmora_user_has_role(text) from public, anon;
grant execute on function public.cssmora_user_has_role(text) to authenticated;

create or replace function public.is_secretariat_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.secretariat_admins s
    where s.email = lower(btrim((select auth.jwt()->>'email')))
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
    where r.email = lower(btrim((select auth.jwt()->>'email')))
      and r.is_active
      and (p_role is null or r.role = p_role)
  );
$$;
revoke all on function public.cssmora_achievement_is_reviewer(text) from public, anon;
grant execute on function public.cssmora_achievement_is_reviewer(text) to authenticated;
