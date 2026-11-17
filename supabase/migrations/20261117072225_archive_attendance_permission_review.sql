alter table public.secretariat_attendance_permissions
  add column review_archived_at timestamptz,
  add column review_archived_by uuid references auth.users(id);

create function public.archive_cssmora_attendance_permission(p_permission_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_secretariat_admin() then
    raise exception 'Hanya Sekretaris dapat mengarsipkan pengajuan.' using errcode = '42501';
  end if;
  update public.secretariat_attendance_permissions
     set review_archived_at = coalesce(review_archived_at, clock_timestamp()),
         review_archived_by = coalesce(review_archived_by, auth.uid())
   where id = p_permission_id and (approved_at is not null or rejected_at is not null);
  if not found then
    raise exception 'Pengajuan tidak ditemukan atau belum ditinjau.' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function public.archive_cssmora_attendance_permission(uuid) from public, anon, authenticated;
grant execute on function public.archive_cssmora_attendance_permission(uuid) to authenticated;
