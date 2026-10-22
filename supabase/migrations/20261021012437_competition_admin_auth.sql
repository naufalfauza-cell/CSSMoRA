create table public.competition_admins(email text primary key,created_at timestamptz not null default now());
alter table public.competition_admins enable row level security;
grant select on public.competition_admins to anon,authenticated;
create policy "Admin can verify own access" on public.competition_admins for select to anon,authenticated
using(email=lower(((select auth.jwt())->>'email')));
create table public.competitions(
 id text primary key,title text not null,subtitle text,category text not null,organizer text not null,
 deadline text not null,fee text default 'Gratis',palette text default 'lime',mark text,year text default '2026',
 "posterImage" text,"registrationUrl" text,description text,status text default 'published',
 "createdAt" timestamptz default now(),"updatedAt" timestamptz default now()
);
alter table public.competitions enable row level security;
grant select on public.competitions to anon,authenticated;
grant insert,update,delete on public.competitions to authenticated;
insert into storage.buckets(id,name,public) values('posters','posters',true) on conflict(id) do nothing;
