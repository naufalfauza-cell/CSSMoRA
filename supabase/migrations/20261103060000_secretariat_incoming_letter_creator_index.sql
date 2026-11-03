begin;

create index if not exists secretariat_incoming_letters_created_by_idx
  on public.secretariat_incoming_letters (created_by);

commit;
