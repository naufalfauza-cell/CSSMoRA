-- Keep a person with Ketua/Wakil authority out of the Bendahara approval stage.
create or replace function public.sync_cssmora_legacy_roles()
returns trigger language plpgsql security definer
set search_path = ''
as $function$
declare
  v_email text;
begin
  if tg_op = 'DELETE' then v_email := old.email; else v_email := new.email; end if;

  if exists (
    select 1 from public.cssmora_user_roles r
    where r.email=v_email and r.is_active and r.role in ('ketua','wakil','bph_departemen')
  ) then
    insert into public.competition_admins(email) values(v_email) on conflict(email) do nothing;
  else
    delete from public.competition_admins where email=v_email;
  end if;

  if exists (
    select 1 from public.cssmora_user_roles r
    where r.email=v_email and r.is_active and r.role in ('ketua','wakil','sekretaris')
  ) then
    insert into public.secretariat_admins(email,created_by) values(v_email,auth.uid()) on conflict(email) do nothing;
  else
    delete from public.secretariat_admins where email=v_email;
  end if;

  delete from public.cssmora_achievement_reviewers r
  where r.email=v_email and not exists (
    select 1 from public.cssmora_user_roles u
    where u.email=v_email and u.is_active and (
      (r.role='ketua' and u.role in ('ketua','wakil'))
      or (r.role='bendahara' and u.role='bendahara'
          and not exists (select 1 from public.cssmora_user_roles lead
            where lead.email=v_email and lead.is_active and lead.role in ('ketua','wakil')))
      or (r.role not in ('ketua','bendahara') and u.role=r.role)
    )
  );

  insert into public.cssmora_achievement_reviewers(email,role,is_active)
  select v_email, assignments.role, true
  from (
    select distinct caps.role
    from public.cssmora_user_roles u
    cross join lateral (
      select 'ketua'::text as role where u.role in ('ketua','wakil')
      union
      select 'bendahara'::text where u.role='bendahara'
        and not exists (select 1 from public.cssmora_user_roles lead
          where lead.email=v_email and lead.is_active and lead.role in ('ketua','wakil'))
    ) caps
    where u.email=v_email and u.is_active
  ) assignments
  on conflict(email,role) do update set is_active=true;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

update public.cssmora_achievement_reviewers r
set is_active=false
where r.role='bendahara'
  and exists (select 1 from public.cssmora_user_roles u
    where u.email=r.email and u.is_active and u.role in ('ketua','wakil'));

create or replace function public.review_cssmora_achievement_application(
  p_id uuid, p_decision text, p_note text default null
)
returns text language plpgsql security definer
set search_path = ''
as $function$
declare
  v_email text := lower(btrim(auth.jwt()->>'email'));
  v_role text;
  v_app public.cssmora_achievement_applications%rowtype;
  v_new_status text;
begin
  if auth.uid() is null then raise exception 'Login diperlukan.'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Keputusan tidak valid.'; end if;
  if length(coalesce(p_note,'')) > 1000 then raise exception 'Catatan maksimal 1000 karakter.'; end if;

  select * into v_app from public.cssmora_achievement_applications a
  where a.id=p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan.'; end if;

  if v_app.status='pending_bendahara' then
    if public.cssmora_user_has_role('ketua') or public.cssmora_user_has_role('wakil') then
      raise exception 'Ketua/Wakil tidak dapat mengambil tahap persetujuan Bendahara.';
    end if;
    if not exists (select 1 from public.cssmora_achievement_reviewers r
      where r.email=v_email and r.role='bendahara' and r.is_active) then
      raise exception 'Akun ini tidak ditugaskan sebagai peninjau Bendahara.';
    end if;
    v_role:='bendahara';
  elsif v_app.status='pending_ketua' then
    if not exists (select 1 from public.cssmora_achievement_reviewers r
      where r.email=v_email and r.role='ketua' and r.is_active) then
      raise exception 'Akun ini tidak ditugaskan sebagai peninjau Ketua.';
    end if;
    if v_app.treasurer_email=v_email then
      raise exception 'Bendahara dan Ketua harus menjadi dua peninjau yang berbeda.';
    end if;
    v_role:='ketua';
  else
    raise exception 'Pengajuan ini sudah selesai ditinjau.';
  end if;

  if v_role='bendahara' then
    v_new_status:=case p_decision when 'approved' then 'pending_ketua' else 'rejected' end;
    update public.cssmora_achievement_applications set
      status=v_new_status, treasurer_email=v_email, treasurer_decision=p_decision,
      treasurer_note=nullif(btrim(p_note),''), treasurer_reviewed_at=pg_catalog.now()
    where id=p_id;
  else
    v_new_status:=case p_decision when 'approved' then 'approved' else 'rejected' end;
    update public.cssmora_achievement_applications set
      status=v_new_status, chair_email=v_email, chair_decision=p_decision,
      chair_note=nullif(btrim(p_note),''), chair_reviewed_at=pg_catalog.now()
    where id=p_id;
  end if;
  return v_new_status;
end;
$function$;

create or replace function public.review_cssmora_achievement_record(
  p_id uuid, p_decision text, p_note text default null
)
returns text language plpgsql security definer
set search_path = ''
as $function$
declare v_email text; v_status text;
begin
  if auth.uid() is null or not (
    public.cssmora_user_has_role('ketua') or
    public.cssmora_user_has_role('wakil') or
    public.cssmora_user_has_role('bph_departemen') or
    public.cssmora_user_has_role('sekretaris') or
    public.cssmora_user_has_role('bendahara')
  ) then raise exception 'Akses pengurus CSSMoRA diperlukan.'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then
    raise exception 'Keputusan peninjauan tidak valid.';
  end if;
  if p_decision='rejected' and nullif(btrim(p_note),'') is null then
    raise exception 'Tambahkan alasan jika prestasi ditolak.';
  end if;
  v_email:=lower(btrim(coalesce(auth.jwt()->>'email','')));
  update public.cssmora_achievement_records r
  set status=p_decision, review_note=nullif(btrim(p_note), ''),
      reviewed_by=v_email, reviewed_at=now()
  where r.id=p_id and r.status='pending'
  returning r.status into v_status;
  if v_status is null then raise exception 'Prestasi tidak ditemukan atau sudah ditinjau.'; end if;
  return v_status;
end;
$function$;

drop policy if exists "CSSMoRA reviewers read achievement certificates" on storage.objects;
create policy "CSSMoRA reviewers read achievement certificates"
on storage.objects for select to authenticated using (
  bucket_id='cssmora-achievement-certificates'
  and (
    public.cssmora_user_has_role('ketua') or public.cssmora_user_has_role('wakil')
    or public.cssmora_user_has_role('bph_departemen')
    or public.cssmora_user_has_role('sekretaris') or public.cssmora_user_has_role('bendahara')
  )
);

drop policy if exists cssmora_agenda_photo_upload on storage.objects;
create policy cssmora_agenda_photo_upload on storage.objects for insert to authenticated
with check (bucket_id='cssmora-agenda-programs' and public.cssmora_schedule_manager());
drop policy if exists cssmora_agenda_photo_delete on storage.objects;
create policy cssmora_agenda_photo_delete on storage.objects for delete to authenticated
using (bucket_id='cssmora-agenda-programs' and public.cssmora_schedule_manager());
