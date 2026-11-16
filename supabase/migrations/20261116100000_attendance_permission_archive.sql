begin;

alter table public.secretariat_attendance_permissions
  add column drive_file_id text,
  add column letter_deleted_at timestamptz;
grant update (drive_file_id, letter_deleted_at) on public.secretariat_attendance_permissions to service_role;

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
    and a.starts_at > clock_timestamp()
    and a.starts_at <= clock_timestamp() + interval '7 days'
  for share of a, e, m for no key update of r;

  if selected_agenda is null then return false; end if;
  insert into public.secretariat_attendance_permissions (id, agenda_id, agenda_title, member_id, reason, letter_path)
  values (p_id, selected_agenda, selected_title, p_member_id, p_reason, p_id::text || '.pdf');
  return true;
end;
$$;

create function public.record_permission_in_attendance()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.secretariat_attendance_records r
     set status = 'izin', reason = new.reason, updated_at = clock_timestamp()
    from public.secretariat_attendance_events e
   where e.agenda_id = new.agenda_id and e.id = r.event_id
     and r.member_id = new.member_id and r.status = 'belum' and r.proof_path is null;
  if not found then
    raise exception 'Status kehadiran sudah tercatat.' using errcode = '23514';
  end if;
  new.approved_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.record_permission_in_attendance() from public, anon, authenticated;
create trigger record_permission_in_attendance
  before insert on public.secretariat_attendance_permissions
  for each row execute function public.record_permission_in_attendance();

commit;
