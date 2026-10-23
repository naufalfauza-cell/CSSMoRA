alter table public.agenda_programs
  add column if not exists division text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agenda_programs_division_allowed'
      and conrelid = 'public.agenda_programs'::regclass
  ) then
    alter table public.agenda_programs
      add constraint agenda_programs_division_allowed
      check (division is null or division in ('BPH', 'PSDM', 'P3M', 'ADVO', 'MEDINFO'));
  end if;
end;
$$;

update public.agenda_programs
set division = 'P3M'
where division is null
  and upper(btrim(name)) in ('GHAYEM', 'CSSMORA MENGAJI');

create index if not exists agenda_programs_division_idx
  on public.agenda_programs (division);
