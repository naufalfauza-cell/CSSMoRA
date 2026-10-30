begin;

-- Keep the program document editor aligned with the committee table format.
alter table public.cssmora_program_document_committee
  add column division text not null default 'BPH'
  check (division in ('BPH','PSDM','P3M','ADVO','MEDINFO','SEKRETARIAT','BENDAHARA','LAINNYA'));
grant insert (document_id, member_id, role_title, division, position),
  update (member_id, role_title, division, position)
  on public.cssmora_program_document_committee to authenticated;

-- A generated PDF is kept in Drive for the next signer; it is never downloaded automatically.
alter table public.cssmora_program_documents
  add column google_pdf_id text,
  add column google_pdf_url text check (
    google_pdf_url is null or google_pdf_url ~ '^https://drive[.]google[.]com/file/d/[^[:space:]]+$'
  ),
  add column google_pdf_generated_at timestamptz;

-- Bendahara may verify an LPJ while it is waiting for Sekretaris. The LPJ Docs
-- must be refreshed after this write before the Secretary signature can proceed.
drop policy if exists "Treasurer manages LPJ actuals" on public.cssmora_program_document_finance;
create policy "Treasurer verifies LPJ before leadership signature"
on public.cssmora_program_document_finance for all to authenticated
using (
  (select public.cssmora_user_has_role('bendahara')) and exists (
    select 1 from public.cssmora_program_documents d where d.id=document_id
      and d.document_type='lpj' and d.optional_sections->>'finance'='true'
      and d.status in ('secretary_review','treasurer_review')
  )
)
with check (
  (select public.cssmora_user_has_role('bendahara')) and exists (
    select 1 from public.cssmora_program_documents d where d.id=document_id
      and d.document_type='lpj' and d.optional_sections->>'finance'='true'
      and d.status in ('secretary_review','treasurer_review')
  )
);

create or replace function public.set_cssmora_program_document_finance_audit()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op='UPDATE' and new.document_id is distinct from old.document_id then
    raise exception 'Tautan dokumen realisasi tidak dapat diubah.' using errcode='22023';
  end if;
  if nullif(pg_catalog.btrim(new.akunpro_url),'') is null then
    raise exception 'Tautan AkunPro wajib dicantumkan untuk verifikasi Bendahara.' using errcode='22023';
  end if;
  new.confirmed_by:=auth.uid();
  new.confirmed_at:=pg_catalog.now();
  new.updated_at:=pg_catalog.now();
  return new;
end;
$function$;

