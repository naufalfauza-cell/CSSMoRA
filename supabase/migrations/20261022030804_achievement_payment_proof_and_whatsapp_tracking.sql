alter table public.cssmora_achievement_applications
  add column payment_proof_path text,
  add column payment_shared_at timestamptz;

alter table public.cssmora_achievement_applications
  add constraint cssmora_achievement_payment_proof_path_check
  check (
    payment_proof_path is null
    or payment_proof_path ~ (
      '^payments/' || id::text || '/payment-proof-[0-9]{13}[.](jpg|jpeg|png|pdf)$'
    )
  );

create policy "Achievement reviewers upload payment proofs"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'cssmora-prestasi-proofs'
  and name ~ '^payments/[0-9a-f-]{36}/payment-proof-[0-9]{13}[.](jpg|jpeg|png|pdf)$'
  and (
    (select public.cssmora_achievement_is_reviewer('bendahara'))
    or (select public.cssmora_achievement_is_reviewer('ketua'))
  )
);

create policy "Achievement reviewers remove payment proofs"
on storage.objects for delete to authenticated
using (
  bucket_id = 'cssmora-prestasi-proofs'
  and name ~ '^payments/[0-9a-f-]{36}/payment-proof-[0-9]{13}[.](jpg|jpeg|png|pdf)$'
  and (
    (select public.cssmora_achievement_is_reviewer('bendahara'))
    or (select public.cssmora_achievement_is_reviewer('ketua'))
  )
);

create or replace function public.set_cssmora_achievement_payment_proof(p_id uuid, p_path text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status text;
begin
  if auth.uid() is null then raise exception 'Login diperlukan.'; end if;
  if not (
    public.cssmora_achievement_is_reviewer('bendahara')
    or public.cssmora_achievement_is_reviewer('ketua')
  ) then raise exception 'Akun ini tidak berhak mengelola bukti pembayaran.'; end if;

  select a.status into v_status
  from public.cssmora_achievement_applications a
  where a.id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan.'; end if;
  if v_status <> 'approved' then raise exception 'Bukti pembayaran hanya dapat dilampirkan setelah pengajuan disetujui.'; end if;
  if p_path !~ ('^payments/' || p_id::text || '/payment-proof-[0-9]{13}[.](jpg|jpeg|png|pdf)$') then
    raise exception 'Lokasi bukti pembayaran tidak valid.';
  end if;

  update public.cssmora_achievement_applications
  set payment_proof_path=p_path, payment_shared_at=null
  where id=p_id;
end;
$function$;

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
  ) then raise exception 'Akun ini tidak berhak mengubah status berbagi.'; end if;

  update public.cssmora_achievement_applications
  set payment_shared_at=pg_catalog.now()
  where id=p_id and status='approved' and payment_proof_path is not null
  returning payment_shared_at into v_shared_at;
  if v_shared_at is null then raise exception 'Unggah bukti pembayaran sebelum menandai WhatsApp sudah dikirim.'; end if;
  return v_shared_at;
end;
$function$;

revoke all on function public.set_cssmora_achievement_payment_proof(uuid,text) from public, anon;
grant execute on function public.set_cssmora_achievement_payment_proof(uuid,text) to authenticated;
revoke all on function public.mark_cssmora_achievement_payment_shared(uuid) from public, anon;
grant execute on function public.mark_cssmora_achievement_payment_shared(uuid) to authenticated;
