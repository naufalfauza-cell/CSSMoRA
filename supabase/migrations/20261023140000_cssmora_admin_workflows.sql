-- Additive CSSMoRA workflows: richer proker records, finance outbox, and
-- independently reviewable public achievement records.

create table public.cssmora_program_details (
  program_id uuid primary key references public.agenda_programs(id) on delete cascade,
  cycle text not null default 'Tahunan' check (length(btrim(cycle)) between 1 and 80),
  period_label text check (period_label is null or length(btrim(period_label)) between 4 and 24),
  description text not null default '' check (length(description) <= 2000),
  goals text not null default '' check (length(goals) <= 1200),
  target text not null default '' check (length(target) <= 800),
  planned_schedule text not null default '' check (length(planned_schedule) <= 240),
  pic text not null default '' check (length(pic) <= 240),
  budget_amount bigint check (budget_amount is null or budget_amount >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.cssmora_program_details enable row level security;
revoke all on public.cssmora_program_details from public, anon;
grant select on public.cssmora_program_details to authenticated;
grant insert (program_id, cycle, period_label, description, goals, target, planned_schedule, pic, budget_amount)
  on public.cssmora_program_details to authenticated;
grant update (cycle, period_label, description, goals, target, planned_schedule, pic, budget_amount)
  on public.cssmora_program_details to authenticated;
create or replace function public.set_cssmora_program_detail_audit()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
create trigger set_cssmora_program_detail_audit_before_write
before insert or update on public.cssmora_program_details
for each row execute function public.set_cssmora_program_detail_audit();
create policy "CSSMoRA organization roles manage proker details"
on public.cssmora_program_details for all to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
)
with check (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);

create table public.cssmora_finance_budgets (
  id uuid primary key default gen_random_uuid(),
  fiscal_year smallint not null check (fiscal_year between 2020 and 2100),
  division text not null check (division in ('BPH','PSDM','P3M','ADVO','MEDINFO')),
  budget_label text not null check (length(btrim(budget_label)) between 2 and 160),
  planned_amount bigint not null check (planned_amount >= 0),
  forecast_amount bigint not null check (forecast_amount >= 0),
  note text not null default '' check (length(note) <= 800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  unique (fiscal_year, division, budget_label)
);
create index cssmora_finance_budgets_year_idx
  on public.cssmora_finance_budgets (fiscal_year, division, budget_label);
alter table public.cssmora_finance_budgets enable row level security;
revoke all on public.cssmora_finance_budgets from public, anon;
grant select, delete on public.cssmora_finance_budgets to authenticated;
grant insert (fiscal_year, division, budget_label, planned_amount, forecast_amount, note)
  on public.cssmora_finance_budgets to authenticated;
grant update (fiscal_year, division, budget_label, planned_amount, forecast_amount, note)
  on public.cssmora_finance_budgets to authenticated;
create or replace function public.set_cssmora_finance_budget_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
create trigger set_cssmora_finance_budget_updated_at_before_update
before update on public.cssmora_finance_budgets
for each row execute function public.set_cssmora_finance_budget_updated_at();
create policy "CSSMoRA finance roles manage budgets"
on public.cssmora_finance_budgets for all to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bendahara'))
)
with check (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bendahara'))
);

create table public.cssmora_finance_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_date date not null,
  reference text not null check (length(btrim(reference)) between 1 and 80),
  description text not null check (length(btrim(description)) between 3 and 240),
  direction text not null check (direction in ('income','expense')),
  amount bigint not null check (amount between 1 and 100000000000),
  cash_account_code text not null check (length(btrim(cash_account_code)) between 1 and 40),
  category_account_code text not null check (length(btrim(category_account_code)) between 1 and 40),
  budget_id uuid references public.cssmora_finance_budgets(id) on delete set null,
  sync_status text not null default 'pending' check (sync_status in ('pending','syncing','synced')),
  akunpro_transaction_id text,
  akunpro_synced_at timestamptz,
  sync_started_at timestamptz,
  last_sync_error text check (last_sync_error is null or length(last_sync_error) <= 600),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  check (cash_account_code <> category_account_code)
);
create index cssmora_finance_transactions_date_idx
  on public.cssmora_finance_transactions (transaction_date desc, created_at desc);
create index cssmora_finance_transactions_budget_idx
  on public.cssmora_finance_transactions (budget_id, direction, transaction_date);
