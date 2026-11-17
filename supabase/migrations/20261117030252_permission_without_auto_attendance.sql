begin;

drop trigger if exists record_permission_in_attendance on public.secretariat_attendance_permissions;

update public.secretariat_attendance_records r
set status = 'belum', reason = null, recorded_by = null, updated_at = clock_timestamp()
from public.secretariat_attendance_permissions p
join public.secretariat_attendance_events e on e.agenda_id = p.agenda_id
where r.event_id = e.id and r.member_id = p.member_id
  and r.status = 'izin' and r.reason = p.reason and r.proof_path is null;

update public.secretariat_attendance_permissions
set approved_at = null, approved_by = null
where approved_at is not null or approved_by is not null;

commit;
