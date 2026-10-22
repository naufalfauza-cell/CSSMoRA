alter table public.cssmora_achievement_applications
  drop constraint cssmora_achievement_applications_check;

alter table public.cssmora_achievement_applications
  add constraint cssmora_achievement_applications_check
  check (
    chair_email is null
    or treasurer_email is null
    or chair_email <> treasurer_email
    or (
      lower(btrim(chair_email)) = 'naufal.almaroqi@gmail.com'
      and lower(btrim(treasurer_email)) = 'naufal.almaroqi@gmail.com'
    )
  );
