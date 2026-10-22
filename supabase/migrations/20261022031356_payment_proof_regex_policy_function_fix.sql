drop policy "Achievement reviewers upload payment proofs" on storage.objects;
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
drop policy "Achievement reviewers remove payment proofs" on storage.objects;
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
  set payment_proof_path=p_path, payment_shared_at=null where id=p_id;
end;
$function$;