-- Sekretaris and Ketua approvals are recorded only by the signature RPC below.
-- The separate Bendahara approval remains available for legacy treasury-review items.
create or replace function public.review_cssmora_program_document(
  p_document_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql security definer set search_path = '' as $function$
declare
  v_doc public.cssmora_program_documents%rowtype;
  v_role text;
  v_note text := coalesce(nullif(pg_catalog.btrim(p_note),''),'');
begin
  if auth.uid() is null or p_decision is null or p_decision not in ('approved','revision_requested') then
    raise exception 'Keputusan peninjauan tidak valid.' using errcode='22023';
  end if;
  select * into v_doc from public.cssmora_program_documents where id=p_document_id for update;
  if not found then raise exception 'Dokumen tidak ditemukan.' using errcode='P0002'; end if;
  if v_doc.created_by=auth.uid() then raise exception 'Pengaju tidak dapat meninjau dokumennya sendiri.' using errcode='42501'; end if;
  v_role:=case
    when v_doc.status='secretary_review' and (select public.cssmora_user_has_role('sekretaris')) then 'sekretaris'
    when v_doc.status='treasurer_review' and (select public.cssmora_user_has_role('bendahara')) then 'bendahara'
    when v_doc.status='chair_review' and (select public.cssmora_user_has_role('ketua')) then 'ketua'
    when v_doc.status='chair_review' and (select public.cssmora_user_has_role('wakil')) then 'wakil'
    else null end;
  if v_role is null then raise exception 'Dokumen ini berada di luar wewenang akun.' using errcode='42501'; end if;
  if p_decision='revision_requested' then
    if v_note='' then raise exception 'Catatan revisi wajib diisi.' using errcode='22023'; end if;
    insert into public.cssmora_program_document_reviews(document_id,review_stage,decision,note,actor_id)
    values(p_document_id,v_role,'revision_requested',v_note,auth.uid());
    update public.cssmora_program_documents set status='revision',revision_number=revision_number+1,google_pdf_id=null,google_pdf_url=null,google_pdf_generated_at=null,updated_at=pg_catalog.now(),updated_by=auth.uid() where id=p_document_id;
    return 'revision';
  end if;
  if v_role<>'bendahara' or v_doc.status<>'treasurer_review' then
    raise exception 'Sekretaris dan Ketua menyetujui dengan tanda tangan pada dokumen.' using errcode='22023';
  end if;
  if v_doc.document_type='lpj' and v_doc.has_financial_section and not exists (
    select 1 from public.cssmora_program_document_finance f
    where f.document_id=p_document_id and f.confirmed_by is not null and f.confirmed_at is not null
      and v_doc.google_doc_generated_at>=f.confirmed_at
  ) then raise exception 'Bendahara harus menyimpan verifikasi dan memperbarui Google Docs sebelum melanjutkan.' using errcode='23514'; end if;
  insert into public.cssmora_program_document_reviews(document_id,review_stage,decision,note,actor_id)
  values(p_document_id,v_role,'approved','Verifikasi keuangan/anggaran selesai.',auth.uid());
  update public.cssmora_program_documents set status='chair_review',updated_at=pg_catalog.now(),updated_by=auth.uid() where id=p_document_id;
  return 'chair_review';
end;
$function$;
revoke all on function public.review_cssmora_program_document(uuid,text,text) from public, anon;
grant execute on function public.review_cssmora_program_document(uuid,text,text) to authenticated;

-- Only the authenticated Drive integration can finalize signatures after it has
-- replaced the stage marker in Google Docs and exported the matching PDF to Drive.
create or replace function public.record_cssmora_program_document_signature(
  p_document_id uuid,
  p_stage text,
  p_actor_id uuid,
  p_google_pdf_id text,
  p_google_pdf_url text
)
returns text
language plpgsql security definer set search_path = '' as $function$
declare
  v_doc public.cssmora_program_documents%rowtype;
  v_next text;
  v_role text;
begin
  if p_stage not in ('sekretaris','ketua') or p_actor_id is null
    or length(coalesce(p_google_pdf_id,'')) not between 5 and 200
    or coalesce(p_google_pdf_url,'') !~ '^https://drive[.]google[.]com/file/d/[^[:space:]]+$' then
    raise exception 'Data tanda tangan atau PDF tidak valid.' using errcode='22023';
  end if;
  select * into v_doc from public.cssmora_program_documents where id=p_document_id for update;
  if not found then raise exception 'Dokumen tidak ditemukan.' using errcode='P0002'; end if;
  if p_stage='sekretaris' then
    if v_doc.status<>'secretary_review' then raise exception 'Dokumen belum menunggu tanda tangan Sekretaris.' using errcode='23514'; end if;
    if v_doc.document_type='lpj' and v_doc.has_financial_section and not exists (
      select 1 from public.cssmora_program_document_finance f
      where f.document_id=p_document_id and f.confirmed_by is not null and f.confirmed_at is not null
        and v_doc.google_doc_generated_at>=f.confirmed_at
    ) then raise exception 'Bendahara harus memverifikasi realisasi dan Docs diperbarui sebelum Sekretaris menandatangani.' using errcode='23514'; end if;
    v_role:='sekretaris';v_next:='chair_review';
  else
    if v_doc.status<>'chair_review' then raise exception 'Dokumen belum menunggu tanda tangan Ketua.' using errcode='23514'; end if;
    if not exists(
      select 1 from public.cssmora_program_document_reviews r
      where r.document_id=p_document_id and r.review_stage='sekretaris' and r.decision='approved'
        and r.created_at>coalesce((select max(rv.created_at) from public.cssmora_program_document_reviews rv where rv.document_id=p_document_id and rv.decision='revision_requested'),'-infinity'::timestamptz)
    ) then
      raise exception 'Tanda tangan Sekretaris harus tercatat lebih dahulu.' using errcode='23514';
    end if;
    v_role:='ketua';v_next:='approved';
  end if;
  if not exists (
    select 1 from auth.users u join public.cssmora_user_roles r on r.email=lower(u.email)
    where u.id=p_actor_id and u.email_confirmed_at is not null and r.is_active and r.role=v_role
  ) then raise exception 'Akun penandatangan tidak memiliki peran aktif yang sesuai.' using errcode='42501'; end if;
  if p_actor_id=v_doc.created_by then raise exception 'Pengaju tidak dapat menandatangani dokumennya sendiri.' using errcode='42501'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='cssmora-signer-assets' and o.name=p_actor_id::text||'/signature.png') then
    raise exception 'Tanda tangan digital akun belum tersimpan.' using errcode='23514';
  end if;
  if exists(
    select 1 from public.cssmora_program_document_reviews r
    where r.document_id=p_document_id and r.review_stage=v_role and r.decision='approved'
      and r.created_at>coalesce((select max(rv.created_at) from public.cssmora_program_document_reviews rv where rv.document_id=p_document_id and rv.decision='revision_requested'),'-infinity'::timestamptz)
  ) then
    raise exception 'Tanda tangan tahap ini sudah tercatat.' using errcode='23514';
  end if;
  insert into public.cssmora_program_document_reviews(document_id,review_stage,decision,note,actor_id)
  values(p_document_id,v_role,'approved','Tanda tangan digital dibubuhkan pada Google Docs.',p_actor_id);
  update public.cssmora_program_documents set status=v_next,google_pdf_id=p_google_pdf_id,
    google_pdf_url=p_google_pdf_url,google_pdf_generated_at=pg_catalog.now(),updated_at=pg_catalog.now(),updated_by=p_actor_id
  where id=p_document_id;
  return v_next;
end;
$function$;
revoke all on function public.record_cssmora_program_document_signature(uuid,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.record_cssmora_program_document_signature(uuid,text,uuid,text,text) to service_role;

notify pgrst, 'reload schema';
commit;