alter table public.cssmora_finance_transactions enable row level security;
revoke all on public.cssmora_finance_transactions from public, anon;
grant select on public.cssmora_finance_transactions to authenticated;
grant insert (transaction_date, reference, description, direction, amount, cash_account_code, category_account_code, budget_id)
  on public.cssmora_finance_transactions to authenticated;
grant update (transaction_date, reference, description, direction, amount, cash_account_code, category_account_code, budget_id)
  on public.cssmora_finance_transactions to authenticated;
grant all on public.cssmora_finance_transactions to service_role;
create policy "CSSMoRA finance roles read transactions"
on public.cssmora_finance_transactions for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bendahara'))
);
create policy "CSSMoRA finance roles create transactions"
on public.cssmora_finance_transactions for insert to authenticated
with check (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bendahara'))
);
create policy "CSSMoRA finance roles update pending transactions"
on public.cssmora_finance_transactions for update to authenticated
using (
  sync_status = 'pending' and (
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('bendahara'))
  )
)
with check (
  sync_status = 'pending' and (
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('bendahara'))
  )
);

create or replace function public.claim_cssmora_finance_transaction(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.cssmora_finance_transactions%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Integration endpoint required.'; end if;
  select * into v_row from public.cssmora_finance_transactions where id = p_id for update;
  if not found then return jsonb_build_object('state', 'missing'); end if;
  if v_row.sync_status = 'synced' then
    return jsonb_build_object('state', 'synced', 'transaction_id', v_row.akunpro_transaction_id);
  end if;
  if v_row.sync_status = 'syncing' and v_row.sync_started_at >= v_now - interval '10 minutes' then
    return jsonb_build_object('state', 'busy');
  end if;
  update public.cssmora_finance_transactions
  set sync_status = 'syncing', sync_started_at = v_now, last_sync_error = null
  where id = p_id
  returning * into v_row;
  return jsonb_build_object('state', 'claimed', 'transaction', to_jsonb(v_row));
end;
$$;
revoke all on function public.claim_cssmora_finance_transaction(uuid) from public, anon, authenticated;
grant execute on function public.claim_cssmora_finance_transaction(uuid) to service_role;

create or replace function public.release_cssmora_finance_transaction(p_id uuid, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Integration endpoint required.'; end if;
  update public.cssmora_finance_transactions
  set sync_status = 'pending', sync_started_at = null,
      last_sync_error = nullif(left(btrim(coalesce(p_error, '')), 600), '')
  where id = p_id and sync_status = 'syncing';
  return found;
end;
$$;
revoke all on function public.release_cssmora_finance_transaction(uuid,text) from public, anon, authenticated;
grant execute on function public.release_cssmora_finance_transaction(uuid,text) to service_role;

create table public.cssmora_achievement_records (
  id uuid primary key,
  competition_name text not null check (length(btrim(competition_name)) between 3 and 180),
  competition_level text not null check (competition_level in ('lokal','regional','nasional','internasional')),
  competition_category text not null default '' check (length(competition_category) <= 100),
  participation_type text not null check (participation_type in ('individu','tim')),
  award_title text not null check (length(btrim(award_title)) between 2 and 100),
  event_date date not null,
  contact_email text check (contact_email is null or length(contact_email) <= 254),
  certificate_path text not null unique check (certificate_path ~ '^records/[0-9a-f-]{36}/certificate\.(jpg|jpeg|png|webp|pdf)$'),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text check (review_note is null or length(review_note) <= 1000),
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index cssmora_achievement_records_status_date_idx
  on public.cssmora_achievement_records (status, event_date desc, created_at desc);

create table public.cssmora_achievement_record_members (
  record_id uuid not null references public.cssmora_achievement_records(id) on delete cascade,
  member_id uuid not null references public.secretariat_members(id) on delete restrict,
  member_name text not null,
  cohort smallint not null,
  primary key (record_id, member_id)
);
create index cssmora_achievement_record_members_member_idx
  on public.cssmora_achievement_record_members (member_id, record_id);
alter table public.cssmora_achievement_records enable row level security;
alter table public.cssmora_achievement_record_members enable row level security;
revoke all on public.cssmora_achievement_records, public.cssmora_achievement_record_members from public, anon;
grant select on public.cssmora_achievement_records, public.cssmora_achievement_record_members to authenticated;
grant all on public.cssmora_achievement_records, public.cssmora_achievement_record_members to service_role;
create policy "CSSMoRA organization roles read achievement records"
on public.cssmora_achievement_records for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);
create policy "CSSMoRA organization roles read achievement record members"
on public.cssmora_achievement_record_members for select to authenticated
using (
  (select public.cssmora_user_has_role('ketua')) or
  (select public.cssmora_user_has_role('wakil')) or
  (select public.cssmora_user_has_role('bph_departemen'))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cssmora-achievement-certificates','cssmora-achievement-certificates',false,5242880,
  array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

create or replace function public.validate_cssmora_achievement_record_certificate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'cssmora-achievement-certificates'
      and o.name = new.certificate_path
  ) then
    raise exception 'Certificate file is missing from private storage.';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_cssmora_achievement_record_certificate() from public, anon, authenticated;
create trigger validate_cssmora_achievement_record_certificate_before_insert
before insert on public.cssmora_achievement_records
for each row execute function public.validate_cssmora_achievement_record_certificate();

create or replace function public.cssmora_public_achievement_member_roster()
returns table(id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select m.id, m.full_name
  from public.secretariat_members m
  where m.is_active = true
  order by m.full_name asc;
$$;
revoke all on function public.cssmora_public_achievement_member_roster() from public;
grant execute on function public.cssmora_public_achievement_member_roster() to anon, authenticated;

create or replace function public.submit_cssmora_achievement_record(
  p_id uuid,
  p_competition_name text,
  p_competition_level text,
  p_competition_category text,
  p_participation_type text,
  p_award_title text,
  p_event_date date,
  p_contact_email text,
  p_certificate_path text,
  p_member_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_request_number text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Submission endpoint required.'; end if;
  if p_id is null or p_competition_name is null or length(btrim(p_competition_name)) not between 3 and 180
     or p_competition_level is null or p_competition_level not in ('lokal','regional','nasional','internasional')
     or p_participation_type is null or p_participation_type not in ('individu','tim')
     or p_award_title is null or length(btrim(p_award_title)) not between 2 and 100
     or p_event_date is null or p_event_date > (pg_catalog.now() at time zone 'Asia/Jakarta')::date or p_certificate_path is null
     or coalesce(array_length(p_member_ids, 1), 0) < 1 then
    raise exception 'Lengkapi nama lomba, tingkat, peserta, hasil, tanggal, dan sertifikat.';
  end if;
  if p_certificate_path !~ ('^records/' || p_id::text || '/certificate\.(jpg|jpeg|png|webp|pdf)$') then
    raise exception 'Lokasi sertifikat tidak sesuai dengan laporan.';
  end if;
  if p_participation_type = 'individu' and coalesce(array_length(p_member_ids, 1), 0) <> 1 then
    raise exception 'Prestasi individu harus memiliki satu peserta.';
  end if;
  if p_participation_type = 'tim' and coalesce(array_length(p_member_ids, 1), 0) < 2 then
    raise exception 'Prestasi tim harus memiliki sedikitnya dua anggota.';
  end if;
  if coalesce(array_length(p_member_ids, 1), 0) > 20 then
    raise exception 'Satu laporan dibatasi maksimal 20 peserta.';
  end if;
  if p_contact_email is not null and (length(p_contact_email) > 254 or p_contact_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$') then
    raise exception 'Format email tidak valid.';
  end if;
  select count(distinct m.id)::integer into v_count
  from public.secretariat_members m
  where m.id = any(p_member_ids) and m.is_active = true;
  if v_count <> array_length(p_member_ids, 1) then
    raise exception 'Pilih peserta aktif dari daftar anggota CSSMoRA.';
  end if;

  insert into public.cssmora_achievement_records (
    id, competition_name, competition_level, competition_category, participation_type,
    award_title, event_date, contact_email, certificate_path
  ) values (
    p_id, btrim(p_competition_name), p_competition_level,
    coalesce(nullif(btrim(p_competition_category), ''), ''), p_participation_type,
    btrim(p_award_title), p_event_date, nullif(lower(btrim(p_contact_email)), ''), p_certificate_path
  );

  insert into public.cssmora_achievement_record_members (record_id, member_id, member_name, cohort)
  select p_id, m.id, m.full_name, m.cohort
  from public.secretariat_members m
  where m.id = any(p_member_ids) and m.is_active = true;

  v_request_number := 'CAP-' || to_char((pg_catalog.now() at time zone 'Asia/Jakarta')::date, 'YYYY') || '-' || upper(substr(replace(p_id::text, '-', ''), 1, 10));
  return jsonb_build_object('id', p_id, 'request_number', v_request_number, 'status', 'pending');
end;
$$;
revoke all on function public.submit_cssmora_achievement_record(uuid,text,text,text,text,text,date,text,text,uuid[]) from public, anon, authenticated;
grant execute on function public.submit_cssmora_achievement_record(uuid,text,text,text,text,text,date,text,text,uuid[]) to service_role;

create or replace function public.cssmora_public_achievement_recap()
returns table(
  id uuid, competition_name text, competition_level text, competition_category text,
  participation_type text, award_title text, event_date date, participant_names text[]
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.competition_name, r.competition_level, r.competition_category,
    r.participation_type, r.award_title, r.event_date,
    coalesce(array_agg(m.member_name order by m.cohort desc, m.member_name) filter (where m.member_id is not null), array[]::text[])
  from public.cssmora_achievement_records r
  left join public.cssmora_achievement_record_members m on m.record_id = r.id
  where r.status = 'approved'
  group by r.id, r.created_at
  order by r.event_date desc, r.created_at desc
  limit 100;
$$;
revoke all on function public.cssmora_public_achievement_recap() from public;
grant execute on function public.cssmora_public_achievement_recap() to anon, authenticated;

create or replace function public.review_cssmora_achievement_record(p_id uuid, p_decision text, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare v_email text; v_status text;
begin
  if auth.uid() is null or not (
    public.cssmora_user_has_role('ketua') or
    public.cssmora_user_has_role('wakil') or
    public.cssmora_user_has_role('bph_departemen')
  ) then raise exception 'Akses pengurus CSSMoRA diperlukan.'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Keputusan peninjauan tidak valid.'; end if;
  if p_decision = 'rejected' and nullif(btrim(p_note), '') is null then
    raise exception 'Tambahkan alasan jika prestasi ditolak.';
  end if;
  v_email := lower(btrim(coalesce(auth.jwt()->>'email','')));
  update public.cssmora_achievement_records r
  set status = p_decision, review_note = nullif(btrim(p_note), ''),
      reviewed_by = v_email, reviewed_at = now()
  where r.id = p_id and r.status = 'pending'
  returning r.status into v_status;
  if v_status is null then raise exception 'Prestasi tidak ditemukan atau sudah ditinjau.'; end if;
  return v_status;
end;
$$;
revoke all on function public.review_cssmora_achievement_record(uuid,text,text) from public, anon;
grant execute on function public.review_cssmora_achievement_record(uuid,text,text) to authenticated;

create policy "CSSMoRA reviewers read achievement certificates"
on storage.objects for select to authenticated
using (
  bucket_id = 'cssmora-achievement-certificates' and (
    (select public.cssmora_user_has_role('ketua')) or
    (select public.cssmora_user_has_role('wakil')) or
    (select public.cssmora_user_has_role('bph_departemen'))
  )
);

create table public.cssmora_achievement_record_ip_submission_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  updated_at timestamptz not null default now()
);
create index cssmora_achievement_record_limits_updated_idx
  on public.cssmora_achievement_record_ip_submission_limits (updated_at);
alter table public.cssmora_achievement_record_ip_submission_limits enable row level security;
revoke all on public.cssmora_achievement_record_ip_submission_limits from public, anon, authenticated;
grant select, insert, update, delete on public.cssmora_achievement_record_ip_submission_limits to service_role;

create or replace function public.consume_cssmora_achievement_record_ip_limit(p_ip_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_now timestamptz := pg_catalog.now();
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'Submission endpoint required.'; end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid submission rate-limit key.'; end if;
  delete from public.cssmora_achievement_record_ip_submission_limits
  where updated_at < v_now - interval '7 days';
  insert into public.cssmora_achievement_record_ip_submission_limits (ip_hash,window_started_at,request_count,updated_at)
  values (p_ip_hash,v_now,1,v_now)
  on conflict (ip_hash) do update set
    window_started_at = case when public.cssmora_achievement_record_ip_submission_limits.window_started_at < v_now - interval '1 hour' then v_now else public.cssmora_achievement_record_ip_submission_limits.window_started_at end,
    request_count = case when public.cssmora_achievement_record_ip_submission_limits.window_started_at < v_now - interval '1 hour' then 1 else public.cssmora_achievement_record_ip_submission_limits.request_count + 1 end,
    updated_at = v_now
  returning request_count into v_count;
  return v_count <= 5;
end;
$$;
revoke all on function public.consume_cssmora_achievement_record_ip_limit(text) from public, anon, authenticated;
grant execute on function public.consume_cssmora_achievement_record_ip_limit(text) to service_role;
