begin;
alter table public.cssmora_program_cycles add column prep_generation_started_at timestamptz;
grant update (prep_generation_started_at) on public.cssmora_program_cycles to authenticated;
commit;
