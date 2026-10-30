begin;

-- PICs own and edit their drafts. Leadership and the reviewing roles retain
-- read access, while approval remains in the staged review RPCs.
drop policy if exists "CSSMoRA proposal authors manage RAB" on public.cssmora_program_document_budget_items;
create policy "CSSMoRA proposal authors manage RAB"
on public.cssmora_program_document_budget_items for all to authenticated
using (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.document_type='proposal' and d.status in ('draft','revision')
    and d.created_by=(select auth.uid())
))
with check (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.document_type='proposal' and d.status in ('draft','revision')
    and d.created_by=(select auth.uid())
));

drop policy if exists "CSSMoRA document authors manage committee" on public.cssmora_program_document_committee;
create policy "CSSMoRA document authors manage committee"
on public.cssmora_program_document_committee for all to authenticated
using (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision') and d.created_by=(select auth.uid())
))
with check (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision') and d.created_by=(select auth.uid())
));

drop policy if exists "CSSMoRA document authors manage photos" on public.cssmora_program_document_photos;
create policy "CSSMoRA document authors manage photos"
on public.cssmora_program_document_photos for all to authenticated
using (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision') and d.created_by=(select auth.uid())
))
with check (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision') and d.created_by=(select auth.uid())
));

drop policy if exists "CSSMoRA program document roles upload documentation" on storage.objects;
create policy "CSSMoRA program document authors upload documentation"
on storage.objects for insert to authenticated
with check (
  bucket_id='cssmora-program-documentation'
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$'
  and exists(select 1 from public.cssmora_program_documents d
    where d.id::text=pg_catalog.split_part(name,'/',1)
      and d.created_by=(select auth.uid()) and d.status in ('draft','revision'))
);

drop policy if exists "CSSMoRA program document roles delete documentation" on storage.objects;
create policy "CSSMoRA program document authors delete documentation"
on storage.objects for delete to authenticated
using (
  bucket_id='cssmora-program-documentation'
  and exists(select 1 from public.cssmora_program_documents d
    where d.id::text=pg_catalog.split_part(name,'/',1)
      and d.created_by=(select auth.uid()) and d.status in ('draft','revision'))
);

