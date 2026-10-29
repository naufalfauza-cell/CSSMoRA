-- A separate, private PDF signing workflow. Existing letter numbering and Drive archive remain untouched.
create table public.cssmora_letter_signature_requests (
  id uuid primary key default gen_random_uuid(),
  letter_id uuid not null references public.secretariat_letters(id) on delete restrict,
  signer_id uuid not null references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','pending','signed','rejected','cancelled')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  signed_at timestamptz,
  signed_by uuid references auth.users(id) on delete restrict,
  rejected_at timestamptz,
  rejected_by uuid references auth.users(id) on delete restrict,
  rejection_reason text,
  cancelled_at timestamptz,
  constraint cssmora_letter_signed_fields check (
    (status = 'signed' and signed_at is not null and signed_by = signer_id)
    or (status <> 'signed' and signed_at is null and signed_by is null)
  )
);
create unique index cssmora_letter_signature_one_active
  on public.cssmora_letter_signature_requests(letter_id)
  where status in ('draft','pending','signed');
create index cssmora_letter_signature_signer_queue
  on public.cssmora_letter_signature_requests(signer_id, status, created_at desc);
alter table public.cssmora_letter_signature_requests enable row level security;
revoke all on public.cssmora_letter_signature_requests from public, anon, authenticated;
grant select on public.cssmora_letter_signature_requests to authenticated;

-- SECURITY DEFINER checks the role table without relying on its own SELECT policy.
create function public.cssmora_is_letter_signer()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.cssmora_user_roles r
    where r.email = lower(btrim((select auth.jwt())->>'email'))
      and r.is_active and r.role in ('ketua','wakil')
  );
$$;
revoke all on function public.cssmora_is_letter_signer() from public, anon;
grant execute on function public.cssmora_is_letter_signer() to authenticated;

create policy "Secretariat and designated signer read signature requests"
on public.cssmora_letter_signature_requests for select to authenticated
using ((select public.is_secretariat_admin())
       or (signer_id = (select auth.uid()) and (select public.cssmora_is_letter_signer())));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('cssmora-letter-pdfs','cssmora-letter-pdfs',false,10485760,array['application/pdf']),
       ('cssmora-signer-assets','cssmora-signer-assets',false,2097152,array['image/png']);

-- Path is exactly <request UUID>/original.pdf or <request UUID>/signed.pdf.
-- No UPDATE/DELETE policy: a submitted source and final artifact cannot be replaced.
create policy "Secretary uploads original letter PDF"
on storage.objects for insert to authenticated
with check (bucket_id = 'cssmora-letter-pdfs' and exists (
  select 1 from public.cssmora_letter_signature_requests r
  where name = r.id::text || '/original.pdf'
    and r.status = 'draft' and r.created_by = (select auth.uid())
    and (select public.is_secretariat_admin())
));
create policy "Secretary or assigned signer reads original PDF"
on storage.objects for select to authenticated
using (bucket_id = 'cssmora-letter-pdfs' and exists (
  select 1 from public.cssmora_letter_signature_requests r
  where name = r.id::text || '/original.pdf'
    and ((select public.is_secretariat_admin())
      or (r.signer_id = (select auth.uid()) and (select public.cssmora_is_letter_signer())))
));
create policy "Designated signer uploads signed PDF"
on storage.objects for insert to authenticated
with check (bucket_id = 'cssmora-letter-pdfs' and (select public.cssmora_is_letter_signer())
  and exists (select 1 from public.cssmora_letter_signature_requests r
    join public.secretariat_letters l on l.id = r.letter_id
    where name = r.id::text || '/signed.pdf'
      and l.archive_status <> 'void' and r.status = 'pending' and r.signer_id = (select auth.uid())));
create policy "Secretary or assigned signer reads signed PDF"
on storage.objects for select to authenticated
using (bucket_id = 'cssmora-letter-pdfs' and exists (
  select 1 from public.cssmora_letter_signature_requests r
  where name = r.id::text || '/signed.pdf'
    and ((select public.is_secretariat_admin())
      or (r.signer_id = (select auth.uid()) and (select public.cssmora_is_letter_signer())))
));

-- Only the owning, currently active chair/deputy may see or update their raw marks.
create policy "Signer owns their private mark assets"
on storage.objects for select to authenticated
using (bucket_id = 'cssmora-signer-assets' and (select public.cssmora_is_letter_signer())
  and name in ((select auth.uid())::text || '/signature.png', (select auth.uid())::text || '/stamp.png'));
create policy "Signer uploads their private mark assets"
on storage.objects for insert to authenticated
with check (bucket_id = 'cssmora-signer-assets' and (select public.cssmora_is_letter_signer())
  and name in ((select auth.uid())::text || '/signature.png', (select auth.uid())::text || '/stamp.png'));
create policy "Signer updates their private mark assets"
on storage.objects for update to authenticated
using (bucket_id = 'cssmora-signer-assets' and (select public.cssmora_is_letter_signer())
  and name in ((select auth.uid())::text || '/signature.png', (select auth.uid())::text || '/stamp.png'))
with check (bucket_id = 'cssmora-signer-assets' and (select public.cssmora_is_letter_signer())
  and name in ((select auth.uid())::text || '/signature.png', (select auth.uid())::text || '/stamp.png'));

