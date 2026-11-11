begin;

create policy "Chair and deputy register incoming letter uploads"
  on public.secretariat_incoming_letters for insert to authenticated
  with check (
    ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
    and created_by = (select auth.uid())
    and status = 'baru' and priority = 'normal' and ai_status = 'pending'
    and drive_file_id is null and drive_url is null
    and ai_error is null and ai_generated_at is null
    and letter_date is null and deadline is null and incoming_number is null
    and sender_name = '' and subject = '' and category = ''
    and summary = '' and action_required = '' and notes = ''
  );

create policy "Chair and deputy upload their incoming letter PDF"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'cssmora-letter-pdfs'
    and ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
    and exists (
      select 1 from public.secretariat_incoming_letters l
      where l.storage_path = name and l.created_by = (select auth.uid())
        and l.status = 'baru' and l.ai_status = 'pending' and l.drive_file_id is null
    )
  );

-- Roll back a registration only if its PDF never reached Storage.
create policy "Chair and deputy discard their incomplete uploads"
  on public.secretariat_incoming_letters for delete to authenticated
  using (
    ((select public.cssmora_user_has_role('ketua')) or (select public.cssmora_user_has_role('wakil')))
    and created_by = (select auth.uid())
    and status = 'baru' and ai_status = 'pending' and drive_file_id is null
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'cssmora-letter-pdfs' and o.name = storage_path
    )
  );

commit;
