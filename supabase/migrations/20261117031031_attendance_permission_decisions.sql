begin;
alter table public.secretariat_attendance_permissions add column rejected_at timestamptz, add column rejected_by uuid;

create or replace function public.approve_cssmora_attendance_permission(p_permission_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_permission public.secretariat_attendance_permissions%rowtype;
  v_event_id uuid;
  v_approver uuid := auth.uid();
begin
  if v_approver is null or not public.is_secretariat_admin() then
    raise exception 'Hanya Sekretaris dapat mencatat izin.' using errcode = '42501';
  end if;
  select * into v_permission from public.secretariat_attendance_permissions where id = p_permission_id for update;
  if not found then raise exception 'Pengajuan izin tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_permission.rejected_at is not null then raise exception 'Pengajuan sudah ditolak.' using errcode = '23514'; end if;
  select e.id into v_event_id from public.secretariat_attendance_events e
  join public.agenda a on a.id=e.agenda_id where a.id=v_permission.agenda_id and a.status='published' for share of a,e;
  if v_event_id is null then raise exception 'Agenda atau daftar hadir tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_permission.approved_at is not null then return v_event_id; end if;
  update public.secretariat_attendance_records set status='izin',reason=v_permission.reason,recorded_by=v_approver,updated_at=clock_timestamp()
    where event_id=v_event_id and member_id=v_permission.member_id and status in ('belum','alpa') and proof_path is null;
  if not found then raise exception 'Status kehadiran sudah dicatat atau anggota tidak ditemukan.' using errcode = 'P0001'; end if;
  update public.secretariat_attendance_permissions set approved_at=clock_timestamp(),approved_by=v_approver where id=p_permission_id;
  return v_event_id;
end;
$$;

create function public.reject_cssmora_attendance_permission(p_permission_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_permission public.secretariat_attendance_permissions%rowtype;
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Hanya Sekretaris dapat menolak izin.' using errcode = '42501';
  end if;
  select * into v_permission from public.secretariat_attendance_permissions where id=p_permission_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_permission.approved_at is not null then raise exception 'Pengajuan sudah disetujui.' using errcode = '23514'; end if;
  if v_permission.rejected_at is null then
    update public.secretariat_attendance_permissions set rejected_at=clock_timestamp(),rejected_by=auth.uid() where id=p_permission_id;
  end if;
end;
$$;
revoke all on function public.reject_cssmora_attendance_permission(uuid) from public,anon,authenticated;
grant execute on function public.reject_cssmora_attendance_permission(uuid) to authenticated;

create or replace function public.record_cssmora_attendance_permission(p_id uuid,p_event_id uuid,p_member_id uuid,p_reason text)
returns boolean language plpgsql set search_path = '' as $$
declare selected_agenda uuid; selected_title text;
begin
  select a.id,a.title into selected_agenda,selected_title from public.agenda a
  join public.secretariat_attendance_events e on e.agenda_id=a.id
  join public.secretariat_attendance_records r on r.event_id=e.id
  join public.secretariat_members m on m.id=r.member_id
  where e.id=p_event_id and r.member_id=p_member_id and r.status='belum' and r.proof_path is null and m.is_active
    and a.status='published' and a.starts_at > clock_timestamp() + interval '1 day'
    and a.starts_at <= clock_timestamp() + interval '7 days'
  for share of a,e,m for no key update of r;
  if selected_agenda is null then return false; end if;
  insert into public.secretariat_attendance_permissions(id,agenda_id,agenda_title,member_id,reason,letter_path)
  values(p_id,selected_agenda,selected_title,p_member_id,p_reason,p_id::text||'.pdf');
  return true;
end;
$$;
commit;
