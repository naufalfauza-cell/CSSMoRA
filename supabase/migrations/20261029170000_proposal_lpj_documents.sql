-- Proposal and LPJ documents, structured budget, committee, evidence, and staged review.
-- Financial truth remains in AkunPro; this module stores only a confirmed LPJ summary.

begin;

create policy "CSSMoRA document roles read program facts"
on public.cssmora_program_details for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('sekretaris')) or
  (select public.cssmora_user_has_role('bendahara')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);

create table public.cssmora_program_documents (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.agenda_programs(id) on delete restrict,
  period_label text not null check (length(btrim(period_label)) between 4 and 24),
  document_type text not null check (document_type in ('proposal','lpj')),
  title text not null check (length(btrim(title)) between 3 and 180),
  period_start date,
  period_end date,
  form_data jsonb not null default '{}'::jsonb check (jsonb_typeof(form_data)='object'),
  optional_sections jsonb not null default '{}'::jsonb check (jsonb_typeof(optional_sections)='object'),
  ai_content jsonb not null default '{}'::jsonb check (jsonb_typeof(ai_content)='object'),
  status text not null default 'draft' check (status in ('draft','secretary_review','treasurer_review','chair_review','revision','approved')),
  revision_number integer not null default 1 check (revision_number > 0),
  has_financial_section boolean not null default false,
  google_doc_id text,
  google_doc_url text check (google_doc_url is null or google_doc_url ~ '^https://docs\.google\.com/document/d/[^[:space:]]+$'),
  google_doc_generated_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, period_label, document_type),
  check (period_start is null or period_end is null or period_end >= period_start)
);
create index cssmora_program_documents_queue_idx on public.cssmora_program_documents (status, updated_at desc);
create index cssmora_program_documents_program_idx on public.cssmora_program_documents (program_id, period_label desc, created_at desc);
alter table public.cssmora_program_documents enable row level security;
revoke all on public.cssmora_program_documents from public, anon;
grant select on public.cssmora_program_documents to authenticated;
grant insert (program_id, period_label, document_type, title, period_start, period_end, form_data, optional_sections, has_financial_section)
  on public.cssmora_program_documents to authenticated;
grant update (title, period_start, period_end, form_data, optional_sections, has_financial_section, ai_content)
  on public.cssmora_program_documents to authenticated;

create policy "CSSMoRA program document roles read"
on public.cssmora_program_documents for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('sekretaris')) or
  (select public.cssmora_user_has_role('bendahara')) or
  ((select public.cssmora_user_has_role('bph_departemen')) and created_by=(select auth.uid()))
);
create policy "CSSMoRA program document roles create"
on public.cssmora_program_documents for insert to authenticated
with check (
  created_by=(select auth.uid()) and (
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('sekretaris')) or
    (select public.cssmora_user_has_role('bendahara')) or
    (select public.cssmora_user_has_role('bph_departemen'))
  )
);
create policy "CSSMoRA authors edit draft program documents"
on public.cssmora_program_documents for update to authenticated
using (created_by=(select auth.uid()) and status in ('draft','revision'))
with check (created_by=(select auth.uid()) and status in ('draft','revision'));

create table public.cssmora_program_document_budget_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.cssmora_program_documents(id) on delete cascade,
  direction text not null default 'expense' check (direction in ('income','expense')),
  item_name text not null check (length(btrim(item_name)) between 2 and 180),
  quantity numeric(10,2) not null default 1 check (quantity > 0),
  unit text not null default 'kegiatan' check (length(btrim(unit)) between 1 and 40),
  unit_price bigint not null check (unit_price >= 0),
  category text not null default 'Umum' check (length(btrim(category)) between 1 and 80),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  unique (document_id, position)
);
create index cssmora_program_document_budget_items_doc_idx on public.cssmora_program_document_budget_items (document_id, position);
alter table public.cssmora_program_document_budget_items enable row level security;
revoke all on public.cssmora_program_document_budget_items from public, anon;
grant select, delete on public.cssmora_program_document_budget_items to authenticated;
grant insert (document_id, direction, item_name, quantity, unit, unit_price, category, position),
  update (direction, item_name, quantity, unit, unit_price, category, position)
  on public.cssmora_program_document_budget_items to authenticated;
