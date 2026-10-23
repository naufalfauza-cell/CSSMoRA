-- Additive program-cycle tracking, LPJ review history, and aggregate agenda recap.
-- Financial entries remain in AkunPro; this schema stores only a reference URL.

create table public.cssmora_program_cycles (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.agenda_programs(id) on delete restrict,
  period_label text not null check (length(btrim(period_label)) between 4 and 24),
  period_start date,
  period_end date,
  status text not null default 'planning'
    check (status in ('planning','ongoing','lpj_review','revision','completed')),
  lpj_due_date date,
  akunpro_url text check (akunpro_url is null or akunpro_url ~ '^https://[^[:space:]]+$'),
  lpj_summary text not null default '' check (length(lpj_summary) <= 5000),
  output_summary text not null default '' check (length(output_summary) <= 2000),
  lesson_learned text not null default '' check (length(lesson_learned) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (program_id, period_label),
  check (period_start is null or period_end is null or period_end >= period_start)
);
create index cssmora_program_cycles_status_deadline_idx
  on public.cssmora_program_cycles (status, lpj_due_date);
create index cssmora_program_cycles_program_period_idx
  on public.cssmora_program_cycles (program_id, period_label);
alter table public.cssmora_program_cycles enable row level security;
revoke all on public.cssmora_program_cycles from public, anon;
grant select on public.cssmora_program_cycles to authenticated;
grant insert (program_id, period_label, period_start, period_end, status, lpj_due_date, akunpro_url, lpj_summary, output_summary, lesson_learned)
  on public.cssmora_program_cycles to authenticated;
grant update (period_start, period_end, status, lpj_due_date, akunpro_url, lpj_summary, output_summary, lesson_learned)
  on public.cssmora_program_cycles to authenticated;

create policy "CSSMoRA program roles read cycles"
on public.cssmora_program_cycles for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "CSSMoRA program roles create cycles"
on public.cssmora_program_cycles for insert to authenticated
with check (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "CSSMoRA program roles update cycles"
on public.cssmora_program_cycles for update to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
)
with check (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);

create table public.cssmora_program_milestones (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cssmora_program_cycles(id) on delete restrict,
  title text not null check (length(btrim(title)) between 2 and 180),
  due_date date not null,
  status text not null default 'pending' check (status in ('pending','in_progress','completed')),
  completion_note text not null default '' check (length(completion_note) <= 1000),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);
create index cssmora_program_milestones_cycle_due_idx
  on public.cssmora_program_milestones (cycle_id, due_date, position);
alter table public.cssmora_program_milestones enable row level security;
revoke all on public.cssmora_program_milestones from public, anon;
grant select, delete on public.cssmora_program_milestones to authenticated;
grant insert (cycle_id, title, due_date, status, completion_note, position)
  on public.cssmora_program_milestones to authenticated;
grant update (title, due_date, status, completion_note, position)
  on public.cssmora_program_milestones to authenticated;

create policy "CSSMoRA program roles manage milestones"
on public.cssmora_program_milestones for all to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
)
with check (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);

create table public.cssmora_program_cycle_history (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cssmora_program_cycles(id) on delete restrict,
  action text not null check (action in ('status_updated','lpj_submitted','lpj_approved','lpj_revision_requested')),
  from_status text not null,
  to_status text not null,
  note text not null default '' check (length(note) <= 2000),
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null check (actor_role in ('ketua','wakil','bph_departemen')),
  created_at timestamptz not null default now()
);
create index cssmora_program_cycle_history_cycle_created_idx
  on public.cssmora_program_cycle_history (cycle_id, created_at desc);
alter table public.cssmora_program_cycle_history enable row level security;
revoke all on public.cssmora_program_cycle_history from public, anon, authenticated;
grant select on public.cssmora_program_cycle_history to authenticated;
create policy "CSSMoRA program roles read cycle history"
on public.cssmora_program_cycle_history for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);

