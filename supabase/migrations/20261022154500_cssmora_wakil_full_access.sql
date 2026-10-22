-- Wakil Ketua has full access, including the chair review stage for achievement applications.
-- Keep the legacy reviewer table in sync with the unified role assignments.
create or replace function public.sync_cssmora_legacy_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text;
begin
  if tg_op = 'DELETE' then
    v_email := old.email;
  else
    v_email := new.email;
  end if;

  if exists (
    select 1 from public.cssmora_user_roles r
    where r.email = v_email and r.is_active
      and r.role in ('ketua','wakil','bph_departemen')
  ) then
    insert into public.competition_admins (email)
    values (v_email)
    on conflict (email) do nothing;
  else
    delete from public.competition_admins where email = v_email;
  end if;

  if exists (
    select 1 from public.cssmora_user_roles r
    where r.email = v_email and r.is_active
      and r.role in ('ketua','wakil','sekretaris')
  ) then
    insert into public.secretariat_admins (email, created_by)
    values (v_email, auth.uid())
    on conflict (email) do nothing;
  else
    delete from public.secretariat_admins where email = v_email;
  end if;

  delete from public.cssmora_achievement_reviewers r
  where r.email = v_email
    and not exists (
      select 1
      from public.cssmora_user_roles u
      where u.email = v_email
        and u.is_active
        and (
          (r.role = 'ketua' and u.role in ('ketua','wakil'))
          or (r.role = 'bendahara' and u.role = 'bendahara')
          or (r.role not in ('ketua','bendahara') and u.role = r.role)
        )
    );

  insert into public.cssmora_achievement_reviewers (email, role, is_active)
  select v_email, assignments.role, true
  from (
    select distinct case when u.role = 'wakil' then 'ketua' else u.role end as role
    from public.cssmora_user_roles u
    where u.email = v_email
      and u.is_active
      and u.role in ('ketua','wakil','bendahara')
  ) assignments
  on conflict (email, role) do update set is_active = true;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

-- Backfill currently active Wakil Ketua accounts into the chair-review capability.
insert into public.cssmora_achievement_reviewers (email, role, is_active)
select assignments.email, assignments.role, true
from (
  select distinct r.email, 'ketua'::text as role
  from public.cssmora_user_roles r
  where r.is_active and r.role in ('ketua','wakil')
  union
  select distinct r.email, 'bendahara'::text as role
  from public.cssmora_user_roles r
  where r.is_active and r.role = 'bendahara'
) assignments
on conflict (email, role) do update set is_active = true;

-- Serialize leadership demotions so concurrent changes cannot remove the last full-access account.
create or replace function public.set_cssmora_user_role(p_email text, p_role text, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_leadership_count integer;
begin
  if auth.uid() is null or not public.cssmora_user_can_manage_roles() then
    raise exception 'Hanya Ketua atau Wakil Ketua yang dapat mengatur akses pengurus.';
  end if;
  if v_role not in ('ketua','wakil','bendahara','sekretaris','bph_departemen')
     or v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_enabled is null then
    raise exception 'Email, bidang, atau status akses tidak valid.';
  end if;
  if not exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Akun email belum terdaftar di Supabase Auth. Daftarkan akun terlebih dahulu.';
  end if;

  if not p_enabled and v_role in ('ketua','wakil') then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('cssmora_leadership_roles', 0)
    );
    select count(*) into v_leadership_count
    from public.cssmora_user_roles r
    where r.is_active and r.role in ('ketua','wakil')
      and not (r.email = v_email and r.role = v_role);
    if v_leadership_count = 0 then
      raise exception 'Minimal satu akun Ketua atau Wakil harus tetap aktif.';
    end if;
  end if;

  if p_enabled then
    insert into public.cssmora_user_roles (email, role, is_active, created_by)
    values (v_email, v_role, true, auth.uid())
    on conflict (email, role) do update
      set is_active = true, updated_at = now(), created_by = auth.uid();
  else
    update public.cssmora_user_roles
    set is_active = false, updated_at = now()
    where email = v_email and role = v_role;
  end if;

  return true;
end;
$function$;
