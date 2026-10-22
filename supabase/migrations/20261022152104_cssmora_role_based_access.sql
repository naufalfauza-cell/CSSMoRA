-- Unified CSSMoRA management roles and capability-based access.
create table public.cssmora_user_roles (
  email text not null check (email = lower(btrim(email))),
  role text not null check (role in ('ketua','wakil','bendahara','sekretaris','bph_departemen')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  primary key (email, role),
  check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

alter table public.cssmora_user_roles enable row level security;
revoke all on public.cssmora_user_roles from public, anon, authenticated;
grant select on public.cssmora_user_roles to authenticated;

create or replace function public.cssmora_user_has_role(p_role text)
returns boolean
language sql stable security invoker
set search_path = ''
as $
  select auth.uid() is not null
    and p_role in ('ketua','wakil','bendahara','sekretaris','bph_departemen')
    and exists (
      select 1
      from public.cssmora_user_roles r
      where r.email = lower(btrim((select auth.jwt()->>'email')))
        and r.role = p_role
        and r.is_active
    );
$$;
revoke all on function public.cssmora_user_has_role(text) from public;
grant execute on function public.cssmora_user_has_role(text) to anon, authenticated;

create or replace function public.cssmora_user_can_manage_roles()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.cssmora_user_has_role('ketua')
      or public.cssmora_user_has_role('wakil');
$$;
revoke all on function public.cssmora_user_can_manage_roles() from public, anon;
grant execute on function public.cssmora_user_can_manage_roles() to authenticated;

create policy "Users read own roles and leadership reads all"
on public.cssmora_user_roles for select to authenticated
using (
  email = lower(btrim((select auth.jwt()->>'email')))
  or (select public.cssmora_user_can_manage_roles())
);

insert into public.cssmora_user_roles (email, role, is_active)
select lower(btrim(r.email)), r.role, true
from public.cssmora_achievement_reviewers r
where r.is_active
on conflict (email, role) do update set is_active = true, updated_at = now();

insert into public.cssmora_user_roles (email, role, is_active)
select lower(btrim(s.email)), 'sekretaris', true
from public.secretariat_admins s
where not exists (
  select 1 from public.cssmora_user_roles r
  where r.email = lower(btrim(s.email))
    and r.is_active and r.role in ('ketua','wakil')
)
on conflict (email, role) do update set is_active = true, updated_at = now();

insert into public.cssmora_user_roles (email, role, is_active)
select lower(btrim(c.email)), 'bph_departemen', true
from public.competition_admins c
where not exists (
  select 1 from public.cssmora_user_roles r
  where r.email = lower(btrim(c.email)) and r.is_active
)
on conflict (email, role) do update set is_active = true, updated_at = now();

create or replace function public.sync_cssmora_legacy_roles()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
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
      select 1 from public.cssmora_user_roles u
      where u.email = v_email and u.is_active and u.role = r.role
    );

  insert into public.cssmora_achievement_reviewers (email, role, is_active)
  select v_email, u.role, true
  from public.cssmora_user_roles u
  where u.email = v_email and u.is_active and u.role in ('ketua','bendahara')
  on conflict (email, role) do update set is_active = true;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.sync_cssmora_legacy_roles() from public, anon, authenticated;

create trigger sync_cssmora_legacy_roles_after_change
after insert or update or delete
on public.cssmora_user_roles
for each row execute function public.sync_cssmora_legacy_roles();

create or replace function public.set_cssmora_user_role(
  p_email text,
  p_role text,
  p_enabled boolean
)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
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
$$;
revoke all on function public.set_cssmora_user_role(text,text,boolean) from public, anon;
grant execute on function public.set_cssmora_user_role(text,text,boolean) to authenticated;

drop policy if exists "Competition admins manage secretariat access" on public.secretariat_admins;
drop policy if exists "Secretariat users read own access" on public.secretariat_admins;
create policy "Secretariat users read own access and leadership reads all"
on public.secretariat_admins for select to authenticated
using (
  email = lower(btrim((select auth.jwt()->>'email')))
  or (select public.cssmora_user_can_manage_roles())
);
revoke insert, update, delete on public.secretariat_admins from authenticated;
grant select on public.secretariat_admins to authenticated;

drop policy if exists "Secretariat admins manage secretariat members" on public.secretariat_members;
create policy "Secretariat roles manage members"
on public.secretariat_members for all to authenticated
using ((select public.is_secretariat_admin()))
with check ((select public.is_secretariat_admin()));

drop policy if exists "Secretariat admins manage secretariat attendance events" on public.secretariat_attendance_events;
create policy "Secretariat roles manage attendance events"
on public.secretariat_attendance_events for all to authenticated
using ((select public.is_secretariat_admin()))
with check ((select public.is_secretariat_admin()));

drop policy if exists "Secretariat admins manage secretariat attendance records" on public.secretariat_attendance_records;
create policy "Secretariat roles manage attendance records"
on public.secretariat_attendance_records for all to authenticated
using ((select public.is_secretariat_admin()))
with check ((select public.is_secretariat_admin()));

drop policy if exists "Secretariat admins manage secretariat letters" on public.secretariat_letters;
create policy "Secretariat roles manage letters"
on public.secretariat_letters for all to authenticated
using ((select public.is_secretariat_admin()))
with check ((select public.is_secretariat_admin()));

drop policy if exists "Secretariat admins manage secretariat letter counters" on public.secretariat_letter_counters;
create policy "Secretariat roles manage letter counters"
on public.secretariat_letter_counters for all to authenticated
using ((select public.is_secretariat_admin()))
with check ((select public.is_secretariat_admin()));

create or replace function public.create_secretariat_attendance_event(
  p_title text,
  p_event_date date,
  p_session_name text default 'Umum',
  p_location text default null
)
returns uuid
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_event_id uuid;
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Akses sekretariat CSSMoRA diperlukan.';
  end if;
  insert into public.secretariat_attendance_events
    (title,event_date,session_name,location,created_by)
  values (
    btrim(p_title),p_event_date,
    coalesce(nullif(btrim(p_session_name),''),'Umum'),
    nullif(btrim(p_location),''),auth.uid()
  )
  returning id into v_event_id;
  insert into public.secretariat_attendance_records (event_id,member_id,status)
  select v_event_id,m.id,'belum'
  from public.secretariat_members m where m.is_active=true;
  return v_event_id;
end;
$function$;

create or replace function public.issue_secretariat_letter(
  p_issued_on date,
  p_subject text,
  p_scope_code text,
  p_type_code text,
  p_department_code text,
  p_recipient text default null,
  p_attachment_count smallint default 0,
  p_archive_url text default null,
  p_period_start_year smallint default 2026
)
returns jsonb
language plpgsql
set search_path = 'public', 'pg_temp'
as $function$
declare
  v_year smallint;
  v_seq integer;
  v_roman text;
  v_number text;
  v_id uuid;
  v_scope text := lower(btrim(p_scope_code));
  v_type text := upper(btrim(p_type_code));
  v_dept_input text := upper(btrim(p_department_code));
  v_department text;
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Akses sekretariat CSSMoRA diperlukan.';
  end if;
  if p_issued_on is null or length(btrim(coalesce(p_subject, ''))) not between 3 and 240 then
    raise exception 'Tanggal dan perihal surat wajib diisi dengan benar.';
  end if;
  if v_scope is null or v_scope not in ('i', 'e') then raise exception 'Cakupan surat tidak valid.'; end if;
  if v_type is null or v_type not in ('SK','SB','SR','SG','SM','ST','SP','SN','SU','SO','SH','SA') then
    raise exception 'Jenis surat tidak terdaftar.';
  end if;
  v_department := case v_dept_input
    when 'BPH' then 'CSSMoRA-UNAIR'
    when 'PSDM' then 'XI.01'
    when 'P3M' then 'XI.02'
    when 'ADVO' then 'XI.03'
    when 'MEDINFO' then 'XI.04'
    else null
  end;
  if v_department is null then raise exception 'Divisi penerbit tidak terdaftar.'; end if;
  if p_period_start_year is distinct from 2026 then raise exception 'Periode penomoran aktif adalah 2026/2027.'; end if;

  v_year := extract(year from p_issued_on)::smallint;
  insert into public.secretariat_letter_counters (period_start_year, last_number)
  values (p_period_start_year, 1)
  on conflict (period_start_year) do update
    set last_number = public.secretariat_letter_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_seq;

  v_roman := case extract(month from p_issued_on)::integer
    when 1 then 'I' when 2 then 'II' when 3 then 'III' when 4 then 'IV'
    when 5 then 'V' when 6 then 'VI' when 7 then 'VII' when 8 then 'VIII'
    when 9 then 'IX' when 10 then 'X' when 11 then 'XI' when 12 then 'XII'
  end;
  v_number := lpad(v_seq::text, 3, '0') || '/' || v_scope || '/' ||
    v_type || '/' || v_department || '/' || v_roman || '/' || v_year::text;

  insert into public.secretariat_letters(
    year, period_start_year, sequence_number, issued_on, subject, scope_code,
    type_code, department_code, letter_number, recipient, attachment_count,
    archive_url, archive_status, created_by
  ) values (
    v_year, p_period_start_year, v_seq, p_issued_on, btrim(p_subject), v_scope,
    v_type, v_department, v_number, nullif(btrim(p_recipient), ''),
    coalesce(p_attachment_count, 0), nullif(btrim(p_archive_url), ''),
    case when nullif(btrim(p_archive_url), '') is null then 'pending' else 'archived' end,
    auth.uid()
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'letter_number', v_number,
    'sequence_number', v_seq, 'period_start_year', p_period_start_year
  );
end;
$function$;

drop policy if exists "Achievement reviewers read reviewer assignments" on public.cssmora_achievement_reviewers;
drop policy if exists "Chair assigns treasurer reviewers" on public.cssmora_achievement_reviewers;
drop policy if exists "Chair removes treasurer reviewers" on public.cssmora_achievement_reviewers;
create policy "Reviewers read own access and leadership reads all"
on public.cssmora_achievement_reviewers for select to authenticated
using (
  email = lower(btrim((select auth.jwt()->>'email')))
  or (select public.cssmora_user_can_manage_roles())
);
revoke insert, update, delete on public.cssmora_achievement_reviewers from authenticated;
grant select on public.cssmora_achievement_reviewers to authenticated;

drop policy if exists "agenda_admin_all" on public.agenda;
drop policy if exists "agenda_public_read" on public.agenda;
create policy "Agenda public or authorized read"
on public.agenda for select to anon, authenticated
using (
  status = 'published'
  or (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Agenda roles insert"
on public.agenda for insert to authenticated
with check (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Agenda roles update"
on public.agenda for update to authenticated
using (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
)
with check (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Agenda roles delete"
on public.agenda for delete to authenticated
using (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);

drop policy if exists "agenda_programs_admin_all" on public.agenda_programs;
drop policy if exists "agenda_programs_public_read" on public.agenda_programs;
create policy "Agenda programs public read"
on public.agenda_programs for select to anon, authenticated
using (true);
create policy "Agenda programs roles insert"
on public.agenda_programs for insert to authenticated
with check (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Agenda programs roles update"
on public.agenda_programs for update to authenticated
using (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
)
with check (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Agenda programs roles delete"
on public.agenda_programs for delete to authenticated
using (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);

drop policy if exists "CSSMoRA admins can add competitions" on public.competitions;
drop policy if exists "CSSMoRA admins can delete competitions" on public.competitions;
drop policy if exists "CSSMoRA admins can update competitions" on public.competitions;
drop policy if exists "Published catalog and admin view" on public.competitions;
create policy "Competition catalog public or authorized read"
on public.competitions for select to anon, authenticated
using (
  status = 'published'
  or (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Competition roles insert"
on public.competitions for insert to authenticated
with check (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Competition roles update"
on public.competitions for update to authenticated
using (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
)
with check (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "Competition roles delete"
on public.competitions for delete to authenticated
using (
  (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);

create index if not exists cssmora_achievement_application_members_member_id_idx
  on public.cssmora_achievement_application_members (member_id);
create index if not exists cssmora_achievement_applications_leader_member_id_idx
  on public.cssmora_achievement_applications (leader_member_id);
create index if not exists secretariat_admins_created_by_idx
  on public.secretariat_admins (created_by);
create index if not exists secretariat_attendance_events_created_by_idx
  on public.secretariat_attendance_events (created_by);
create index if not exists secretariat_attendance_records_recorded_by_idx
  on public.secretariat_attendance_records (recorded_by);
create index if not exists secretariat_letters_created_by_idx
  on public.secretariat_letters (created_by);

revoke all on function public.increment_secretariat_attendance_code_attempt(uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.increment_secretariat_attendance_code_attempt(uuid,text,timestamptz)
  to service_role;