create or replace function public.guard_cssmora_program_cycle_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_leadership boolean :=
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil'));
  v_program_manager boolean := v_leadership or (select public.cssmora_user_has_role('bph_departemen'));
begin
  if auth.uid() is null or not v_program_manager then
    raise exception 'Akses pengelola proker diperlukan.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('planning','ongoing') then
      raise exception 'Siklus baru harus berstatus rencana atau berjalan.' using errcode = '23514';
    end if;
    new.created_by := auth.uid();
  else
    if old.status = 'completed' then
      raise exception 'LPJ yang sudah disetujui tidak dapat diubah.' using errcode = '23514';
    end if;
    if new.status in ('completed','revision')
      and coalesce(pg_catalog.current_setting('cssmora.lpj_review_action', true), '') <> '1' then
      raise exception 'Status LPJ hanya dapat diubah melalui proses peninjauan.' using errcode = '42501';
    end if;
    if old.status = 'lpj_review' and new.status is distinct from old.status
      and new.status not in ('completed','revision') then
      raise exception 'LPJ yang sedang ditinjau hanya dapat disetujui atau diminta revisi.' using errcode = '42501';
    end if;
    if old.status = 'lpj_review' and (
      new.period_start is distinct from old.period_start or
      new.period_end is distinct from old.period_end or
      new.lpj_due_date is distinct from old.lpj_due_date or
      new.akunpro_url is distinct from old.akunpro_url or
      new.lpj_summary is distinct from old.lpj_summary or
      new.output_summary is distinct from old.output_summary or
      new.lesson_learned is distinct from old.lesson_learned
    ) then
      raise exception 'Isi LPJ terkunci selama proses peninjauan.' using errcode = '42501';
    end if;
    if not v_leadership and new.status not in ('planning','ongoing','lpj_review') then
      raise exception 'Status tersebut hanya dapat ditetapkan Ketua atau Wakil.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'lpj_review' and length(pg_catalog.btrim(new.lpj_summary)) < 30 then
    raise exception 'Lengkapi ringkasan LPJ sebelum dikirim untuk ditinjau.' using errcode = '23514';
  end if;
  new.updated_at := pg_catalog.now();
  new.updated_by := auth.uid();
  return new;
end;
$function$;
revoke all on function public.guard_cssmora_program_cycle_write() from public, anon, authenticated;
create trigger guard_cssmora_program_cycle_write_before
before insert or update on public.cssmora_program_cycles
for each row execute function public.guard_cssmora_program_cycle_write();

create or replace function public.guard_cssmora_program_milestone_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cycle_id uuid;
  v_cycle_status text;
begin
  if tg_op = 'DELETE' then v_cycle_id := old.cycle_id; else v_cycle_id := new.cycle_id; end if;
  if auth.uid() is null or not (
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('bph_departemen'))
  ) then
    raise exception 'Akses pengelola proker diperlukan.' using errcode = '42501';
  end if;
  select c.status into v_cycle_status from public.cssmora_program_cycles c where c.id = v_cycle_id;
  if v_cycle_status is null then
    raise exception 'Siklus proker tidak ditemukan.' using errcode = 'P0002';
  end if;
  if v_cycle_status in ('lpj_review','completed') then
    raise exception 'Tahapan terkunci selama peninjauan atau setelah LPJ disetujui.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  new.updated_by := auth.uid();
  new.updated_at := pg_catalog.now();
  return new;
end;
$function$;
revoke all on function public.guard_cssmora_program_milestone_write() from public, anon, authenticated;
create trigger guard_cssmora_program_milestone_write_before
before insert or update or delete on public.cssmora_program_milestones
for each row execute function public.guard_cssmora_program_milestone_write();

create or replace function public.log_cssmora_program_cycle_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text;
  v_action text;
  v_note text := coalesce(pg_catalog.current_setting('cssmora.lpj_review_note', true), '');
