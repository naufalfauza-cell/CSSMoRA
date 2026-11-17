create or replace function public.get_secretariat_attendance_recap_izin()
returns table(member_id uuid, nia text, full_name text, cohort smallint, attended_count integer, eligible_count integer, attendance_percent numeric, completed_event_count integer, permission_count integer, permission_percent numeric)
language plpgsql stable security invoker set search_path = '' as $function$
begin
  if auth.uid() is null or not public.is_secretariat_viewer() then raise exception 'Akses sekretariat diperlukan.'; end if;
  return query
  with events as (
    select e.id,e.agenda_id,coalesce(a.ends_at,a.starts_at)<=statement_timestamp() as completed
    from public.secretariat_attendance_events e join public.agenda a on a.id=e.agenda_id where a.status='published'
  ), attendance as (
    select r.member_id,r.status,e.completed,
      (r.status='izin' and exists(select 1 from public.secretariat_attendance_permissions p where p.agenda_id=e.agenda_id and p.member_id=r.member_id and p.approved_at is not null and p.rejected_at is null)) as approved
    from public.secretariat_attendance_records r join events e on e.id=r.event_id
  ), counts as (
    select a.member_id,
      count(*) filter(where a.completed or a.approved)::integer as eligible,
      count(*) filter(where (a.completed and a.status='hadir') or a.approved)::integer as attended,
      count(*) filter(where a.approved)::integer as permissions
    from attendance a group by a.member_id
  ), totals as (select count(*)::integer as finished from events where completed)
  select m.id,m.nia,m.full_name,m.cohort,coalesce(c.attended,0),coalesce(c.eligible,0),
    case when coalesce(c.eligible,0)=0 then 0::numeric else round(c.attended::numeric*100/c.eligible,1) end,
    t.finished,coalesce(c.permissions,0),case when coalesce(c.eligible,0)=0 then 0::numeric else round(c.permissions::numeric*100/c.eligible,1) end
  from public.secretariat_members m left join counts c on c.member_id=m.id cross join totals t order by m.full_name,m.nia;
end;
$function$;
revoke all on function public.get_secretariat_attendance_recap_izin() from public, anon;
grant execute on function public.get_secretariat_attendance_recap_izin() to authenticated;
