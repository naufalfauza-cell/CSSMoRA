begin;

alter table public.cssmora_program_cycles
  add column prep_document_url text check (length(prep_document_url) <= 2048 and prep_document_url ~ '^https://[^[:space:]/]+'),
  add column prep_budget_url text check (length(prep_budget_url) <= 2048 and prep_budget_url ~ '^https://[^[:space:]/]+'),
  add column prep_minutes_url text check (length(prep_minutes_url) <= 2048 and prep_minutes_url ~ '^https://[^[:space:]/]+'),
  add column prep_folder_url text check (length(prep_folder_url) <= 2048 and prep_folder_url ~ '^https://[^[:space:]/]+'),
  add column prep_committee_count integer check (prep_committee_count between 0 and 100000),
  add column prep_budget_amount bigint check (prep_budget_amount between 0 and 10000000000),
  add column prep_notes text not null default '' check (length(prep_notes) <= 4000);

grant insert (prep_document_url, prep_budget_url, prep_minutes_url, prep_folder_url, prep_committee_count, prep_budget_amount, prep_notes)
  on public.cssmora_program_cycles to authenticated;
grant update (prep_document_url, prep_budget_url, prep_minutes_url, prep_folder_url, prep_committee_count, prep_budget_amount, prep_notes)
  on public.cssmora_program_cycles to authenticated;

create function public.guard_cssmora_program_preparation_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('lpj_review', 'completed') and
    row(new.prep_document_url, new.prep_budget_url, new.prep_minutes_url, new.prep_folder_url,
        new.prep_committee_count, new.prep_budget_amount, new.prep_notes) is distinct from
    row(old.prep_document_url, old.prep_budget_url, old.prep_minutes_url, old.prep_folder_url,
        old.prep_committee_count, old.prep_budget_amount, old.prep_notes) then
    raise exception 'Data persiapan terkunci selama peninjauan LPJ atau setelah disetujui.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_cssmora_program_preparation_write() from public, anon, authenticated;
create trigger guard_cssmora_program_preparation_write_before
  before update on public.cssmora_program_cycles
  for each row execute function public.guard_cssmora_program_preparation_write();

commit;
