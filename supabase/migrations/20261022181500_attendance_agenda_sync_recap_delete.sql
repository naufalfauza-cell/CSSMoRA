alter table public.secretariat_attendance_events
  add column if not exists agenda_id uuid;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.secretariat_attendance_events'::regclass
      and conname = 'secretariat_attendance_events_agenda_id_fkey'
  ) then
    alter table public.secretariat_attendance_events
      add constraint secretariat_attendance_events_agenda_id_fkey
      foreign key (agenda_id) references public.agenda(id) on delete set null;
  end if;
end;
$migration$;

create unique index if not exists secretariat_attendance_events_agenda_id_key
  on public.secretariat_attendance_events (agenda_id)
  where agenda_id is not null;

-- Link only unambiguous legacy rows with an exact title and WIB date match.
with candidates as (
  select e.id as event_id, a.id as agenda_id,
    count(*) over (partition by e.id) as event_match_count,
    count(*) over (partition by a.id) as agenda_match_count
  from public.secretariat_attendance_events e
  join public.agenda a
    on lower(btrim(e.title)) = lower(btrim(a.title))
   and e.event_date = (a.starts_at at time zone 'Asia/Jakarta')::date
   and a.status = 'published'
  where e.agenda_id is null
)
update public.secretariat_attendance_events e
set agenda_id = c.agenda_id
from candidates c
where e.id = c.event_id
  and c.event_match_count = 1
  and c.agenda_match_count = 1;

create or replace function public.guard_secretariat_attendance_agenda_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_agenda_status text;
begin
  if tg_op = 'DELETE' then
    if old.agenda_id is not null then
      select a.status into v_agenda_status
      from public.agenda a where a.id = old.agenda_id;
      if v_agenda_status = 'published' then
        raise exception 'Tarik agenda dari kalender sebelum menghapus data absensinya.';
      end if;
    end if;
    return old;
  end if;

  if new.agenda_id is null then
    -- Keep legacy rows readable for cleanup, but never allow standalone attendance.
    new.status := 'closed';
    return new;
  end if;

  select a.status into v_agenda_status
  from public.agenda a where a.id = new.agenda_id;
  if not found then
    raise exception 'Agenda sumber tidak ditemukan.';
  end if;
  if v_agenda_status <> 'published' then
    new.status := 'closed';
  end if;
  return new;
end;
$function$;

revoke all on function public.guard_secretariat_attendance_agenda_source() from public, anon, authenticated;

create trigger secretariat_attendance_agenda_source_guard
before insert or update or delete on public.secretariat_attendance_events
for each row execute function public.guard_secretariat_attendance_agenda_source();

create or replace function public.sync_published_agenda_to_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_id uuid;
begin
  if new.status <> 'published' then
    update public.secretariat_attendance_events
    set title = new.title,
        event_date = (new.starts_at at time zone 'Asia/Jakarta')::date,
        location = new.location,
        status = 'closed'
    where agenda_id = new.id;
    return new;
  end if;

  select e.id into v_event_id
  from public.secretariat_attendance_events e
  where e.agenda_id = new.id
  for update;

  if found then
    update public.secretariat_attendance_events
    set title = new.title,
        event_date = (new.starts_at at time zone 'Asia/Jakarta')::date,
        location = new.location
    where id = v_event_id;
    return new;
  end if;

  insert into public.secretariat_attendance_events
    (agenda_id, title, event_date, session_name, location, status, created_by)
  values
    (new.id, new.title, (new.starts_at at time zone 'Asia/Jakarta')::date,
     'Umum', new.location, 'closed', auth.uid())
  on conflict (agenda_id) where agenda_id is not null do nothing
  returning id into v_event_id;

  if v_event_id is null then
    select e.id into v_event_id
    from public.secretariat_attendance_events e
    where e.agenda_id = new.id;
  end if;

  insert into public.secretariat_attendance_records (event_id, member_id, status)
  select v_event_id, m.id, 'belum'
  from public.secretariat_members m
  where m.is_active = true
  on conflict (event_id, member_id) do nothing;

  return new;
end;
$function$;

revoke all on function public.sync_published_agenda_to_attendance() from public, anon, authenticated;

create trigger agenda_sync_secretariat_attendance
after insert or update of title, starts_at, ends_at, location, status on public.agenda
for each row execute function public.sync_published_agenda_to_attendance();

create or replace function public.close_attendance_when_agenda_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.secretariat_attendance_events
  set status = 'closed'
  where agenda_id = old.id;
  return old;
end;
$function$;

revoke all on function public.close_attendance_when_agenda_deleted() from public, anon, authenticated;

create trigger agenda_close_secretariat_attendance_before_delete
before delete on public.agenda
for each row execute function public.close_attendance_when_agenda_deleted();

-- Existing standalone test rows stay in the database for review or explicit deletion,
-- but a row without a published agenda can no longer accept check-ins.
update public.secretariat_attendance_events
set status = 'closed'
where agenda_id is null and status <> 'closed';

-- Published calendar entries get a closed roster; a secretary must open check-in explicitly.
with inserted_events as (
  insert into public.secretariat_attendance_events
    (agenda_id, title, event_date, session_name, location, status)
  select a.id, a.title, (a.starts_at at time zone 'Asia/Jakarta')::date,
         'Umum', a.location, 'closed'
  from public.agenda a
  where a.status = 'published'
    and coalesce(a.ends_at, a.starts_at) > statement_timestamp()
  on conflict (agenda_id) where agenda_id is not null do nothing
  returning id
)
insert into public.secretariat_attendance_records (event_id, member_id, status)
select e.id, m.id, 'belum'
from inserted_events e
cross join public.secretariat_members m
where m.is_active = true
on conflict (event_id, member_id) do nothing;

create or replace function public.get_secretariat_attendance_recap()
returns table (
  member_id uuid,
  nia text,
  full_name text,
  cohort smallint,
  attended_count integer,
  eligible_count integer,
  attendance_percent numeric,
  completed_event_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Akses sekretariat diperlukan.';
  end if;

  return query
  with completed_events as (
    select e.id
    from public.secretariat_attendance_events e
    join public.agenda a on a.id = e.agenda_id
    where a.status = 'published'
      and coalesce(a.ends_at, a.starts_at) <= statement_timestamp()
  ), member_counts as (
    select r.member_id,
      count(*) filter (where r.status = 'hadir')::integer as attended_count,
      count(*)::integer as eligible_count
    from public.secretariat_attendance_records r
    join completed_events e on e.id = r.event_id
    group by r.member_id
  ), event_total as (
    select count(*)::integer as total from completed_events
  )
  select m.id, m.nia, m.full_name, m.cohort,
    coalesce(c.attended_count, 0),
    coalesce(c.eligible_count, 0),
    case when coalesce(c.eligible_count, 0) = 0 then 0::numeric
      else round(c.attended_count::numeric * 100 / c.eligible_count, 1)
    end,
    event_total.total
  from public.secretariat_members m
  left join member_counts c on c.member_id = m.id
  cross join event_total
  order by m.full_name, m.nia;
end;
$function$;

revoke all on function public.get_secretariat_attendance_recap() from public, anon;
grant execute on function public.get_secretariat_attendance_recap() to authenticated;
