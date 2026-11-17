begin;
alter table public.secretariat_attendance_events add column permission_reopened boolean not null default false;

create or replace function public.record_cssmora_attendance_permission(
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
    and r.status = 'belum' and r.proof_path is null and m.is_active
    and a.status = 'published'
    and (e.permission_reopened or (a.starts_at > clock_timestamp() + interval '1 day'
      and a.starts_at <= clock_timestamp() + interval '7 days'))
  for share of a, e, m for no key update of r;
  if selected_agenda is null then return false; end if;
  insert into public.secretariat_attendance_permissions (id, agenda_id, agenda_title, member_id, reason, letter_path)
  values (p_id, selected_agenda, selected_title, p_member_id, p_reason, p_id::text || '.pdf');
  return true;
end;
$$;
commit;
