create or replace function public.cssmora_user_has_role(p_role text)
returns boolean
language sql stable security invoker
set search_path = ''
as $$
  select auth.uid() is not null
    and p_role in ('ketua','wakil','bendahara','sekretaris','bph_departemen')
    and exists (
      select 1 from public.cssmora_user_roles r
      where r.email = lower(btrim((select auth.jwt()->>'email')))
        and r.role = p_role
        and r.is_active
    );
$$;
revoke all on function public.cssmora_user_has_role(text) from public, anon;
grant execute on function public.cssmora_user_has_role(text) to authenticated;
drop policy if exists "Agenda public or authorized read" on public.agenda;
create policy "Agenda published public read"
on public.agenda for select to anon
using (status = 'published');
create policy "Agenda authorized read"
on public.agenda for select to authenticated
using (
  status = 'published'
  or (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
drop policy if exists "Competition catalog public or authorized read" on public.competitions;
create policy "Competition published public read"
on public.competitions for select to anon
using (status = 'published');
create policy "Competition authorized read"
on public.competitions for select to authenticated
using (
  status = 'published'
  or (select public.cssmora_user_has_role('ketua'))
  or (select public.cssmora_user_has_role('wakil'))
  or (select public.cssmora_user_has_role('bph_departemen'))
);
