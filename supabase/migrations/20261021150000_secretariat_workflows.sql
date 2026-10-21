create table public.secretariat_members (
  id uuid primary key default gen_random_uuid(),
  nia text not null unique check (length(btrim(nia)) between 3 and 40),
  full_name text not null check (length(btrim(full_name)) between 2 and 140),
  cohort smallint not null check (cohort between 2000 and 2100),
  faculty text,
  study_program text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index secretariat_members_name_idx on public.secretariat_members (lower(full_name));
create index secretariat_members_active_cohort_idx on public.secretariat_members (is_active, cohort);

create table public.secretariat_attendance_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 3 and 160),
  event_date date not null,
  session_name text not null default 'Umum' check (length(btrim(session_name)) between 1 and 100),
  location text,
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index secretariat_attendance_events_date_idx on public.secretariat_attendance_events (event_date desc);

create table public.secretariat_attendance_records (
  event_id uuid not null references public.secretariat_attendance_events(id) on delete cascade,
  member_id uuid not null references public.secretariat_members(id) on delete restrict,
  status text not null default 'belum' check (status in ('belum','hadir','izin','sakit','alpa')),
  reason text,
  recorded_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index secretariat_attendance_member_idx on public.secretariat_attendance_records (member_id, event_id);

create table public.secretariat_letters (
  id uuid primary key default gen_random_uuid(),
  year smallint not null,
  sequence_number integer not null check (sequence_number > 0),
  issued_on date not null,
  subject text not null check (length(btrim(subject)) between 3 and 240),
  scope_code text not null check (scope_code in ('i','e')),
  type_code text not null check (type_code ~ '^[A-Z0-9]{1,5}$'),
  department_code text not null check (department_code ~ '^[A-Z0-9.]{1,20}$'),
  letter_number text not null unique,
  recipient text,
  attachment_count smallint not null default 0 check (attachment_count between 0 and 99),
  archive_status text not null default 'pending' check (archive_status in ('pending','archived','void')),
  archive_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (year, sequence_number)
);
create index secretariat_letters_issued_on_idx on public.secretariat_letters (issued_on desc, sequence_number desc);

create table public.secretariat_letter_counters (
  year smallint primary key,
  last_number integer not null check (last_number >= 0),
  updated_at timestamptz not null default now()
);
insert into public.secretariat_letter_counters (year, last_number)
values (2026, 55)
on conflict (year) do nothing;

alter table public.secretariat_members enable row level security;
alter table public.secretariat_attendance_events enable row level security;
alter table public.secretariat_attendance_records enable row level security;
alter table public.secretariat_letters enable row level security;
alter table public.secretariat_letter_counters enable row level security;

create policy "CSSMoRA admins manage secretariat members" on public.secretariat_members for all to authenticated
using (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))))
with check (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))));
create policy "CSSMoRA admins manage secretariat attendance events" on public.secretariat_attendance_events for all to authenticated
using (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))))
with check (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))));
create policy "CSSMoRA admins manage secretariat attendance records" on public.secretariat_attendance_records for all to authenticated
using (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))))
with check (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))));
create policy "CSSMoRA admins manage secretariat letters" on public.secretariat_letters for all to authenticated
using (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))))
with check (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))));
create policy "CSSMoRA admins manage secretariat letter counters" on public.secretariat_letter_counters for all to authenticated
using (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))))
with check (exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))));

grant select, insert, update, delete on public.secretariat_members to authenticated;
grant select, insert, update, delete on public.secretariat_attendance_events to authenticated;
grant select, insert, update, delete on public.secretariat_attendance_records to authenticated;
grant select, insert, update, delete on public.secretariat_letters to authenticated;
grant select, insert, update on public.secretariat_letter_counters to authenticated;

create or replace function public.create_secretariat_attendance_event(p_title text, p_event_date date, p_session_name text default 'Umum', p_location text default null)
returns uuid language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_event_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))) then
    raise exception 'Akses admin CSSMoRA diperlukan.';
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
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_year smallint; v_seq integer; v_roman text; v_number text; v_id uuid;
begin
  if auth.uid() is null or not exists (select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))) then
    raise exception 'Akses admin CSSMoRA diperlukan.';
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