drop function public.get_cssmora_program_document_members();
create function public.get_cssmora_program_document_members()
returns table(id uuid,full_name text,nia text,cohort smallint)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if auth.uid() is null or not (
    (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara')) or
    (select public.cssmora_user_has_role('bph_departemen'))
  ) then raise exception 'Akses daftar panitia diperlukan.' using errcode='42501'; end if;
  return query select m.id,m.full_name,m.nia,m.cohort from public.secretariat_members m
    where m.is_active order by m.cohort desc,m.full_name;
end;
$function$;
revoke all on function public.get_cssmora_program_document_members() from public, anon;
grant execute on function public.get_cssmora_program_document_members() to authenticated;

-- Keep the proposal execution date and optional end date aligned with their
-- indexed date fields; reject incomplete tables at the database boundary too.
create or replace function public.submit_cssmora_program_document(p_document_id uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare
  v_doc public.cssmora_program_documents%rowtype;
  v_event_date text;
  v_event_end_date text;
  v_rundown jsonb;
begin
  select * into v_doc from public.cssmora_program_documents where id=p_document_id for update;
  if not found then raise exception 'Dokumen tidak ditemukan.' using errcode='P0002'; end if;
  if auth.uid() is null or v_doc.created_by<>auth.uid() then
    raise exception 'Hanya PIC/pembuat draf yang dapat mengajukan dokumen.' using errcode='42501';
  end if;
  if v_doc.status not in ('draft','revision') then
    raise exception 'Dokumen hanya dapat diajukan dari status draf atau revisi.' using errcode='23514';
  end if;
  if v_doc.google_doc_id is null or v_doc.google_doc_generated_at is null or length(coalesce(v_doc.ai_content->>'generated_at',''))=0 then
    raise exception 'Buat narasi AI dan Google Docs terlebih dahulu sebelum mengajukan.' using errcode='23514';
  end if;

  if v_doc.document_type='proposal' then
    v_event_date:=nullif(pg_catalog.btrim(v_doc.form_data->>'event_date'),'');
    v_event_end_date:=nullif(pg_catalog.btrim(v_doc.form_data->>'event_end_date'),'');
    if length(coalesce(v_doc.form_data->>'description',''))<20
      or nullif(pg_catalog.btrim(v_doc.form_data->>'goals'),'') is null
      or nullif(pg_catalog.btrim(v_doc.form_data->>'target'),'') is null then
      raise exception 'Lengkapi deskripsi, tujuan, dan sasaran proposal.' using errcode='23514';
    end if;
    if v_doc.period_start is null or v_event_date is distinct from pg_catalog.to_char(v_doc.period_start,'YYYY-MM-DD')
      or v_event_end_date is distinct from pg_catalog.to_char(v_doc.period_end,'YYYY-MM-DD') then
      raise exception 'Tanggal mulai harus sama dengan tanggal pelaksanaan; tanggal akhir boleh dikosongkan.' using errcode='23514';
    end if;
    if v_doc.optional_sections->>'committee'='true' and not exists (
      select 1 from public.cssmora_program_document_committee c where c.document_id=p_document_id
    ) then raise exception 'Isi tabel kepanitiaan atau matikan bagian kepanitiaan.' using errcode='23514'; end if;
    if v_doc.optional_sections->>'rundown_section'='true' then
      v_rundown:=v_doc.form_data->'rundown';
      if coalesce(pg_catalog.jsonb_typeof(v_rundown),'')<>'array' then
        raise exception 'Lengkapi tabel rundown sebelum mengajukan.' using errcode='23514';
      end if;
      if pg_catalog.jsonb_array_length(v_rundown)=0 or exists (
        select 1 from pg_catalog.jsonb_array_elements(v_rundown) item
        where nullif(pg_catalog.btrim(item->>'activity'),'') is null
          or coalesce(item->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or coalesce(item->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
          or item->>'start_time'>=item->>'end_time'
      ) then raise exception 'Lengkapi jam dan kegiatan pada setiap baris rundown.' using errcode='23514';
      end if;
    end if;
    if v_doc.optional_sections->>'rab'='true' and not exists (
      select 1 from public.cssmora_program_document_budget_items b
      where b.document_id=p_document_id and b.direction='expense'
    ) then raise exception 'Isi minimal satu pengeluaran di RAB atau matikan bagian RAB.' using errcode='23514'; end if;
  elsif length(coalesce(v_doc.form_data->>'realization_summary',''))<20 then
    raise exception 'Lengkapi ringkasan pelaksanaan LPJ minimal 20 karakter.' using errcode='23514';
  end if;

  update public.cssmora_program_documents set status='secretary_review' where id=p_document_id;
  return 'secretary_review';
end;
$function$;
revoke all on function public.submit_cssmora_program_document(uuid) from public, anon;
grant execute on function public.submit_cssmora_program_document(uuid) to authenticated;

create or replace function public.enforce_cssmora_program_document_distinct_signers()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if new.decision='approved' and new.review_stage='ketua' and exists(
    select 1 from public.cssmora_program_document_reviews r
    where r.document_id=new.document_id and r.review_stage='sekretaris'
      and r.decision='approved' and r.actor_id=new.actor_id
      and r.created_at>coalesce((
        select pg_catalog.max(rv.created_at) from public.cssmora_program_document_reviews rv
        where rv.document_id=new.document_id and rv.decision='revision_requested'
      ),'-infinity'::timestamptz)
  ) then
    raise exception 'Tanda tangan Sekretaris dan Ketua harus dilakukan oleh dua akun berbeda.' using errcode='42501';
  end if;
  return new;
end;
$function$;
revoke all on function public.enforce_cssmora_program_document_distinct_signers() from public, anon, authenticated;
drop trigger if exists enforce_cssmora_program_document_distinct_signers on public.cssmora_program_document_reviews;
create trigger enforce_cssmora_program_document_distinct_signers
before insert on public.cssmora_program_document_reviews
for each row execute function public.enforce_cssmora_program_document_distinct_signers();

notify pgrst, 'reload schema';
commit;
