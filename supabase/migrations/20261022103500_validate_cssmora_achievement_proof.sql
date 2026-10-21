create or replace function public.validate_cssmora_achievement_proof()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'cssmora-prestasi-proofs'
      and o.name = new.proof_path
  ) then
    raise exception 'Bukti pendaftaran belum berhasil diunggah.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_cssmora_achievement_proof() from public, anon, authenticated;

create trigger validate_cssmora_achievement_proof_before_insert
before insert on public.cssmora_achievement_applications
for each row execute function public.validate_cssmora_achievement_proof();