begin
  if new.status is distinct from old.status then
    v_role := case
      when (select public.cssmora_user_has_role('ketua')) then 'ketua'
      when (select public.cssmora_user_has_role('wakil')) then 'wakil'
      when (select public.cssmora_user_has_role('bph_departemen')) then 'bph_departemen'
      else null
    end;
    v_action := case new.status
      when 'lpj_review' then 'lpj_submitted'
      when 'completed' then 'lpj_approved'
      when 'revision' then 'lpj_revision_requested'
      else 'status_updated'
    end;
    insert into public.cssmora_program_cycle_history
      (cycle_id, action, from_status, to_status, note, actor_id, actor_role)
    values
      (new.id, v_action, old.status, new.status, v_note, auth.uid(), coalesce(v_role,'bph_departemen'));
  end if;
  return new;
end;
$function$;
revoke all on function public.log_cssmora_program_cycle_status() from public, anon, authenticated;
create trigger log_cssmora_program_cycle_status_after
after update of status on public.cssmora_program_cycles
for each row execute function public.log_cssmora_program_cycle_status();

create or replace function public.review_cssmora_program_lpj(p_cycle_id uuid, p_decision text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_next_status text;
  v_note text := coalesce(nullif(pg_catalog.btrim(p_note), ''), '');
begin
  if auth.uid() is null or not (
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil'))
  ) then
    raise exception 'Persetujuan LPJ hanya dapat dilakukan Ketua atau Wakil.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved','revision_requested') then
    raise exception 'Keputusan peninjauan tidak valid.' using errcode = '22023';
  end if;
  if p_decision = 'revision_requested' and v_note = '' then
    raise exception 'Catatan revisi wajib diisi.' using errcode = '22023';
  end if;
  select c.status into v_status
  from public.cssmora_program_cycles c
  where c.id = p_cycle_id
  for update;
  if not found then
    raise exception 'Siklus proker tidak ditemukan.' using errcode = 'P0002';
  end if;
  if v_status <> 'lpj_review' then
    raise exception 'LPJ tidak sedang menunggu peninjauan.' using errcode = '23514';
  end if;
  v_next_status := case p_decision when 'approved' then 'completed' else 'revision' end;
  perform pg_catalog.set_config('cssmora.lpj_review_action', '1', true);
  perform pg_catalog.set_config('cssmora.lpj_review_note', v_note, true);
  update public.cssmora_program_cycles set status = v_next_status where id = p_cycle_id;
  return v_next_status;
end;
$function$;
revoke all on function public.review_cssmora_program_lpj(uuid,text,text) from public, anon, authenticated;
grant execute on function public.review_cssmora_program_lpj(uuid,text,text) to authenticated;

create or replace function public.get_cssmora_program_cycle_attendance(p_cycle_id uuid)
returns table (
  agenda_id uuid,
  agenda_title text,
  starts_at timestamptz,
  eligible_count bigint,
  present_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null or not (
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('bph_departemen'))
  ) then
    raise exception 'Akses rekap proker diperlukan.' using errcode = '42501';
  end if;
  return query
  select a.id, a.title, a.starts_at,
    pg_catalog.count(r.member_id)::bigint,
    pg_catalog.count(r.member_id) filter (where r.status = 'hadir')::bigint
  from public.cssmora_program_cycles c
  join public.agenda a on a.program_id = c.program_id and a.status = 'published'
  left join public.secretariat_attendance_events e on e.agenda_id = a.id
  left join public.secretariat_attendance_records r on r.event_id = e.id
  where c.id = p_cycle_id
    and coalesce(a.ends_at, a.starts_at) <= pg_catalog.statement_timestamp()
    and (c.period_start is null or (a.starts_at at time zone 'Asia/Jakarta')::date >= c.period_start)
    and (c.period_end is null or (a.starts_at at time zone 'Asia/Jakarta')::date <= c.period_end)
  group by a.id, a.title, a.starts_at
  order by a.starts_at;
end;
$function$;
revoke all on function public.get_cssmora_program_cycle_attendance(uuid) from public, anon, authenticated;
grant execute on function public.get_cssmora_program_cycle_attendance(uuid) to authenticated;

notify pgrst, 'reload schema';
