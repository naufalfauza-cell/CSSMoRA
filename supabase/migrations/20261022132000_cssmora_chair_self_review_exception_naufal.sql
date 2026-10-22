create or replace function public.review_cssmora_achievement_application(
  p_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path to ''
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

  select * into v_app
  from public.cssmora_achievement_applications a
  where a.id = p_id
  for update;
  if not found then raise exception 'Pengajuan tidak ditemukan.'; end if;

  if v_app.status = 'pending_bendahara' then
    if not exists (
      select 1 from public.cssmora_achievement_reviewers r
      where r.email = v_email and r.role = 'bendahara' and r.is_active
    ) then
      raise exception 'Akun ini tidak ditugaskan sebagai peninjau Bendahara.';
    end if;
    v_role := 'bendahara';
  elsif v_app.status = 'pending_ketua' then
    if not exists (
      select 1 from public.cssmora_achievement_reviewers r
      where r.email = v_email and r.role = 'ketua' and r.is_active
    ) then
      raise exception 'Akun ini tidak ditugaskan sebagai peninjau Ketua.';
    end if;
    if v_app.treasurer_email = v_email
       and v_email <> 'naufal.almaroqi@gmail.com' then
      raise exception 'Bendahara dan Ketua harus menjadi dua peninjau yang berbeda.';
    end if;
    v_role := 'ketua';
  else
    raise exception 'Pengajuan ini sudah selesai ditinjau.';
  end if;

  if v_role = 'bendahara' then
    v_new_status := case p_decision when 'approved' then 'pending_ketua' else 'rejected' end;
    update public.cssmora_achievement_applications set
      status=v_new_status,
      treasurer_email=v_email,
      treasurer_decision=p_decision,
      treasurer_note=nullif(btrim(p_note),''),
      treasurer_reviewed_at=pg_catalog.now()
    where id=p_id;
  else
    v_new_status := case p_decision when 'approved' then 'approved' else 'rejected' end;
    update public.cssmora_achievement_applications set
      status=v_new_status,
      chair_email=v_email,
      chair_decision=p_decision,
      chair_note=nullif(btrim(p_note),''),
      chair_reviewed_at=pg_catalog.now()
    where id=p_id;
  end if;
  return v_new_status;
end;
$function$;
