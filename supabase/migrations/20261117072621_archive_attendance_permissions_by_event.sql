create function public.archive_cssmora_attendance_permission_event(p_agenda_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Hanya Sekretaris dapat mengarsipkan pengajuan.' using errcode = '42501';
  end if;
  if p_agenda_id is null then
    raise exception 'Kegiatan tidak ditemukan.' using errcode = '22023';
  end if;
  perform 1 from public.secretariat_attendance_permissions
   where agenda_id = p_agenda_id and review_archived_at is null for update;
  if exists (select 1 from public.secretariat_attendance_permissions
      where agenda_id = p_agenda_id and review_archived_at is null
        and approved_at is null and rejected_at is null) then
    raise exception 'Tinjau semua pengajuan sebelum mengarsipkan kegiatan.' using errcode = '23514';
  end if;
  update public.secretariat_attendance_permissions
     set review_archived_at = clock_timestamp(), review_archived_by = auth.uid()
   where agenda_id = p_agenda_id and review_archived_at is null;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'Tidak ada pengajuan aktif untuk kegiatan ini.' using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;
revoke all on function public.archive_cssmora_attendance_permission_event(uuid) from public, anon, authenticated;
grant execute on function public.archive_cssmora_attendance_permission_event(uuid) to authenticated;
