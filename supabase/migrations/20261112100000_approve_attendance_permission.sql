begin;

alter table public.secretariat_attendance_permissions
  add column approved_at timestamptz,
  add column approved_by uuid references auth.users(id) on delete set null;

-- Keep legacy reviews resolvable, but route all new LPJs through the document workflow.
create function public.prevent_new_monitoring_lpj_review()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'lpj_review' and old.status is distinct from new.status then
    raise exception 'Ajukan LPJ melalui menu Proposal & LPJ.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.prevent_new_monitoring_lpj_review() from public, anon, authenticated;
create trigger prevent_new_monitoring_lpj_review_before
  before update of status on public.cssmora_program_cycles
  for each row execute function public.prevent_new_monitoring_lpj_review();

create function public.approve_cssmora_attendance_permission(p_permission_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_permission public.secretariat_attendance_permissions%rowtype;
  v_event_id uuid;
  v_approver uuid := auth.uid();
begin
  if v_approver is null or not public.is_secretariat_admin() then
    raise exception 'Hanya Sekretaris dapat mencatat izin.' using errcode = '42501';
  end if;

  select * into v_permission from public.secretariat_attendance_permissions
  where id = p_permission_id for update;
  if not found then
    raise exception 'Pengajuan izin tidak ditemukan.' using errcode = 'P0002';
  end if;

  select e.id into v_event_id
  from public.secretariat_attendance_events e
  join public.agenda a on a.id = e.agenda_id
  where a.id = v_permission.agenda_id and a.status = 'published'
  for share of a, e;
  if v_event_id is null then
    raise exception 'Agenda terbit atau daftar hadir kegiatan tidak ditemukan.' using errcode = 'P0002';
  end if;

  if v_permission.approved_at is not null then return v_event_id; end if;

  update public.secretariat_attendance_records
    set status = 'izin', reason = v_permission.reason, recorded_by = v_approver,
        updated_at = clock_timestamp()
    where event_id = v_event_id and member_id = v_permission.member_id
      and status in ('belum', 'alpa') and proof_path is null;
  if not found then
    raise exception 'Status anggota sudah dicatat, ada bukti kehadiran, atau nama tidak ada di roster. Periksa daftar hadir.' using errcode = 'P0001';
  end if;

  update public.secretariat_attendance_permissions
    set approved_at = clock_timestamp(), approved_by = v_approver
    where id = p_permission_id;

  return v_event_id;
end;
$$;

revoke all on function public.approve_cssmora_attendance_permission(uuid) from public, anon, authenticated;
grant execute on function public.approve_cssmora_attendance_permission(uuid) to authenticated;

commit;
