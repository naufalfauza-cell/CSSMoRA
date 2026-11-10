alter table public.secretariat_members add column nim text check (nim is null or nim ~ '^[0-9]{8,13}$');
create unique index secretariat_members_nim_unique on public.secretariat_members(nim) where nim is not null;
