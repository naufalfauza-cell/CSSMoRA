create table public.secretariat_admins (
  email text primary key check (email = lower(btrim(email))),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table public.secretariat_admins enable row level security;

create policy "Secretariat users read own access"
on public.secretariat_admins for select to authenticated
using (
  email = lower(btrim(auth.jwt()->>'email'))
  or exists (
    select 1 from public.competition_admins a
    where a.email = lower(btrim(auth.jwt()->>'email'))
  )
);

create policy "Competition admins manage secretariat access"
on public.secretariat_admins for all to authenticated
using (exists (
  select 1 from public.competition_admins a
  where a.email = lower(btrim(auth.jwt()->>'email'))
))
with check (exists (
  select 1 from public.competition_admins a
  where a.email = lower(btrim(auth.jwt()->>'email'))
));

grant select, insert, update, delete on public.secretariat_admins to authenticated;
revoke all on public.secretariat_admins from anon, public;

create or replace function public.is_secretariat_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.secretariat_admins s
    where s.email = lower(btrim(auth.jwt()->>'email'))
  );
$$;
revoke all on function public.is_secretariat_admin() from public, anon;
grant execute on function public.is_secretariat_admin() to authenticated;

drop policy "CSSMoRA admins manage secretariat members" on public.secretariat_members;
create policy "Secretariat admins manage secretariat members" on public.secretariat_members for all to authenticated
using (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
)
with check (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
);

drop policy "CSSMoRA admins manage secretariat attendance events" on public.secretariat_attendance_events;
create policy "Secretariat admins manage secretariat attendance events" on public.secretariat_attendance_events for all to authenticated
using (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
)
with check (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
);

drop policy "CSSMoRA admins manage secretariat attendance records" on public.secretariat_attendance_records;
create policy "Secretariat admins manage secretariat attendance records" on public.secretariat_attendance_records for all to authenticated
using (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
)
with check (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
);

drop policy "CSSMoRA admins manage secretariat letters" on public.secretariat_letters;
create policy "Secretariat admins manage secretariat letters" on public.secretariat_letters for all to authenticated
using (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
)
with check (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
);

drop policy "CSSMoRA admins manage secretariat letter counters" on public.secretariat_letter_counters;
create policy "Secretariat admins manage secretariat letter counters" on public.secretariat_letter_counters for all to authenticated
using (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
)
with check (
  public.is_secretariat_admin() or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  )
);

create or replace function public.create_secretariat_attendance_event(
  p_title text, p_event_date date, p_session_name text default 'Umum', p_location text default null
) returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_event_id uuid;
begin
  if auth.uid() is null or not (
    public.is_secretariat_admin() or exists (
      select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
    )
  ) then
    raise exception 'Akses sekretariat CSSMoRA diperlukan.';
  end if;
  insert into public.secretariat_attendance_events (title,event_date,session_name,location,created_by)
  values (btrim(p_title),p_event_date,coalesce(nullif(btrim(p_session_name),''),'Umum'),nullif(btrim(p_location),''),auth.uid())
  returning id into v_event_id;
  insert into public.secretariat_attendance_records (event_id,member_id,status)
  select v_event_id,m.id,'belum' from public.secretariat_members m where m.is_active=true;
  return v_event_id;
end;
$$;

create or replace function public.issue_secretariat_letter(
  p_issued_on date,p_subject text,p_scope_code text,p_type_code text,p_department_code text,
  p_recipient text default null,p_attachment_count smallint default 0,p_archive_url text default null
) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_year smallint; v_seq integer; v_roman text; v_number text; v_id uuid;
begin
  if auth.uid() is null or not (
    public.is_secretariat_admin() or exists (
      select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
    )
  ) then
    raise exception 'Akses sekretariat CSSMoRA diperlukan.';
  end if;
  v_year := extract(year from p_issued_on)::smallint;
  insert into public.secretariat_letter_counters (year,last_number) values (v_year,1)
  on conflict (year) do update set last_number=public.secretariat_letter_counters.last_number+1,updated_at=now()
  returning last_number into v_seq;
  v_roman := case extract(month from p_issued_on)::integer
    when 1 then 'I' when 2 then 'II' when 3 then 'III' when 4 then 'IV' when 5 then 'V' when 6 then 'VI'
    when 7 then 'VII' when 8 then 'VIII' when 9 then 'IX' when 10 then 'X' when 11 then 'XI' when 12 then 'XII' end;
  v_number := lpad(v_seq::text,3,'0')||'/'||lower(btrim(p_scope_code))||'/'||upper(btrim(p_type_code))||'/CSSMoRA-UNAIR/'||v_roman||'/'||v_year::text;
  insert into public.secretariat_letters(year,sequence_number,issued_on,subject,scope_code,type_code,department_code,letter_number,recipient,attachment_count,archive_url,archive_status,created_by)
  values (v_year,v_seq,p_issued_on,btrim(p_subject),lower(btrim(p_scope_code)),upper(btrim(p_type_code)),upper(btrim(p_department_code)),v_number,
    nullif(btrim(p_recipient),''),coalesce(p_attachment_count,0),nullif(btrim(p_archive_url),''),case when nullif(btrim(p_archive_url),'') is null then 'pending' else 'archived' end,auth.uid())
  returning id into v_id;
  return jsonb_build_object('id',v_id,'letter_number',v_number,'sequence_number',v_seq);
end;
$$;

revoke all on function public.create_secretariat_attendance_event(text,date,text,text) from public,anon;
revoke all on function public.issue_secretariat_letter(date,text,text,text,text,text,smallint,text) from public,anon;
grant execute on function public.create_secretariat_attendance_event(text,date,text,text) to authenticated;
grant execute on function public.issue_secretariat_letter(date,text,text,text,text,text,smallint,text) to authenticated;
