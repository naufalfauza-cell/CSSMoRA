-- The program form writes both the photo and its program details.
alter policy "CSSMoRA organization roles manage proker details"
on public.cssmora_program_details
using ((select public.cssmora_schedule_manager()))
with check ((select public.cssmora_schedule_manager()));

-- Storage needs SELECT as well as DELETE to locate the previous photo
-- when a manager replaces it or cleans up a failed save.
create policy cssmora_agenda_photo_read_for_management
on storage.objects for select to authenticated
using (bucket_id = 'cssmora-agenda-programs' and (select public.cssmora_schedule_manager()));
