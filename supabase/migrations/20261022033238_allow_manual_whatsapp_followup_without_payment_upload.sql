create or replace function public.mark_cssmora_achievement_payment_shared(p_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_shared_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Login diperlukan.'; end if;
  if not (
    public.cssmora_achievement_is_reviewer('bendahara')
    or public.cssmora_achievement_is_reviewer('ketua')
  ) then raise exception 'Akun ini tidak berhak mengubah status pesan.'; end if;

  update public.cssmora_achievement_applications
  set payment_shared_at=pg_catalog.now()
  where id=p_id and status='approved'
  returning payment_shared_at into v_shared_at;

  if v_shared_at is null then raise exception 'Pengajuan belum berstatus disetujui.'; end if;
  return v_shared_at;
end;
$function$;
