-- Public agenda reader integrated with the existing competition-admin allowlist.
-- Public reads published rows only; authenticated admins can manage agenda rows.
create table public.agenda (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 140),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  description text,
  status text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);
create index agenda_status_starts_idx on public.agenda (status, starts_at);
alter table public.agenda enable row level security;
revoke all on public.agenda from anon, authenticated;
grant select on public.agenda to anon, authenticated;
grant insert, update, delete on public.agenda to authenticated;

create policy agenda_public_read on public.agenda
  for select to anon, authenticated
  using (status = 'published');

create policy agenda_admin_all on public.agenda
  for all to authenticated
  using (
    exists (
      select 1 from public.competition_admins a
      where a.email = lower(((select auth.jwt()) ->> 'email'))
    )
  )
  with check (
    exists (
      select 1 from public.competition_admins a
      where a.email = lower(((select auth.jwt()) ->> 'email'))
    )
  );
notify pgrst, 'reload schema';
