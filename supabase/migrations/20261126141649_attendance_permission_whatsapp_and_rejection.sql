begin;

alter table public.secretariat_attendance_permissions
  add column whatsapp_number text check (whatsapp_number ~ '^[1-9][0-9]{7,14}$'),
  add column rejection_reason_code text,
  add column rejection_note text,
  add constraint attendance_permission_rejection_reason_check check (
    (rejection_reason_code is null and rejection_note is null)
    or (
      rejected_at is not null and rejection_reason_code is not null and (
        (rejection_reason_code in ('invalid_proof', 'old_template', 'unreasonable_reason', 'permission_limit') and rejection_note is null)
        or (rejection_reason_code = 'other' and coalesce(length(btrim(rejection_note)), 0) between 1 and 500)
      )
    )
  );

create function public.reject_cssmora_attendance_permission(p_permission_id uuid, p_reason_code text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_permission public.secretariat_attendance_permissions%rowtype;
  v_note text := case when p_reason_code = 'other' then nullif(btrim(p_note), '') end;
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Hanya Sekretaris dapat menolak izin.' using errcode = '42501';
  end if;
  if p_reason_code is null or p_reason_code not in ('invalid_proof', 'old_template', 'unreasonable_reason', 'permission_limit', 'other') then
    raise exception 'Pilih alasan penolakan yang tersedia.' using errcode = '22023';
  end if;
  if p_reason_code = 'other' and coalesce(length(v_note), 0) not between 1 and 500 then
    raise exception 'Isi alasan penolakan, maksimal 500 karakter.' using errcode = '22023';
  end if;
  select * into v_permission from public.secretariat_attendance_permissions where id=p_permission_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan.' using errcode = 'P0002'; end if;
  if v_permission.approved_at is not null then raise exception 'Pengajuan sudah disetujui.' using errcode = '23514'; end if;
  if v_permission.rejected_at is null then
    update public.secretariat_attendance_permissions
    set rejected_at=clock_timestamp(), rejected_by=auth.uid(), rejection_reason_code=p_reason_code, rejection_note=v_note
    where id=p_permission_id;
  end if;
end;
$$;

revoke execute on function public.reject_cssmora_attendance_permission(uuid) from public, anon, authenticated;
revoke all on function public.reject_cssmora_attendance_permission(uuid,text,text) from public, anon, authenticated;
grant execute on function public.reject_cssmora_attendance_permission(uuid,text,text) to authenticated;

create function public.record_cssmora_attendance_permission(p_id uuid,p_event_id uuid,p_member_id uuid,p_reason text,p_whatsapp_number text)
returns boolean language plpgsql set search_path = '' as $$
declare selected_agenda uuid; selected_title text;
begin
  if p_whatsapp_number is null or p_whatsapp_number !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'Nomor WhatsApp tidak valid.' using errcode = '22023';
  end if;
  select a.id,a.title into selected_agenda,selected_title from public.agenda a
  join public.secretariat_attendance_events e on e.agenda_id=a.id
  join public.secretariat_attendance_records r on r.event_id=e.id
  join public.secretariat_members m on m.id=r.member_id
  where e.id=p_event_id and r.member_id=p_member_id and r.status='belum' and r.proof_path is null and m.is_active
    and a.status='published' and a.starts_at > clock_timestamp() + interval '1 day'
    and a.starts_at <= clock_timestamp() + interval '7 days'
  for share of a,e,m for no key update of r;
  if selected_agenda is null then return false; end if;
  insert into public.secretariat_attendance_permissions(id,agenda_id,agenda_title,member_id,reason,letter_path,whatsapp_number)
  values(p_id,selected_agenda,selected_title,p_member_id,p_reason,p_id::text||'.pdf',p_whatsapp_number);
  return true;
end;
$$;

revoke all on function public.record_cssmora_attendance_permission(uuid,uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_cssmora_attendance_permission(uuid,uuid,uuid,text,text) to service_role;

commit;
