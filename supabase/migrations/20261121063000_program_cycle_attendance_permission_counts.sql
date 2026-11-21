create function public.get_cssmora_program_cycle_attendance_with_permissions(p_cycle_id uuid)
returns table (
  agenda_id uuid,
  agenda_title text,
  starts_at timestamptz,
  eligible_count bigint,
  present_count bigint,
  permission_count bigint
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
  select recap.agenda_id, recap.agenda_title, recap.starts_at,
    recap.eligible_count, recap.present_count, permissions.permission_count
  from public.get_cssmora_program_cycle_attendance(p_cycle_id) as recap
  cross join lateral (
    select pg_catalog.count(r.member_id) as permission_count
    from public.secretariat_attendance_events e
    join public.secretariat_attendance_records r on r.event_id = e.id
    where e.agenda_id = recap.agenda_id and r.status = 'izin'
  ) as permissions
  order by recap.starts_at;
end;
$function$;

revoke all on function public.get_cssmora_program_cycle_attendance_with_permissions(uuid) from public, anon, authenticated;
grant execute on function public.get_cssmora_program_cycle_attendance_with_permissions(uuid) to authenticated;

notify pgrst, 'reload schema';
