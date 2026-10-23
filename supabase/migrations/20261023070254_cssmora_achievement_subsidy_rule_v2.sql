-- Version the subsidy policy so existing submissions keep the rule used when they were filed.
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
  select (
    case p_rule_version
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
      else 0.000
    end
  ) * case when p_participation_type = 'individu' then 0.500 else 1.000 end;
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
      round(p_fee_amount * public.cssmora_achievement_subsidy_rate_for_rule('tim', p_fee_amount, 1::smallint))
        * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    )::bigint
    when 2 then round(
      least(
        round(p_fee_amount * public.cssmora_achievement_subsidy_rate_for_rule('tim', p_fee_amount, 2::smallint)),
        40000
      ) * case when p_participation_type = 'individu' then 0.500 else 1.000 end
    )::bigint
    else 0
  end;
$function$;

revoke all on function public.cssmora_achievement_subsidy_rate_for_rule(text, bigint, smallint) from public, anon, authenticated;
revoke all on function public.cssmora_achievement_subsidy_amount_for_rule(text, bigint, smallint) from public, anon, authenticated;

alter table public.cssmora_achievement_applications
  add column subsidy_rule_version smallint not null default 1,
  add constraint cssmora_achievement_applications_subsidy_rule_version_check
    check (subsidy_rule_version in (1, 2));

alter table public.cssmora_achievement_applications
  alter column subsidy_rule_version set default 2;

comment on column public.cssmora_achievement_applications.subsidy_rule_version
  is 'Versi aturan subsidi yang digunakan ketika pengajuan dibuat; pengajuan lama tetap memakai versi 1.';

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
  select public.cssmora_achievement_subsidy_rate_for_rule(p_participation_type, p_fee_amount, 2::smallint);
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
  select public.cssmora_achievement_subsidy_amount_for_rule(p_participation_type, p_fee_amount, 2::smallint);
$function$;
