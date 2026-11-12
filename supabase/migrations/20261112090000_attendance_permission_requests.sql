begin;

create table public.secretariat_attendance_permissions (
  id uuid primary key,
  agenda_id uuid references public.agenda(id) on delete set null,
  agenda_title text not null,
  member_id uuid not null references public.secretariat_members(id) on delete restrict,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  letter_path text not null unique check (letter_path = id::text || '.pdf'),
  created_at timestamptz not null default now(),
  unique (agenda_id, member_id)
);
alter table public.secretariat_attendance_permissions enable row level security;
revoke all on public.secretariat_attendance_permissions from public, anon, authenticated;
grant select on public.secretariat_attendance_permissions to authenticated;
grant select, insert on public.secretariat_attendance_permissions to service_role;
create policy "Secretariat viewers read attendance permissions"
  on public.secretariat_attendance_permissions for select to authenticated
  using ((select public.is_secretariat_viewer()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attendance-permission-letters', 'attendance-permission-letters', false, 2097152, array['application/pdf']);
create policy "Secretariat viewers read permission letters"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'attendance-permission-letters'
    and (select public.is_secretariat_viewer())
    and exists (select 1 from public.secretariat_attendance_permissions p where p.letter_path = name)
  );

create function public.record_cssmora_attendance_permission(
  p_id uuid, p_event_id uuid, p_member_id uuid, p_reason text
)
returns boolean language plpgsql set search_path = '' as $$
declare
  selected_agenda uuid;
  selected_title text;
begin
  select a.id, a.title into selected_agenda, selected_title
  from public.agenda a
  join public.secretariat_attendance_events e on e.agenda_id = a.id
  join public.secretariat_attendance_records r on r.event_id = e.id
  join public.secretariat_members m on m.id = r.member_id
  where e.id = p_event_id and r.member_id = p_member_id
    and r.status = 'belum' and m.is_active
    and a.status = 'published'
    and a.starts_at > clock_timestamp()
    and a.starts_at <= clock_timestamp() + interval '7 days'
  for share of a, e, r, m;

  if selected_agenda is null then return false; end if;
  insert into public.secretariat_attendance_permissions (id, agenda_id, agenda_title, member_id, reason, letter_path)
  values (p_id, selected_agenda, selected_title, p_member_id, p_reason, p_id::text || '.pdf');
  return true;
end;
$$;
revoke all on function public.record_cssmora_attendance_permission(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_cssmora_attendance_permission(uuid, uuid, uuid, text) to service_role;

commit;
