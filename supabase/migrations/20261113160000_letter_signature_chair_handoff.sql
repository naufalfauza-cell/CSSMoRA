-- The Chair signs the immutable PDF produced by the Secretary.
alter table public.cssmora_letter_signature_requests
  add column source_request_id uuid references public.cssmora_letter_signature_requests(id) on delete restrict;

create unique index cssmora_letter_signature_one_active_root
  on public.cssmora_letter_signature_requests(letter_id)
  where source_request_id is null and status in ('draft','pending','signed');
create unique index cssmora_letter_signature_one_active_handoff
  on public.cssmora_letter_signature_requests(source_request_id)
  where source_request_id is not null and status in ('draft','pending','signed');
create index cssmora_letter_signature_source_request_idx
  on public.cssmora_letter_signature_requests(source_request_id)
  where source_request_id is not null;
drop index public.cssmora_letter_signature_one_active;

create function public.cssmora_letter_chair_signers()
returns table(id uuid, email text)
language sql stable security definer
set search_path = ''
as $$
  select u.id, lower(u.email)
  from auth.users u
  join public.cssmora_user_roles r on r.email=lower(u.email)
  where (select public.is_secretariat_admin())
    and r.role='ketua' and r.is_active
    and u.email_confirmed_at is not null
    and u.id<>(select auth.uid())
  order by 2;
$$;
revoke all on function public.cssmora_letter_chair_signers() from public, anon;
grant execute on function public.cssmora_letter_chair_signers() to authenticated;

create function public.cssmora_forward_signed_letter_to_chair(p_source_request_id uuid, p_chair_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_source public.cssmora_letter_signature_requests%rowtype;
  v_existing public.cssmora_letter_signature_requests%rowtype;
  v_id uuid;
begin
  if not (select public.is_secretariat_admin()) then
    raise exception 'Hanya Sekretaris yang dapat meneruskan surat ke Ketua.';
  end if;

  select * into v_source
  from public.cssmora_letter_signature_requests
  where id=p_source_request_id
  for update;
  if not found or v_source.status<>'signed' or v_source.source_request_id is not null
    or v_source.signed_by is distinct from (select auth.uid()) then
    raise exception 'Tandatangani PDF sebagai Sekretaris sebelum meneruskannya.';
  end if;

  perform 1 from public.secretariat_letters l
    where l.id=v_source.letter_id and l.archive_status<>'void' for share;
  if not found then
    raise exception 'Surat tidak ditemukan atau dibatalkan.';
  end if;
  if not exists (select 1 from public.cssmora_letter_chair_signers() c where c.id=p_chair_id) then
    raise exception 'Pilih akun Ketua yang aktif.';
  end if;

  select * into v_existing
  from public.cssmora_letter_signature_requests
  where source_request_id=v_source.id and status in ('draft','pending','signed');
  if found then
    if v_existing.signer_id=p_chair_id then return v_existing.id; end if;
    raise exception 'Surat ini sudah diteruskan ke Ketua.';
  end if;
  if not exists (
    select 1 from storage.objects o where o.bucket_id='cssmora-letter-pdfs'
      and o.name=v_source.id::text||'/signed.pdf' and o.metadata->>'mimetype'='application/pdf'
  ) then
    raise exception 'PDF yang ditandatangani Sekretaris belum tersedia.';
  end if;

  insert into public.cssmora_letter_signature_requests
    (letter_id,signer_id,created_by,status,submitted_at,source_request_id)
  values (v_source.letter_id,p_chair_id,auth.uid(),'pending',now(),v_source.id)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cssmora_forward_signed_letter_to_chair(uuid,uuid) from public, anon;
grant execute on function public.cssmora_forward_signed_letter_to_chair(uuid,uuid) to authenticated;
