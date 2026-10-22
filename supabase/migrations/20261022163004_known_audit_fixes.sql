
alter table public.secretariat_letters drop constraint if exists secretariat_letters_department_code_check;
alter table public.secretariat_letters add constraint secretariat_letters_department_code_check
check(department_code ~ '^[A-Z0-9.]{1,20}$' or department_code='CSSMoRA-UNAIR');

create or replace function public.save_secretariat_attendance_changes(p_event_id uuid,p_changes jsonb)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_change jsonb; v_status text; v_count integer:=0; v_rows integer;
begin
 if auth.uid() is null or not public.is_secretariat_admin() then raise exception 'Akses sekretariat diperlukan.'; end if;
 select status into v_status from public.secretariat_attendance_events where id=p_event_id for update;
 if v_status is distinct from 'open' then raise exception 'Absensi sudah ditutup atau tidak ditemukan.'; end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' then raise exception 'Perubahan absensi tidak valid.'; end if;
 if jsonb_array_length(p_changes)>1000 then raise exception 'Terlalu banyak perubahan absensi.'; end if;
 for v_change in select value from jsonb_array_elements(p_changes) loop
  if coalesce(v_change->>'status','') not in ('belum','hadir','izin','sakit','alpa')
     or coalesce(length(v_change->>'reason'),0)>1000 or v_change->>'expected_updated_at' is null then
   raise exception 'Perubahan absensi tidak valid.';
  end if;
  update public.secretariat_attendance_records
  set status=v_change->>'status',reason=nullif(btrim(v_change->>'reason'),''),
      recorded_by=auth.uid(),updated_at=clock_timestamp()
  where event_id=p_event_id and member_id=(v_change->>'member_id')::uuid
    and updated_at=(v_change->>'expected_updated_at')::timestamptz;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'Data absensi telah berubah. Muat ulang rekap sebelum menyimpan.'; end if;
  v_count:=v_count+1;
 end loop;
 return v_count;
end;
$$;
revoke all on function public.save_secretariat_attendance_changes(uuid,jsonb) from public,anon;
grant execute on function public.save_secretariat_attendance_changes(uuid,jsonb) to authenticated;
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
          or (r.role = 'bendahara' and u.role in ('ketua','wakil','bendahara'))
          or (r.role not in ('ketua','bendahara') and u.role = r.role)
        )
    );

  insert into public.cssmora_achievement_reviewers (email, role, is_active)
  select v_email, assignments.role, true
  from (
    select distinct caps.role
    from public.cssmora_user_roles u
    cross join lateral (
      select 'ketua'::text role where u.role in ('ketua','wakil')
      union select 'bendahara'::text where u.role in ('ketua','wakil','bendahara')
    ) caps
    where u.email=v_email and u.is_active
  ) assignments
  on conflict (email, role) do update set is_active = true;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;


insert into public.cssmora_achievement_reviewers(email,role,is_active)
select distinct u.email,caps.role,true from public.cssmora_user_roles u
cross join lateral(
 select 'ketua'::text role where u.role in ('ketua','wakil')
 union select 'bendahara'::text where u.role in ('ketua','wakil','bendahara')
) caps where u.is_active
on conflict(email,role) do update set is_active=true;

update storage.buckets set file_size_limit=2097152,allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='posters';
drop policy if exists "Competition roles upload posters" on storage.objects;
create policy "Competition roles upload posters" on storage.objects for insert to authenticated
with check(bucket_id='posters' and ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or (select public.cssmora_user_has_role('bph_departemen'))));
drop policy if exists "Competition roles remove posters" on storage.objects;
create policy "Competition roles remove posters" on storage.objects for delete to authenticated
using(bucket_id='posters' and ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or (select public.cssmora_user_has_role('bph_departemen'))));
drop policy if exists "Competition roles read posters" on storage.objects;
create policy "Competition roles read posters" on storage.objects for select to authenticated
using(bucket_id='posters' and ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or (select public.cssmora_user_has_role('bph_departemen'))));
notify pgrst,'reload schema';
