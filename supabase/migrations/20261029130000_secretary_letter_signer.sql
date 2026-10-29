-- Add the Secretary as an eligible designated signer in the existing PDF signature workflow.
create or replace function public.cssmora_is_letter_signer()
returns boolean
language sql stable security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null and exists (
    select 1
    from public.cssmora_user_roles r
    where r.email = lower(btrim((select auth.jwt())->>'email'))
      and r.is_active
      and r.role in ('ketua','wakil','sekretaris')
  );
$function$;

create or replace function public.cssmora_letter_signers()
returns table(id uuid, email text)
language sql stable security definer
set search_path = ''
as $function$
  select distinct u.id, lower(u.email)::text
  from auth.users u
  join public.cssmora_user_roles r on r.email = lower(u.email)
  where (select public.is_secretariat_admin())
    and r.is_active
    and r.role in ('ketua','wakil','sekretaris')
    and u.email_confirmed_at is not null
  order by 2;
$function$;

create or replace function public.cssmora_create_letter_signature_request(p_letter_id uuid, p_signer_id uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $function$
declare v_id uuid;
begin
  if not (select public.is_secretariat_admin()) then
    raise exception 'Akses sekretariat diperlukan.';
  end if;
  if not exists (
    select 1 from public.secretariat_letters l
    where l.id = p_letter_id and l.archive_status <> 'void'
  ) then
    raise exception 'Surat tidak ditemukan atau dibatalkan.';
  end if;
  if not exists (
    select 1
    from auth.users u
    join public.cssmora_user_roles r
      on r.email = lower(u.email)
     and r.role in ('ketua','wakil','sekretaris')
     and r.is_active
    where u.id = p_signer_id and u.email_confirmed_at is not null
  ) then
    raise exception 'Penandatangan tidak aktif.';
  end if;
  insert into public.cssmora_letter_signature_requests(letter_id,signer_id,created_by)
  values (p_letter_id,p_signer_id,auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;