create policy "CSSMoRA program roles read proposal RAB"
on public.cssmora_program_document_budget_items for select to authenticated
using (exists (select 1 from public.cssmora_program_documents d where d.id=document_id));
create policy "CSSMoRA proposal authors manage RAB"
on public.cssmora_program_document_budget_items for all to authenticated
using (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.document_type='proposal' and d.status in ('draft','revision')
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
))
with check (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.document_type='proposal' and d.status in ('draft','revision')
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
));

create table public.cssmora_program_document_committee (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.cssmora_program_documents(id) on delete cascade,
  member_id uuid not null references public.secretariat_members(id) on delete restrict,
  role_title text not null check (length(btrim(role_title)) between 2 and 100),
  position integer not null default 0 check (position >= 0),
  unique (document_id, member_id),
  unique (document_id, position)
);
alter table public.cssmora_program_document_committee enable row level security;
revoke all on public.cssmora_program_document_committee from public, anon;
grant select, delete on public.cssmora_program_document_committee to authenticated;
grant insert (document_id, member_id, role_title, position), update (member_id, role_title, position)
  on public.cssmora_program_document_committee to authenticated;
create policy "CSSMoRA program roles read document committee"
on public.cssmora_program_document_committee for select to authenticated
using (exists (select 1 from public.cssmora_program_documents d where d.id=document_id));
create policy "CSSMoRA document authors manage committee"
on public.cssmora_program_document_committee for all to authenticated
using (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision')
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
))
with check (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision')
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
));

