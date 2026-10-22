-- Keep the fee tiers unchanged; an individual request receives half of the
-- team rate for the same fee tier.
create or replace function public.cssmora_achievement_subsidy_rate(
  p_participation_type text,
  p_fee_amount bigint
)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select (
    case
      when p_fee_amount <= 20000 then 1.000
      when p_fee_amount <= 50000 then 0.750
      when p_fee_amount <= 80000 then 0.500
      else 0.250
    end
  ) * (case when p_participation_type = 'individu' then 0.500 else 1.000 end);
$function$;

create or replace function public.cssmora_achievement_subsidy_amount(
  p_participation_type text,
  p_fee_amount bigint
)
returns bigint
language sql
immutable
set search_path = ''
as $function$
  select round(
    round(p_fee_amount * public.cssmora_achievement_subsidy_rate('tim', p_fee_amount))
      * (case when p_participation_type = 'individu' then 0.500 else 1.000 end)
  )::bigint;
$function$;

alter table public.cssmora_achievement_applications
  rename column subsidy_rate to legacy_subsidy_rate;

alter table public.cssmora_achievement_applications
  rename column requested_amount to legacy_requested_amount;

alter table public.cssmora_achievement_applications
  add column subsidy_rate numeric(4,3)
    generated always as (
      public.cssmora_achievement_subsidy_rate(participation_type, fee_amount)
    ) stored,
  add column requested_amount bigint
    generated always as (
      public.cssmora_achievement_subsidy_amount(participation_type, fee_amount)
    ) stored;

comment on column public.cssmora_achievement_applications.legacy_subsidy_rate
  is 'Nilai formula subsidi lama yang dipertahankan untuk audit koreksi subsidi individu.';
comment on column public.cssmora_achievement_applications.legacy_requested_amount
  is 'Nominal formula lama yang dipertahankan untuk audit koreksi subsidi individu.';

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
language plpgsql
security definer
set search_path = ''
as $function$
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

  v_rate := public.cssmora_achievement_subsidy_rate(p_participation_type, p_fee_amount);
  v_amount := public.cssmora_achievement_subsidy_amount(p_participation_type, p_fee_amount);
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
$function$;

revoke all on function public.submit_cssmora_achievement_application(uuid,text,text,text,uuid,text,text,bigint,text,text,text,text,text,boolean,uuid[]) from public;
grant execute on function public.submit_cssmora_achievement_application(uuid,text,text,text,uuid,text,text,bigint,text,text,text,text,text,boolean,uuid[]) to anon, authenticated;

alter table public.secretariat_attendance_events
  add column if not exists auto_close_at timestamptz;

create index if not exists secretariat_attendance_events_auto_close_at_idx
  on public.secretariat_attendance_events (auto_close_at)
  where status = 'open' and auto_close_at is not null;

do $migration$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'cssmora-attendance-auto-close'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'cssmora-attendance-auto-close',
    '* * * * *',
    $job$
      update public.secretariat_attendance_events
      set status = 'closed'
      where status = 'open'
        and auto_close_at is not null
        and auto_close_at <= statement_timestamp();
    $job$
  );
end;
$migration$;
