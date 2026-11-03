begin;

create table public.secretariat_incoming_letters (
  id uuid primary key default gen_random_uuid(),
  received_on date not null default current_date,
  letter_date date,
  incoming_number text check (incoming_number is null or length(btrim(incoming_number)) <= 120),
  sender_name text not null default '' check (length(sender_name) <= 180),
  subject text not null default '' check (length(subject) <= 240),
  category text not null default '' check (length(category) <= 80),
  summary text not null default '' check (length(summary) <= 5000),
  action_required text not null default '' check (length(action_required) <= 2500),
  deadline date,
  priority text not null default 'normal' check (priority in ('normal','penting','segera')),
  status text not null default 'baru' check (status in ('baru','diproses','selesai','arsip')),
  notes text not null default '' check (length(notes) <= 5000),
  ai_status text not null default 'pending' check (ai_status in ('pending','processing','completed','failed')),
  ai_error text check (ai_error is null or length(ai_error) <= 500),
  ai_generated_at timestamptz,
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  storage_path text not null unique check (storage_path ~ ('^incoming/' || id::text || '/original\.pdf$')),
  drive_file_id text,
  drive_url text check (drive_url is null or drive_url ~ '^https://drive\.google\.com/'),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index secretariat_incoming_letters_received_idx
  on public.secretariat_incoming_letters (received_on desc, created_at desc);
create index secretariat_incoming_letters_deadline_idx
  on public.secretariat_incoming_letters (deadline)
  where deadline is not null and status <> 'selesai';

alter table public.secretariat_incoming_letters enable row level security;
revoke all on public.secretariat_incoming_letters from public, anon;
grant select, insert, update, delete on public.secretariat_incoming_letters to authenticated;
create policy "Secretariat roles read incoming letters"
  on public.secretariat_incoming_letters for select to authenticated
  using ((select public.is_secretariat_viewer()));
create policy "Secretary manages incoming letters"
  on public.secretariat_incoming_letters for all to authenticated
  using ((select public.is_secretariat_admin()))
  with check ((select public.is_secretariat_admin()) and created_by = (select auth.uid()));

-- PDFs stay private in the existing letter bucket and follow the same Drive mirror queue.
drop policy if exists "Secretary uploads incoming letter PDF" on storage.objects;
create policy "Secretary uploads incoming letter PDF"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'cssmora-letter-pdfs' and exists (
    select 1 from public.secretariat_incoming_letters l
    where l.storage_path = name and l.created_by = (select auth.uid())
      and (select public.is_secretariat_admin())
  ));
drop policy if exists "Secretariat reads incoming letter PDF" on storage.objects;
create policy "Secretariat reads incoming letter PDF"
  on storage.objects for select to authenticated
  using (bucket_id = 'cssmora-letter-pdfs' and exists (
    select 1 from public.secretariat_incoming_letters l
    where l.storage_path = name and (select public.is_secretariat_viewer())
  ));
drop policy if exists "Secretary deletes incoming letter PDF" on storage.objects;
create policy "Secretary deletes incoming letter PDF"
  on storage.objects for delete to authenticated
  using (bucket_id = 'cssmora-letter-pdfs' and exists (
    select 1 from public.secretariat_incoming_letters l
    where l.storage_path = name and (select public.is_secretariat_admin())
  ));

create or replace function public.require_incoming_letter_pdf_removed_before_delete()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'cssmora-letter-pdfs' and o.name = old.storage_path
  ) then
    raise exception 'Hapus PDF surat dari Storage sebelum menghapus catatan.' using errcode = '23514';
  end if;
  return old;
end;
$function$;
revoke all on function public.require_incoming_letter_pdf_removed_before_delete() from public, anon, authenticated;
create trigger require_incoming_letter_pdf_removed_before_delete
  before delete on public.secretariat_incoming_letters
  for each row execute function public.require_incoming_letter_pdf_removed_before_delete();

create table public.cssmora_drive_incoming_letter_archive (
  singleton boolean primary key default true check (singleton),
  folder_id text,
  spreadsheet_id text,
  updated_at timestamptz not null default now()
);
insert into public.cssmora_drive_incoming_letter_archive (singleton) values (true);
alter table public.cssmora_drive_incoming_letter_archive enable row level security;
revoke all on public.cssmora_drive_incoming_letter_archive from public, anon, authenticated;
grant all on public.cssmora_drive_incoming_letter_archive to service_role;

