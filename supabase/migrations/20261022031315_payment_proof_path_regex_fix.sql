alter table public.cssmora_achievement_applications
  drop constraint cssmora_achievement_payment_proof_path_check;
alter table public.cssmora_achievement_applications
  add constraint cssmora_achievement_payment_proof_path_check
  check (
    payment_proof_path is null
    or payment_proof_path ~ (
      '^payments/' || id::text || '/payment-proof-[0-9]{13}[.](jpg|jpeg|png|pdf)$'
    )
  );
