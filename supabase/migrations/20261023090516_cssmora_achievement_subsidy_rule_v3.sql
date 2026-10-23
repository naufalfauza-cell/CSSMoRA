-- Add a progressive marginal subsidy schedule while preserving prior request rules.
create or replace function public.cssmora_achievement_team_rate_for_rule(
  p_fee_amount bigint,
  p_rule_version smallint
)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case p_rule_version
    when 1 then case
      when p_fee_amount <= 20000 then 1.000
      when p_fee_amount <= 50000 then 0.750
      when p_fee_amount <= 80000 then 0.500
      else 0.250
    end
    when 2 then case
      when p_fee_amount <= 15000 then 1.000
      when p_fee_amount <= 50000 then 0.750
      when p_fee_amount <= 80000 then 0.500
      else 0.250
    end
    when 3 then case
      when p_fee_amount <= 15000 then 1.000
      when p_fee_amount <= 25000 then 0.750
      when p_fee_amount <= 40000 then 0.500
      when p_fee_amount <= 80000 then 0.250
      else 0.000
    end
    else 0.000
  end;
$function$;

create or replace function public.cssmora_achievement_subsidy_amount_for_rule(
  p_participation_type text,
  p_fee_amount bigint,
  p_rule_version smallint
)
returns bigint
language sql
immutable
set search_path = ''
as $function$
  select case p_rule_version
    when 1 then round(
      round(p_fee_amount * public.cssmora_achievement_team_rate_for_rule(p_fee_amount, 1::smallint))
        * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    )::bigint
    when 2 then round(
      least(
        round(p_fee_amount * public.cssmora_achievement_team_rate_for_rule(p_fee_amount, 2::smallint)),
        40000
      ) * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    )::bigint
    when 3 then round(
      round(case
        when p_fee_amount <= 15000 then p_fee_amount::numeric
        when p_fee_amount <= 25000 then 15000 + (p_fee_amount - 15000) * 0.75
        when p_fee_amount <= 40000 then 22500 + (p_fee_amount - 25000) * 0.50
        when p_fee_amount <= 80000 then 30000 + (p_fee_amount - 40000) * 0.25
        else 40000
      end) * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    )::bigint
    else 0
  end;
$function$;

create or replace function public.cssmora_achievement_subsidy_rate_for_rule(
  p_participation_type text,
  p_fee_amount bigint,
  p_rule_version smallint
)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select case
    when p_rule_version = 1 then
      public.cssmora_achievement_team_rate_for_rule(p_fee_amount, 1::smallint)
        * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    when p_rule_version = 2 and p_fee_amount = 0 then
      public.cssmora_achievement_team_rate_for_rule(p_fee_amount, 2::smallint)
        * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    when p_rule_version = 2 then
      public.cssmora_achievement_subsidy_amount_for_rule(
        p_participation_type, p_fee_amount, 2::smallint
      )::numeric / p_fee_amount
    when p_rule_version = 3 and p_fee_amount = 0 then
      public.cssmora_achievement_team_rate_for_rule(p_fee_amount, 3::smallint)
        * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    when p_rule_version = 3 then
      public.cssmora_achievement_subsidy_amount_for_rule(
        p_participation_type, p_fee_amount, 3::smallint
      )::numeric / p_fee_amount
    else 0.000
  end;
$function$;

alter table public.cssmora_achievement_applications
  drop constraint cssmora_achievement_applications_subsidy_rule_version_check,
  add constraint cssmora_achievement_applications_subsidy_rule_version_check
    check (subsidy_rule_version in (1, 2, 3)),
  alter column subsidy_rule_version set default 3;

comment on column public.cssmora_achievement_applications.subsidy_rule_version
  is 'Versi aturan subsidi yang digunakan saat pengajuan dibuat; versi 1 dan 2 tetap dipertahankan untuk pengajuan lama.';

alter table public.cssmora_achievement_applications
  drop column subsidy_rate,
  drop column requested_amount;

alter table public.cssmora_achievement_applications
  add column subsidy_rate numeric(8,6)
    generated always as (
      public.cssmora_achievement_subsidy_rate_for_rule(participation_type, fee_amount, subsidy_rule_version)
    ) stored,
  add column requested_amount bigint
    generated always as (
      public.cssmora_achievement_subsidy_amount_for_rule(participation_type, fee_amount, subsidy_rule_version)
    ) stored;

create or replace function public.cssmora_achievement_subsidy_rate(
  p_participation_type text,
  p_fee_amount bigint
)
returns numeric
language sql
immutable
set search_path = ''
as $function$
  select public.cssmora_achievement_subsidy_rate_for_rule(p_participation_type, p_fee_amount, 3::smallint);
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
  select public.cssmora_achievement_subsidy_amount_for_rule(p_participation_type, p_fee_amount, 3::smallint);
$function$;
