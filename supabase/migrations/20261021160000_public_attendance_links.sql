alter table public.secretariat_attendance_events
  add column public_token uuid not null default gen_random_uuid() unique;
