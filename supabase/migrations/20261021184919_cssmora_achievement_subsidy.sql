create table public.cssmora_achievement_reviewers (
  email text not null,
  role text not null check (role in ('bendahara','ketua')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (email),
  check (email = lower(btrim(email)))
);

insert into public.cssmora_achievement_reviewers (email, role)
values ('naufal.almaroqi@gmail.com', 'ketua')
on conflict (email) do update set role = excluded.role, is_active = true;

create table public.cssmora_achievement_applications (
  id uuid primary key,
  competition_name text not null check (length(btrim(competition_name)) between 3 and 180),
  competition_type text not null check (length(btrim(competition_type)) between 2 and 100),
  participation_type text not null check (participation_type in ('individu','tim')),
  leader_member_id uuid not null references public.secretariat_members(id) on delete restrict,
  leader_name text not null,
  leader_phone text not null check (length(regexp_replace(leader_phone, '[^0-9]', '', 'g')) between 9 and 16),
  official_email text not null check (official_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  fee_amount bigint not null check (fee_amount >= 0 and fee_amount <= 100000000),
  subsidy_rate numeric(4,3) generated always as (
    case
      when participation_type = 'individu' then 0.500
      when fee_amount <= 20000 then 1.000
      when fee_amount <= 50000 then 0.750
      when fee_amount <= 80000 then 0.500
      else 0.250
    end
  ) stored,
  requested_amount bigint generated always as (round(fee_amount * (
    case
      when participation_type = 'individu' then 0.500
      when fee_amount <= 20000 then 1.000
      when fee_amount <= 50000 then 0.750
      when fee_amount <= 80000 then 0.500
      else 0.250
    end
  ))::bigint) stored,
  information_url text not null check (information_url ~* '^https?://'),
  proof_path text not null unique,
  bank_name text not null check (length(btrim(bank_name)) between 2 and 80),
  account_number text not null check (account_number ~ '^[0-9]{5,30}$'),
  account_name text not null check (length(btrim(account_name)) between 2 and 140),
  return_agreement boolean not null check (return_agreement),
  status text not null default 'pending_bendahara' check (status in ('pending_bendahara','pending_ketua','approved','rejected')),
  treasurer_email text,
  treasurer_decision text check (treasurer_decision in ('approved','rejected')),
  treasurer_note text,
  treasurer_reviewed_at timestamptz,
  chair_email text,
  chair_decision text check (chair_decision in ('approved','rejected')),
  chair_note text,
  chair_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (chair_email is null or treasurer_email is null or chair_email <> treasurer_email)
);
create index cssmora_achievement_applications_status_created_idx
  on public.cssmora_achievement_applications (status, created_at desc);
create index cssmora_achievement_applications_email_created_idx
  on public.cssmora_achievement_applications (lower(official_email), created_at desc);

create table public.cssmora_achievement_application_members (
  application_id uuid not null references public.cssmora_achievement_applications(id) on delete cascade,
  member_id uuid not null references public.secretariat_members(id) on delete restrict,
  member_name text not null,
  cohort smallint not null,
  role text not null check (role in ('ketua','anggota')),
  primary key (application_id, member_id)
);

create table public.cssmora_achievement_submission_limits (
  official_email text primary key,
  last_submitted_at timestamptz not null default now(),
  submissions_in_window smallint not null default 1 check (submissions_in_window between 1 and 3)
);

alter table public.cssmora_achievement_reviewers enable row level security;
alter table public.cssmora_achievement_applications enable row level security;
alter table public.cssmora_achievement_application_members enable row level security;
alter table public.cssmora_achievement_submission_limits enable row level security;
revoke all on public.cssmora_achievement_submission_limits from public, anon, authenticated;

create or replace function public.cssmora_achievement_is_reviewer(p_role text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.cssmora_achievement_reviewers r
    where r.email = lower(btrim(auth.jwt()->>'email'))
      and r.is_active
      and (p_role is null or r.role = p_role)
  );
$$;
revoke all on function public.cssmora_achievement_is_reviewer(text) from public, anon;
grant execute on function public.cssmora_achievement_is_reviewer(text) to authenticated;

create or replace function public.cssmora_achievement_member_roster()
returns table (id uuid, full_name text, cohort smallint, study_program text)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.full_name, m.cohort, m.study_program
  from public.secretariat_members m
  where m.is_active
  order by m.cohort desc, m.full_name asc;
$$;
revoke all on function public.cssmora_achievement_member_roster() from public;
grant execute on function public.cssmora_achievement_member_roster() to anon, authenticated;

create policy "Achievement reviewers read reviewer assignments" on public.cssmora_achievement_reviewers
  for select to authenticated
  using (email = lower(btrim(auth.jwt()->>'email')) or exists (
    select 1 from public.competition_admins a where a.email = lower(btrim(auth.jwt()->>'email'))
  ));
create policy "Chair assigns treasurer reviewers" on public.cssmora_achievement_reviewers
  for insert to authenticated
  with check (role = 'bendahara' and email <> lower(btrim(auth.jwt()->>'email'))
    and (select public.cssmora_achievement_is_reviewer('ketua')));
create policy "Chair removes treasurer reviewers" on public.cssmora_achievement_reviewers
  for delete to authenticated
  using (role = 'bendahara' and (select public.cssmora_achievement_is_reviewer('ketua')));

create policy "Achievement reviewers read applications" on public.cssmora_achievement_applications
  for select to authenticated
  using ((select public.cssmora_achievement_is_reviewer('bendahara'))
      or (select public.cssmora_achievement_is_reviewer('ketua')));
create policy "Achievement reviewers read applicant roster" on public.cssmora_achievement_application_members
  for select to authenticated
  using ((select public.cssmora_achievement_is_reviewer('bendahara'))
      or (select public.cssmora_achievement_is_reviewer('ketua')));

grant select, insert, delete on public.cssmora_achievement_reviewers to authenticated;
grant select on public.cssmora_achievement_applications, public.cssmora_achievement_application_members to authenticated;
grant usage on schema public to anon, authenticated;

create or replace function public.submit_cssmora_achievement_application(
  p_id uuid,
  p_competition_name text,
  p_competition_type text,
  p_participation_type text,
  p_leader_member_id uuid,
  p_leader_phone text,
  p_official_email text,
  p_fee_amount bigint,
  p_information_url text,
  p_proof_path text,
  p_bank_name text,
  p_account_number text,
  p_account_name text,
  p_return_agreement boolean,
  p_team_member_ids uuid[] default '{}'
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_official_email));
  v_leader record;
  v_member_id uuid;
  v_distinct_ids uuid[];
  v_rate numeric(4,3);
  v_amount bigint;
  v_request_number text;
  v_limit public.cssmora_achievement_submission_limits%rowtype;
begin
  if length(btrim(p_competition_name)) not between 3 and 180
     or length(btrim(p_competition_type)) not between 2 and 100 then
    raise exception 'Lengkapi nama dan jenis lomba.';
  end if;
  if p_participation_type not in ('individu','tim') then raise exception 'Jenis keikutsertaan tidak valid.'; end if;
  if p_fee_amount is null or p_fee_amount < 0 or p_fee_amount > 100000000 then raise exception 'Biaya lomba tidak valid.'; end if;
  if v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Email resmi tidak valid.'; end if;
  if p_information_url !~* '^https?://' then raise exception 'Tautan informasi lomba harus berupa URL.'; end if;
  if not coalesce(p_return_agreement, false) then raise exception 'Persetujuan pengembalian 5%% ke kas CSSMoRA wajib dicentang.'; end if;
  if p_proof_path !~ ('^applications/' || p_id::text || '/proof\.(jpg|jpeg|png|pdf)$') then raise exception 'Berkas bukti pendaftaran tidak valid.'; end if;
  if length(regexp_replace(coalesce(p_leader_phone,''), '[^0-9]', '', 'g')) not between 9 and 16
     or length(btrim(p_bank_name)) not between 2 and 80
     or coalesce(p_account_number,'') !~ '^[0-9]{5,30}$'
     or length(btrim(p_account_name)) not between 2 and 140 then
    raise exception 'Periksa nomor telepon dan rekening penerima.';
  end if;

  select m.id, m.full_name, m.cohort into v_leader
  from public.secretariat_members m where m.id = p_leader_member_id and m.is_active;
  if not found then raise exception 'Nama ketua tidak ditemukan di roster anggota aktif CSSMoRA.'; end if;

  select coalesce(array_agg(distinct x), '{}') into v_distinct_ids
  from unnest(coalesce(p_team_member_ids,'{}'::uuid[])) x where x is not null;
  if p_participation_type = 'tim' and cardinality(v_distinct_ids) < 1 then raise exception 'Pilih minimal satu anggota tim.'; end if;
  if p_participation_type = 'individu' and cardinality(v_distinct_ids) > 0 then raise exception 'Pengajuan individu tidak boleh berisi anggota tim.'; end if;
  if p_leader_member_id = any(v_distinct_ids) then raise exception 'Nama ketua tidak perlu dipilih lagi sebagai anggota tim.'; end if;
  if exists (
    select 1 from unnest(v_distinct_ids) chosen(id)
    left join public.secretariat_members m on m.id = chosen.id and m.is_active
    where m.id is null
  ) then raise exception 'Semua anggota harus dipilih dari roster aktif CSSMoRA.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  select * into v_limit from public.cssmora_achievement_submission_limits l where l.official_email = v_email for update;
  if found and v_limit.last_submitted_at > pg_catalog.now() - interval '24 hours'
     and v_limit.submissions_in_window >= 3 then
    raise exception 'Batas 3 pengajuan per email dalam 24 jam sudah tercapai.';
  end if;

  v_rate := case when p_participation_type = 'individu' then 0.500
    when p_fee_amount <= 20000 then 1.000
    when p_fee_amount <= 50000 then 0.750
    when p_fee_amount <= 80000 then 0.500 else 0.250 end;
  v_amount := round(p_fee_amount * v_rate)::bigint;
  v_request_number := 'CSS-PR-' || to_char(pg_catalog.now() at time zone 'Asia/Jakarta','YYMM') || '-' || upper(left(replace(p_id::text,'-',''),8));

  insert into public.cssmora_achievement_applications (
    id, competition_name, competition_type, participation_type, leader_member_id, leader_name, leader_phone,
    official_email, fee_amount, information_url, proof_path, bank_name, account_number, account_name, return_agreement
  ) values (
    p_id, btrim(p_competition_name), btrim(p_competition_type), p_participation_type, v_leader.id, v_leader.full_name,
    regexp_replace(p_leader_phone, '[^0-9+]', '', 'g'), v_email, p_fee_amount, btrim(p_information_url), p_proof_path,
    btrim(p_bank_name), p_account_number, btrim(p_account_name), p_return_agreement
  );
  insert into public.cssmora_achievement_application_members (application_id, member_id, member_name, cohort, role)
  values (p_id, v_leader.id, v_leader.full_name, v_leader.cohort, 'ketua');
  foreach v_member_id in array v_distinct_ids loop
    insert into public.cssmora_achievement_application_members (application_id, member_id, member_name, cohort, role)
    select p_id, m.id, m.full_name, m.cohort, 'anggota' from public.secretariat_members m where m.id = v_member_id;
  end loop;

  insert into public.cssmora_achievement_submission_limits (official_email, last_submitted_at, submissions_in_window)
  values (v_email, pg_catalog.now(), 1)
  on conflict (official_email) do update set
    submissions_in_window = case when public.cssmora_achievement_submission_limits.last_submitted_at <= pg_catalog.now() - interval '24 hours'
      then 1 else public.cssmora_achievement_submission_limits.submissions_in_window + 1 end,
    last_submitted_at = pg_catalog.now();

  return jsonb_build_object('id',p_id,'request_number',v_request_number,'subsidy_rate',v_rate,'requested_amount',v_amount);
end;
$$;
revoke all on function public.submit_cssmora_achievement_application(uuid,text,text,text,uuid,text,text,bigint,text,text,text,text,text,boolean,uuid[]) from public;
grant execute on function public.submit_cssmora_achievement_application(uuid,text,text,text,uuid,text,text,bigint,text,text,text,text,text,boolean,uuid[]) to anon, authenticated;

create or replace function public.review_cssmora_achievement_application(p_id uuid, p_decision text, p_note text default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(auth.jwt()->>'email'));
  v_role text;
  v_app public.cssmora_achievement_applications%rowtype;
  v_new_status text;
begin
  if auth.uid() is null then raise exception 'Login diperlukan.'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Keputusan tidak valid.'; end if;
  if length(coalesce(p_note,'')) > 1000 then raise exception 'Catatan maksimal 1000 karakter.'; end if;
  select r.role into v_role from public.cssmora_achievement_reviewers r
  where r.email = v_email and r.is_active and r.role in ('bendahara','ketua')
  order by case r.role when 'bendahara' then 1 else 2 end limit 1;
  if v_role is null then raise exception 'Akun ini tidak ditugaskan sebagai peninjau pengajuan prestasi.'; end if;
  select * into v_app from public.cssmora_achievement_applications a where a.id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan.'; end if;

  if v_role = 'bendahara' then
    if v_app.status <> 'pending_bendahara' then raise exception 'Pengajuan ini sudah melewati tahap Bendahara.'; end if;
    v_new_status := case p_decision when 'approved' then 'pending_ketua' else 'rejected' end;
    update public.cssmora_achievement_applications set
      status=v_new_status, treasurer_email=v_email, treasurer_decision=p_decision,
      treasurer_note=nullif(btrim(p_note),''), treasurer_reviewed_at=pg_catalog.now()
    where id=p_id;
  else
    if v_app.status <> 'pending_ketua' then raise exception 'Pengajuan belum disetujui Bendahara.'; end if;
    if v_app.treasurer_email = v_email then raise exception 'Bendahara dan Ketua harus menjadi dua peninjau yang berbeda.'; end if;
    v_new_status := case p_decision when 'approved' then 'approved' else 'rejected' end;
    update public.cssmora_achievement_applications set
      status=v_new_status, chair_email=v_email, chair_decision=p_decision,
      chair_note=nullif(btrim(p_note),''), chair_reviewed_at=pg_catalog.now()
    where id=p_id;
  end if;
  return v_new_status;
end;
$$;
revoke all on function public.review_cssmora_achievement_application(uuid,text,text) from public, anon;
grant execute on function public.review_cssmora_achievement_application(uuid,text,text) to authenticated;

revoke all on public.cssmora_achievement_reviewers from public, anon;
revoke all on public.cssmora_achievement_applications from public, anon, authenticated;
revoke all on public.cssmora_achievement_application_members from public, anon, authenticated;
grant select, insert, delete on public.cssmora_achievement_reviewers to authenticated;
grant select on public.cssmora_achievement_applications, public.cssmora_achievement_application_members to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cssmora-prestasi-proofs','cssmora-prestasi-proofs',false,5242880,array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','application/pdf'];
create policy "Public may upload application proof files" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id='cssmora-prestasi-proofs' and name ~ '^applications/[0-9a-f-]{36}/proof\.(jpg|jpeg|png|pdf)$');
create policy "Achievement reviewers read application proof files" on storage.objects
  for select to authenticated
  using (bucket_id='cssmora-prestasi-proofs'
    and ((select public.cssmora_achievement_is_reviewer('bendahara')) or (select public.cssmora_achievement_is_reviewer('ketua'))));
create policy "Applicants may clean up an unsubmitted proof file" on storage.objects
  for delete to anon, authenticated
  using (bucket_id='cssmora-prestasi-proofs' and name ~ '^applications/[0-9a-f-]{36}/proof\.(jpg|jpeg|png|pdf)$');
