drop policy if exists "Public may upload application proof files" on storage.objects;
drop policy if exists "Applicants may clean up an unsubmitted proof file" on storage.objects;

revoke all on function public.submit_cssmora_achievement_application(
  uuid,text,text,text,uuid,text,text,bigint,text,text,text,text,text,boolean,uuid[]
) from public, anon, authenticated;
grant execute on function public.submit_cssmora_achievement_application(
  uuid,text,text,text,uuid,text,text,bigint,text,text,text,text,text,boolean,uuid[]
) to service_role;
