create table public.agenda_programs(
 id uuid primary key default gen_random_uuid(),name text not null,photo_path text not null,photo_url text not null,
 is_active boolean not null default true,created_at timestamptz not null default now()
);
alter table public.agenda_programs enable row level security;
grant select on public.agenda_programs to anon,authenticated;
grant insert,update,delete on public.agenda_programs to authenticated;
alter table public.agenda add column program_id uuid references public.agenda_programs(id) on delete restrict;
create index agenda_program_id_idx on public.agenda(program_id);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('cssmora-agenda-programs','cssmora-agenda-programs',true,8388608,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
create policy cssmora_agenda_photo_upload on storage.objects for insert to authenticated
with check(bucket_id='cssmora-agenda-programs' and exists(select 1 from public.competition_admins a where a.email=lower((select auth.jwt()->>'email'))));
create policy cssmora_agenda_photo_delete on storage.objects for delete to authenticated
using(bucket_id='cssmora-agenda-programs' and exists(select 1 from public.competition_admins a where a.email=lower((select auth.jwt()->>'email'))));
