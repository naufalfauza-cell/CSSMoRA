-- Separate operational authority from leadership visibility.
create or replace function public.is_secretariat_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select public.cssmora_user_has_role('sekretaris') $$;
create or replace function public.is_secretariat_viewer()
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_secretariat_admin() or public.cssmora_user_has_role('ketua') or public.cssmora_user_has_role('wakil') $$;
create or replace function public.cssmora_schedule_manager()
returns boolean language sql stable security definer set search_path=public
as $$ select public.cssmora_user_has_role('ketua') or public.cssmora_user_has_role('wakil') or public.cssmora_user_has_role('bph_departemen') or public.cssmora_user_has_role('sekretaris') or public.cssmora_user_has_role('bendahara') $$;

-- Leadership can inspect Secretariat data, while only Secretary can mutate it.
do $$
declare t text;
begin
  foreach t in array array['secretariat_members','secretariat_attendance_events','secretariat_attendance_records','secretariat_letters','secretariat_letter_counters'] loop
    execute format('drop policy if exists %I on public.%I', 'Secretariat roles manage '||case t when 'secretariat_members' then 'members' when 'secretariat_attendance_events' then 'attendance events' when 'secretariat_attendance_records' then 'attendance records' when 'secretariat_letters' then 'letters' else 'letter counters' end, t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_secretariat_viewer())','Secretariat viewers read '||t,t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_secretariat_admin()) with check (public.is_secretariat_admin())','Secretary manages '||t,t);
  end loop;
end $$;

drop policy if exists "Secretariat and designated signer read signature requests" on public.cssmora_letter_signature_requests;
create policy "Secretariat and designated signer read signature requests" on public.cssmora_letter_signature_requests for select to authenticated using (public.is_secretariat_viewer() or (signer_id=(select auth.uid()) and (select public.cssmora_is_letter_signer())));

-- Schedule and nonfinancial competition / achievement records are shared among officers.
drop policy if exists "Agenda roles insert" on public.agenda;
drop policy if exists "Agenda roles update" on public.agenda;
drop policy if exists "Agenda roles delete" on public.agenda;
drop policy if exists "Agenda authorized read" on public.agenda;
create policy "Agenda authorized read" on public.agenda for select using (status='published' or (select public.cssmora_schedule_manager()));
create policy "Agenda roles insert" on public.agenda for insert with check ((select public.cssmora_schedule_manager()));
create policy "Agenda roles update" on public.agenda for update using ((select public.cssmora_schedule_manager())) with check ((select public.cssmora_schedule_manager()));
create policy "Agenda roles delete" on public.agenda for delete using ((select public.cssmora_schedule_manager()));

drop policy if exists "Agenda programs roles insert" on public.agenda_programs;
drop policy if exists "Agenda programs roles update" on public.agenda_programs;
drop policy if exists "Agenda programs roles delete" on public.agenda_programs;
create policy "Agenda programs roles insert" on public.agenda_programs for insert with check ((select public.cssmora_schedule_manager()));
create policy "Agenda programs roles update" on public.agenda_programs for update using ((select public.cssmora_schedule_manager())) with check ((select public.cssmora_schedule_manager()));
create policy "Agenda programs roles delete" on public.agenda_programs for delete using ((select public.cssmora_schedule_manager()));

drop policy if exists "Competition roles insert" on public.competitions;
drop policy if exists "Competition roles update" on public.competitions;
drop policy if exists "Competition roles delete" on public.competitions;
drop policy if exists "Competition authorized read" on public.competitions;
create policy "Competition authorized read" on public.competitions for select using (status='published' or (select public.cssmora_schedule_manager()));
create policy "Competition roles insert" on public.competitions for insert with check ((select public.cssmora_schedule_manager()));
create policy "Competition roles update" on public.competitions for update using ((select public.cssmora_schedule_manager())) with check ((select public.cssmora_schedule_manager()));
create policy "Competition roles delete" on public.competitions for delete using ((select public.cssmora_schedule_manager()));

drop policy if exists "CSSMoRA organization roles read achievement records" on public.cssmora_achievement_records;
create policy "CSSMoRA organization roles read achievement records" on public.cssmora_achievement_records for select to authenticated using ((select public.cssmora_schedule_manager()));
drop policy if exists "CSSMoRA organization roles read achievement record members" on public.cssmora_achievement_record_members;
create policy "CSSMoRA organization roles read achievement record members" on public.cssmora_achievement_record_members for select to authenticated using ((select public.cssmora_schedule_manager()));

-- A chair/vice chair cannot occupy the Treasurer review stage.
update public.cssmora_achievement_reviewers r set is_active=false
where r.role='bendahara' and exists (
 select 1 from public.cssmora_user_roles u where lower(u.email)=lower(r.email) and u.is_active and u.role in ('ketua','wakil')
);