create table public.cssmora_drive_incoming_letter_sync (
  singleton boolean primary key default true check (singleton),
  generation bigint not null default 0,
  pending boolean not null default false,
  attempts integer not null default 0,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.cssmora_drive_incoming_letter_sync (singleton) values (true);
alter table public.cssmora_drive_incoming_letter_sync enable row level security;
revoke all on public.cssmora_drive_incoming_letter_sync from public, anon, authenticated;
grant all on public.cssmora_drive_incoming_letter_sync to service_role;

create or replace function public.enqueue_cssmora_incoming_letter_sheet_sync()
returns trigger language plpgsql security definer set search_path = '' as $function$
begin
  insert into public.cssmora_drive_incoming_letter_sync as queued
    (singleton, generation, pending, attempts, last_error, updated_at)
  values (true, 1, true, 0, null, pg_catalog.now())
  on conflict (singleton) do update set
    generation = queued.generation + 1,
    pending = true,
    attempts = 0,
    last_error = null,
    updated_at = pg_catalog.now();
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;
revoke all on function public.enqueue_cssmora_incoming_letter_sheet_sync() from public, anon, authenticated;
create trigger cssmora_incoming_letter_sheet_sync
  after insert or update or delete on public.secretariat_incoming_letters
  for each row execute function public.enqueue_cssmora_incoming_letter_sheet_sync();

create or replace function public.export_cssmora_drive_backup()
returns jsonb language sql security definer set search_path = '' as $function$
  select pg_catalog.jsonb_build_object(
    'format', 'cssmora-data-backup-v1',
    'generated_at', pg_catalog.clock_timestamp(),
    'tables', pg_catalog.jsonb_build_object(
      'agenda', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.agenda as t), '[]'::jsonb),
      'agenda_programs', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.agenda_programs as t), '[]'::jsonb),
      'competition_admins', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.competition_admins as t), '[]'::jsonb),
      'competitions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.competitions as t), '[]'::jsonb),
      'cssmora_achievement_application_members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_application_members as t), '[]'::jsonb),
      'cssmora_achievement_applications', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_applications as t), '[]'::jsonb),
      'cssmora_achievement_record_members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_record_members as t), '[]'::jsonb),
      'cssmora_achievement_records', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_records as t), '[]'::jsonb),
      'cssmora_achievement_reviewers', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_achievement_reviewers as t), '[]'::jsonb),
      'cssmora_drive_archives', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_drive_archives as t), '[]'::jsonb),
      'cssmora_finance_budgets', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_finance_budgets as t), '[]'::jsonb),
      'cssmora_finance_transactions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_finance_transactions as t), '[]'::jsonb),
      'cssmora_letter_signature_requests', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_letter_signature_requests as t), '[]'::jsonb),
      'cssmora_program_cycle_history', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_cycle_history as t), '[]'::jsonb),
      'cssmora_program_cycles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_cycles as t), '[]'::jsonb),
      'cssmora_program_details', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_details as t), '[]'::jsonb),
      'cssmora_program_document_budget_items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_budget_items as t), '[]'::jsonb),
      'cssmora_program_document_committee', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_committee as t), '[]'::jsonb),
      'cssmora_program_document_finance', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_finance as t), '[]'::jsonb),
      'cssmora_program_document_photos', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_photos as t), '[]'::jsonb),
      'cssmora_program_document_reviews', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_document_reviews as t), '[]'::jsonb),
      'cssmora_program_documents', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_documents as t), '[]'::jsonb),
      'cssmora_program_milestones', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_program_milestones as t), '[]'::jsonb),
      'cssmora_user_roles', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.cssmora_user_roles as t), '[]'::jsonb),
      'secretariat_admins', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_admins as t), '[]'::jsonb),
      'secretariat_attendance_events', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_attendance_events as t), '[]'::jsonb),
      'secretariat_attendance_records', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_attendance_records as t), '[]'::jsonb),
      'secretariat_incoming_letters', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_incoming_letters as t), '[]'::jsonb),
      'secretariat_letter_counters', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_letter_counters as t), '[]'::jsonb),
      'secretariat_letters', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_letters as t), '[]'::jsonb),
      'secretariat_members', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(t)) from public.secretariat_members as t), '[]'::jsonb)
    )
  );
$function$;
revoke all on function public.export_cssmora_drive_backup() from public, anon, authenticated;
grant execute on function public.export_cssmora_drive_backup() to service_role;

commit;