create function public.cssmora_letter_signers()
returns table(id uuid, email text) language sql stable security definer set search_path = '' as $$
  select distinct u.id, lower(u.email)::text
  from auth.users u join public.cssmora_user_roles r on r.email = lower(u.email)
  where (select public.is_secretariat_admin()) and r.is_active
    and r.role in ('ketua','wakil') and u.email_confirmed_at is not null
  order by 2;
$$;
revoke all on function public.cssmora_letter_signers() from public, anon;
grant execute on function public.cssmora_letter_signers() to authenticated;

create function public.cssmora_create_letter_signature_request(p_letter_id uuid, p_signer_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (select public.is_secretariat_admin()) then raise exception 'Akses sekretariat diperlukan.'; end if;
  if not exists (select 1 from public.secretariat_letters l where l.id = p_letter_id and l.archive_status <> 'void')
    then raise exception 'Surat tidak ditemukan atau dibatalkan.'; end if;
  if not exists (select 1 from auth.users u join public.cssmora_user_roles r
      on r.email = lower(u.email) and r.role in ('ketua','wakil') and r.is_active
      where u.id = p_signer_id and u.email_confirmed_at is not null)
    then raise exception 'Penandatangan tidak aktif.'; end if;
  insert into public.cssmora_letter_signature_requests(letter_id,signer_id,created_by)
  values(p_letter_id,p_signer_id,auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.cssmora_create_letter_signature_request(uuid,uuid) from public, anon;
grant execute on function public.cssmora_create_letter_signature_request(uuid,uuid) to authenticated;

create function public.cssmora_submit_letter_signature_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request public.cssmora_letter_signature_requests%rowtype;
begin
  select * into v_request from public.cssmora_letter_signature_requests
    where id=p_request_id for update;
  if not found or v_request.created_by is distinct from auth.uid()
    or not (select public.is_secretariat_admin()) or v_request.status <> 'draft'
    then raise exception 'Pengajuan tidak tersedia.'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='cssmora-letter-pdfs'
    and o.name=p_request_id::text||'/original.pdf' and o.metadata->>'mimetype'='application/pdf')
    then raise exception 'PDF asli belum terunggah.'; end if;
  update public.cssmora_letter_signature_requests set status='pending',submitted_at=now()
    where id=p_request_id;
end;
$$;
revoke all on function public.cssmora_submit_letter_signature_request(uuid) from public, anon;
grant execute on function public.cssmora_submit_letter_signature_request(uuid) to authenticated;

create function public.cssmora_finish_letter_signature_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_request public.cssmora_letter_signature_requests%rowtype;
begin
  select * into v_request from public.cssmora_letter_signature_requests
    where id=p_request_id for update;
  if not found or not (select public.cssmora_is_letter_signer())
    or v_request.signer_id is distinct from auth.uid() or v_request.status <> 'pending'
    then raise exception 'Hanya penandatangan yang ditunjuk dapat menyelesaikan pengajuan.'; end if;
  if not exists (select 1 from public.secretariat_letters l
    where l.id=v_request.letter_id and l.archive_status <> 'void')
    then raise exception 'Surat yang dibatalkan tidak dapat ditandatangani.'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id='cssmora-letter-pdfs'
    and o.name=p_request_id::text||'/signed.pdf' and o.metadata->>'mimetype'='application/pdf')
    then raise exception 'PDF hasil belum terunggah.'; end if;
  update public.cssmora_letter_signature_requests
    set status='signed',signed_at=now(),signed_by=auth.uid() where id=p_request_id;
end;
$$;
revoke all on function public.cssmora_finish_letter_signature_request(uuid) from public, anon;
grant execute on function public.cssmora_finish_letter_signature_request(uuid) to authenticated;

create function public.cssmora_reject_letter_signature_request(p_request_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.cssmora_is_letter_signer())
    or length(btrim(coalesce(p_reason,''))) not between 3 and 500
    then raise exception 'Penolakan memerlukan alasan dan penandatangan yang ditunjuk.'; end if;
  update public.cssmora_letter_signature_requests
    set status='rejected',rejected_at=now(),rejected_by=auth.uid(),rejection_reason=btrim(p_reason)
    where id=p_request_id and signer_id=auth.uid() and status='pending';
  if not found then raise exception 'Pengajuan tidak lagi tersedia.'; end if;
end;
$$;
revoke all on function public.cssmora_reject_letter_signature_request(uuid,text) from public, anon;
grant execute on function public.cssmora_reject_letter_signature_request(uuid,text) to authenticated;

create function public.cssmora_cancel_letter_signature_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.is_secretariat_admin()) then raise exception 'Akses sekretariat diperlukan.'; end if;
  update public.cssmora_letter_signature_requests
    set status='cancelled',cancelled_at=now()
    where id=p_request_id and status in ('draft','pending')
      and (created_by=auth.uid() or (select public.cssmora_is_letter_signer()));
  if not found then raise exception 'Pengajuan tidak lagi dapat dibatalkan.'; end if;
end;
$$;
revoke all on function public.cssmora_cancel_letter_signature_request(uuid) from public, anon;
grant execute on function public.cssmora_cancel_letter_signature_request(uuid) to authenticated;
