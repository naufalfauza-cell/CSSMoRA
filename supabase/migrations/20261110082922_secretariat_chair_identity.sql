create table public.secretariat_chair_identity (
  singleton boolean primary key default true check (singleton),
  nim text not null check (nim ~ '^[0-9]+$'),
  nia text not null check (nia ~ '^[A-Za-z0-9]+$')
);

alter table public.secretariat_chair_identity enable row level security;
revoke all on public.secretariat_chair_identity from public, anon, authenticated;
grant select on public.secretariat_chair_identity to service_role;