create or replace function public.get_cssmora_program_document_members()
returns table(id uuid,full_name text,cohort smallint)
language plpgsql stable security definer set search_path = '' as $function$
begin
  if auth.uid() is null or not (
    (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara')) or
    (select public.cssmora_user_has_role('bph_departemen'))
  ) then raise exception 'Akses daftar panitia diperlukan.' using errcode='42501'; end if;
  return query select m.id,m.full_name,m.cohort from public.secretariat_members m where m.is_active order by m.cohort desc, m.full_name;
end;
$function$;
revoke all on function public.get_cssmora_program_document_members() from public, anon;
grant execute on function public.get_cssmora_program_document_members() to authenticated;

create table public.cssmora_program_document_finance (
  document_id uuid primary key references public.cssmora_program_documents(id) on delete cascade,
  income_amount bigint not null default 0 check (income_amount >= 0),
  expense_amount bigint not null default 0 check (expense_amount >= 0),
  realization_note text not null default '' check (length(realization_note) <= 3000),
  akunpro_url text check (akunpro_url is null or akunpro_url ~ '^https://[^[:space:]]+$'),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.cssmora_program_document_finance enable row level security;
revoke all on public.cssmora_program_document_finance from public, anon;
grant select on public.cssmora_program_document_finance to authenticated;
grant insert (document_id, income_amount, expense_amount, realization_note, akunpro_url),
  update (document_id, income_amount, expense_amount, realization_note, akunpro_url)
  on public.cssmora_program_document_finance to authenticated;
create policy "CSSMoRA finance and leadership read LPJ finance"
on public.cssmora_program_document_finance for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bendahara'))
);
create policy "Treasurer manages LPJ actuals"
on public.cssmora_program_document_finance for all to authenticated
using (
  (select public.cssmora_user_has_role('bendahara')) and exists (
    select 1 from public.cssmora_program_documents d where d.id=document_id
      and d.document_type='lpj' and d.optional_sections->>'finance'='true' and d.status='treasurer_review'
  )
)
with check (
  (select public.cssmora_user_has_role('bendahara')) and exists (
    select 1 from public.cssmora_program_documents d where d.id=document_id
      and d.document_type='lpj' and d.optional_sections->>'finance'='true' and d.status='treasurer_review'
  )
);
create or replace function public.set_cssmora_program_document_finance_audit()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op='UPDATE' and new.document_id is distinct from old.document_id then
    raise exception 'Tautan dokumen realisasi tidak dapat diubah.' using errcode='22023';
  end if;
  new.confirmed_by:=auth.uid();
  new.confirmed_at:=pg_catalog.now();
  new.updated_at:=pg_catalog.now();
  return new;
end;
$function$;
revoke all on function public.set_cssmora_program_document_finance_audit() from public, anon, authenticated;
create trigger set_program_document_finance_audit_before_write
before insert or update on public.cssmora_program_document_finance
for each row execute function public.set_cssmora_program_document_finance_audit();

create table public.cssmora_program_document_photos (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.cssmora_program_documents(id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$'),
  caption text not null default '' check (length(caption) <= 240),
  position integer not null default 0 check (position >= 0),
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  unique (document_id, position)
);
alter table public.cssmora_program_document_photos enable row level security;
revoke all on public.cssmora_program_document_photos from public, anon;
grant select, delete on public.cssmora_program_document_photos to authenticated;
grant insert (document_id, storage_path, caption, position), update (caption, position)
  on public.cssmora_program_document_photos to authenticated;
create policy "CSSMoRA document roles read photos"
on public.cssmora_program_document_photos for select to authenticated
using (exists (select 1 from public.cssmora_program_documents d where d.id=document_id));
create policy "CSSMoRA document authors manage photos"
on public.cssmora_program_document_photos for all to authenticated
using (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision')
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
))
with check (exists (
  select 1 from public.cssmora_program_documents d
  where d.id=document_id and d.status in ('draft','revision')
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cssmora-program-documentation','cssmora-program-documentation',false,8388608,array['image/jpeg','image/png'])
on conflict (id) do update set public=false, file_size_limit=8388608, allowed_mime_types=array['image/jpeg','image/png'];
create policy "CSSMoRA program document roles upload documentation"
on storage.objects for insert to authenticated
with check (
  bucket_id='cssmora-program-documentation' and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$'
  and ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara')) or
    (select public.cssmora_user_has_role('bph_departemen')))
  and exists(select 1 from public.cssmora_program_documents d where d.id::text=pg_catalog.split_part(name,'/',1)
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil'))
      or (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara'))))
);
create policy "CSSMoRA program document roles read documentation"
on storage.objects for select to authenticated
using (
  bucket_id='cssmora-program-documentation' and
  ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara')) or
    (select public.cssmora_user_has_role('bph_departemen')))
  and exists(select 1 from public.cssmora_program_documents d where d.id::text=pg_catalog.split_part(name,'/',1)
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil'))
      or (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara'))))
);
create policy "CSSMoRA program document roles delete documentation"
on storage.objects for delete to authenticated
using (
  bucket_id='cssmora-program-documentation' and
  ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara')) or
    (select public.cssmora_user_has_role('bph_departemen')))
  and exists(select 1 from public.cssmora_program_documents d where d.id::text=pg_catalog.split_part(name,'/',1)
    and (d.created_by=(select auth.uid()) or (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil'))
      or (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara'))))
);

create table public.cssmora_program_document_reviews (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.cssmora_program_documents(id) on delete cascade,
  review_stage text not null check (review_stage in ('sekretaris','bendahara','ketua','wakil')),
  decision text not null check (decision in ('approved','revision_requested')),
  note text not null default '' check (length(note) <= 2000),
  actor_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index cssmora_program_document_reviews_doc_idx on public.cssmora_program_document_reviews (document_id, created_at desc);
alter table public.cssmora_program_document_reviews enable row level security;
revoke all on public.cssmora_program_document_reviews from public, anon, authenticated;
grant select on public.cssmora_program_document_reviews to authenticated;
create policy "CSSMoRA document roles read document reviews"
on public.cssmora_program_document_reviews for select to authenticated
using (exists (select 1 from public.cssmora_program_documents d where d.id=document_id));

create or replace function public.set_cssmora_program_document_updated()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  new.updated_at := pg_catalog.now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  if tg_op='UPDATE' and (
    new.form_data is distinct from old.form_data or new.optional_sections is distinct from old.optional_sections or new.title is distinct from old.title
  ) then
    new.ai_content := '{}'::jsonb;
    new.google_doc_generated_at := null;
    new.google_doc_id := old.google_doc_id;
    new.google_doc_url := old.google_doc_url;
    new.revision_number := old.revision_number + 1;
  elsif tg_op='UPDATE' and new.ai_content is distinct from old.ai_content then
    new.google_doc_generated_at := null;
  end if;
  if tg_op='INSERT' then new.created_by := auth.uid(); end if;
  return new;
end;
$function$;
revoke all on function public.set_cssmora_program_document_updated() from public, anon, authenticated;
create trigger set_cssmora_program_document_updated_before
before insert or update on public.cssmora_program_documents
for each row execute function public.set_cssmora_program_document_updated();

create or replace function public.invalidate_cssmora_program_document_output()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_document_id uuid;
begin
  v_document_id:=case when tg_op='DELETE' then old.document_id else new.document_id end;
  update public.cssmora_program_documents
  set ai_content='{}'::jsonb,google_doc_generated_at=null
  where id=v_document_id;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.invalidate_cssmora_program_document_output() from public, anon, authenticated;
create trigger invalidate_program_document_budget_after_write
after insert or update or delete on public.cssmora_program_document_budget_items
for each row execute function public.invalidate_cssmora_program_document_output();
create trigger invalidate_program_document_committee_after_write
after insert or update or delete on public.cssmora_program_document_committee
for each row execute function public.invalidate_cssmora_program_document_output();
create trigger invalidate_program_document_photos_after_write
after insert or update or delete on public.cssmora_program_document_photos
for each row execute function public.invalidate_cssmora_program_document_output();

create or replace function public.submit_cssmora_program_document(p_document_id uuid)
returns text language plpgsql security definer set search_path = '' as $function$
declare v_doc public.cssmora_program_documents%rowtype;
begin
  select * into v_doc from public.cssmora_program_documents where id=p_document_id for update;
  if not found then raise exception 'Dokumen tidak ditemukan.' using errcode='P0002'; end if;
  if auth.uid() is null or (v_doc.created_by<>auth.uid() and not (
    (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil'))
  )) then raise exception 'Hanya PIC atau pimpinan yang dapat mengajukan dokumen.' using errcode='42501'; end if;
  if v_doc.status not in ('draft','revision') then raise exception 'Dokumen hanya dapat diajukan dari status draf atau revisi.' using errcode='23514'; end if;
  if v_doc.google_doc_id is null or v_doc.google_doc_generated_at is null or length(coalesce(v_doc.ai_content->>'generated_at',''))=0 then
    raise exception 'Buat narasi AI dan Google Docs terlebih dahulu sebelum mengajukan.' using errcode='23514';
  end if;
  if v_doc.document_type='proposal' and length(coalesce(v_doc.form_data->>'description',''))<20 then
    raise exception 'Lengkapi deskripsi kegiatan minimal 20 karakter.' using errcode='23514';
  end if;
  if v_doc.document_type='lpj' and length(coalesce(v_doc.form_data->>'realization_summary',''))<20 then
    raise exception 'Lengkapi ringkasan pelaksanaan minimal 20 karakter.' using errcode='23514';
  end if;
  update public.cssmora_program_documents set status='secretary_review' where id=p_document_id;
  return 'secretary_review';
end;
$function$;
revoke all on function public.submit_cssmora_program_document(uuid) from public, anon;
grant execute on function public.submit_cssmora_program_document(uuid) to authenticated;

create or replace function public.review_cssmora_program_document(p_document_id uuid,p_decision text,p_note text default null)
returns text language plpgsql security definer set search_path = '' as $function$
declare v_doc public.cssmora_program_documents%rowtype; v_role text; v_next text; v_note text:=coalesce(nullif(pg_catalog.btrim(p_note),''),'');
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
  if v_role is null then raise exception 'Peninjauan ini berada di luar wewenang peran akun.' using errcode='42501'; end if;
  if p_decision='revision_requested' and v_note='' then raise exception 'Catatan revisi wajib diisi.' using errcode='22023'; end if;
  if p_decision='approved' and v_doc.status='treasurer_review' and v_doc.document_type='lpj' and v_doc.has_financial_section and not exists (
    select 1 from public.cssmora_program_document_finance f
    where f.document_id=p_document_id and f.confirmed_by is not null and f.confirmed_at is not null
      and v_doc.google_doc_generated_at>=f.confirmed_at
  ) then raise exception 'Bendahara harus menyimpan verifikasi dan memperbarui Google Docs sebelum menyetujui.' using errcode='23514'; end if;
  if exists(select 1 from public.cssmora_program_document_reviews r where r.document_id=p_document_id and r.actor_id=auth.uid() and r.decision='approved' and r.review_stage<>v_role) then
    raise exception 'Persetujuan pada tahap berbeda harus dilakukan pengurus lain.' using errcode='42501';
  end if;
  insert into public.cssmora_program_document_reviews(document_id,review_stage,decision,note,actor_id)
  values(p_document_id,v_role,p_decision,v_note,auth.uid());
  if p_decision='revision_requested' then v_next:='revision';
  elsif v_doc.status='secretary_review' and v_doc.has_financial_section then v_next:='treasurer_review';
  elsif v_doc.status='secretary_review' then v_next:='chair_review';
  elsif v_doc.status='treasurer_review' then v_next:='chair_review';
  else v_next:='approved'; end if;
  update public.cssmora_program_documents set status=v_next,updated_at=pg_catalog.now(),updated_by=auth.uid() where id=p_document_id;
  return v_next;
end;
$function$;
revoke all on function public.review_cssmora_program_document(uuid,text,text) from public, anon;
grant execute on function public.review_cssmora_program_document(uuid,text,text) to authenticated;

create or replace function public.get_cssmora_program_document_attendance(p_document_id uuid)
returns table(agenda_id uuid,agenda_title text,starts_at timestamptz,location text,eligible_count bigint,present_count bigint)
language plpgsql stable security definer set search_path = '' as $function$
declare v_doc public.cssmora_program_documents%rowtype;
begin
  if auth.uid() is null or not (
    (select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('bph_departemen')) or (select public.cssmora_user_has_role('sekretaris')) or (select public.cssmora_user_has_role('bendahara'))
  ) then raise exception 'Akses dokumen proker diperlukan.' using errcode='42501'; end if;
  select * into v_doc from public.cssmora_program_documents where id=p_document_id;
  if not found then raise exception 'Dokumen tidak ditemukan.' using errcode='P0002'; end if;
  if (select public.cssmora_user_has_role('bph_departemen'))
    and not (select public.cssmora_user_has_role('ketua'))
    and not (select public.cssmora_user_has_role('wakil'))
    and not (select public.cssmora_user_has_role('sekretaris'))
    and not (select public.cssmora_user_has_role('bendahara'))
    and v_doc.created_by<>auth.uid() then
    raise exception 'BPH hanya dapat melihat rekap untuk dokumennya sendiri.' using errcode='42501';
  end if;
  return query
  select a.id,a.title,a.starts_at,a.location,count(r.member_id)::bigint,
    count(r.member_id) filter(where r.status='hadir')::bigint
  from public.agenda a
  left join public.secretariat_attendance_events e on e.agenda_id=a.id
  left join public.secretariat_attendance_records r on r.event_id=e.id
  where a.program_id=v_doc.program_id and a.status='published'
    and coalesce(a.ends_at,a.starts_at)<=pg_catalog.statement_timestamp()
    and (v_doc.period_start is null or (a.starts_at at time zone 'Asia/Jakarta')::date>=v_doc.period_start)
    and (v_doc.period_end is null or (a.starts_at at time zone 'Asia/Jakarta')::date<=v_doc.period_end)
  group by a.id,a.title,a.starts_at,a.location order by a.starts_at;
end;
$function$;
revoke all on function public.get_cssmora_program_document_attendance(uuid) from public, anon;
grant execute on function public.get_cssmora_program_document_attendance(uuid) to authenticated;

-- Keep the new private PDD evidence inside the existing Drive mirror queue.
alter table public.cssmora_drive_sync_queue drop constraint cssmora_drive_sync_queue_bucket_id_check;
alter table public.cssmora_drive_sync_queue add constraint cssmora_drive_sync_queue_bucket_id_check check (bucket_id in (
  'attendance-proofs','cssmora-achievement-certificates','cssmora-agenda-programs','cssmora-letter-pdfs',
  'cssmora-prestasi-proofs','cssmora-signer-assets','cssmora-program-documentation','posters'
));
create or replace function public.enqueue_cssmora_drive_object()
returns trigger language plpgsql security definer set search_path = '' as $function$
declare v_bucket text; v_path text; v_operation text;
begin
  if tg_op='DELETE' then v_bucket:=old.bucket_id;v_path:=old.name;v_operation:='delete';
  else v_bucket:=new.bucket_id;v_path:=new.name;v_operation:='upsert';end if;
  if v_bucket not in ('attendance-proofs','cssmora-achievement-certificates','cssmora-agenda-programs','cssmora-letter-pdfs','cssmora-prestasi-proofs','cssmora-signer-assets','cssmora-program-documentation','posters') then
    if tg_op='DELETE' then return old;end if;return new;
  end if;
  insert into public.cssmora_drive_sync_queue as existing(bucket_id,object_path,operation,status,attempts,next_attempt_at,last_error,updated_at)
  values(v_bucket,v_path,v_operation,'pending',0,pg_catalog.now(),null,pg_catalog.now())
  on conflict(bucket_id,object_path) do update set operation=excluded.operation,status='pending',attempts=0,generation=existing.generation+1,next_attempt_at=pg_catalog.now(),last_error=null,updated_at=pg_catalog.now();
  if tg_op='DELETE' then return old;end if;return new;
end;
$function$;
revoke all on function public.enqueue_cssmora_drive_object() from public, anon, authenticated;
insert into public.cssmora_drive_sync_queue(bucket_id,object_path,operation)
select o.bucket_id,o.name,'upsert' from storage.objects o where o.bucket_id='cssmora-program-documentation'
on conflict(bucket_id,object_path) do nothing;

-- Include proposal/LPJ records in the encrypted JSON and Sheets backup snapshots.
create or replace function public.export_cssmora_drive_backup()
returns jsonb language sql security definer set search_path = '' as $function$
select pg_catalog.jsonb_build_object(
  'format','cssmora-data-backup-v1','generated_at',pg_catalog.clock_timestamp(),
  'tables',pg_catalog.jsonb_build_object(
    'agenda',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.agenda t),'[]'::jsonb),
    'agenda_programs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.agenda_programs t),'[]'::jsonb),
    'competition_admins',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.competition_admins t),'[]'::jsonb),
    'competitions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.competitions t),'[]'::jsonb),
    'cssmora_achievement_application_members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_application_members t),'[]'::jsonb),
    'cssmora_achievement_applications',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_applications t),'[]'::jsonb),
    'cssmora_achievement_record_members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_record_members t),'[]'::jsonb),
    'cssmora_achievement_records',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_records t),'[]'::jsonb),
    'cssmora_achievement_reviewers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_reviewers t),'[]'::jsonb),
    'cssmora_finance_budgets',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_finance_budgets t),'[]'::jsonb),
    'cssmora_finance_transactions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_finance_transactions t),'[]'::jsonb),
    'cssmora_letter_signature_requests',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_letter_signature_requests t),'[]'::jsonb),
    'cssmora_program_cycle_history',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_cycle_history t),'[]'::jsonb),
    'cssmora_program_cycles',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_cycles t),'[]'::jsonb),
    'cssmora_program_details',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_details t),'[]'::jsonb),
    'cssmora_program_document_budget_items',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_budget_items t),'[]'::jsonb),
    'cssmora_program_document_committee',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_committee t),'[]'::jsonb),
    'cssmora_program_document_finance',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_finance t),'[]'::jsonb),
    'cssmora_program_document_photos',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_photos t),'[]'::jsonb),
    'cssmora_program_document_reviews',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_reviews t),'[]'::jsonb),
    'cssmora_program_documents',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_documents t),'[]'::jsonb),
    'cssmora_program_milestones',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_milestones t),'[]'::jsonb),
    'cssmora_user_roles',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_user_roles t),'[]'::jsonb),
    'secretariat_admins',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_admins t),'[]'::jsonb),
    'secretariat_attendance_events',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_attendance_events t),'[]'::jsonb),
    'secretariat_attendance_records',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_attendance_records t),'[]'::jsonb),
    'secretariat_letter_counters',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_letter_counters t),'[]'::jsonb),
    'secretariat_letters',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_letters t),'[]'::jsonb),
    'secretariat_members',coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_members t),'[]'::jsonb)
  )
);
$function$;
revoke all on function public.export_cssmora_drive_backup() from public, anon, authenticated;
grant execute on function public.export_cssmora_drive_backup() to service_role;

notify pgrst, 'reload schema';
commit;
